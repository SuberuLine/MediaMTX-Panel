package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/mediamtx-control/mediamtx-control/internal/auth"
	"github.com/mediamtx-control/mediamtx-control/internal/config"
	"github.com/mediamtx-control/mediamtx-control/internal/mediamtx"
	"github.com/mediamtx-control/mediamtx-control/internal/metrics"
	"github.com/mediamtx-control/mediamtx-control/internal/service"
	"github.com/mediamtx-control/mediamtx-control/internal/store/sqlite"
)

// Set MTX_TEST_BINARY to a checksum-verified MediaMTX v1.21.1 executable.
// Tests use temporary config/database and loopback listeners, then stop the child.
func TestRealMediaMTX(t *testing.T) {
	binary := os.Getenv("MTX_TEST_BINARY")
	if binary == "" {
		t.Skip("MTX_TEST_BINARY not set")
	}
	address := func() string {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		v := l.Addr().String()
		l.Close()
		return v
	}
	apiAddress, metricsAddress := address(), address()
	dir := t.TempDir()
	conf := filepath.Join(dir, "mediamtx.yml")
	body := fmt.Sprintf(`logLevel: error
api: true
apiAddress: %s
metrics: true
metricsAddress: %s
rtspAddress: 127.0.0.1:0
rtspTransports: [tcp]
rtmpAddress: 127.0.0.1:0
hlsAddress: 127.0.0.1:0
webrtcAddress: 127.0.0.1:0
webrtcLocalUDPAddress: 127.0.0.1:0
srtAddress: 127.0.0.1:0
moq: false
authInternalUsers:
  - user: panel
    pass: integration-api-secret
    ips: []
    permissions:
      - action: api
      - action: metrics
paths: {}
`, apiAddress, metricsAddress)
	if err := os.WriteFile(conf, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, conf)
	var logs bytes.Buffer
	cmd.Stdout = &logs
	cmd.Stderr = &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cmd.Process.Kill()
		cmd.Wait()
		if t.Failed() {
			t.Log(logs.String())
		}
	}()
	client := mediamtx.New("http://"+apiAddress, time.Second, "panel", "integration-api-secret")
	deadline := time.Now().Add(10 * time.Second)
	for {
		if _, err := client.GetInfo(ctx); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("MediaMTX did not become ready")
		}
		time.Sleep(50 * time.Millisecond)
	}
	collector := metrics.New("http://"+metricsAddress, time.Second, time.Second, "panel", "integration-api-secret")
	collector.Sample(ctx)
	if collector.Snapshot().Stale {
		t.Fatal("real metrics parser failed")
	}
	db, err := sqlite.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	hash, err := auth.HashPassword("test-password-1234")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.CreateUser(ctx, "admin", hash, "admin"); err != nil {
		t.Fatal(err)
	}
	c, err := config.Load("")
	if err != nil {
		t.Fatal(err)
	}
	handler, err := New(c, &service.Service{MTX: client, Metrics: collector}, db)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{handler: handler, db: db}
	cookie, csrf := login(t, f, "admin")
	assertStatus(t, request(handler, "GET", "/readyz", "", nil, ""), 200)
	assertStatus(t, request(handler, "GET", "/api/v1/instance", "", cookie, ""), 200)
	assertStatus(t, request(handler, "POST", "/api/v1/config/paths", `{"name":"live/camera","source":"publisher","maxReaders":5}`, cookie, csrf), 201)
	assertStatus(t, request(handler, "GET", "/api/v1/streams/live%2Fcamera", "", cookie, ""), 200)
	assertStatus(t, request(handler, "GET", "/api/v1/streams", "", cookie, ""), 200)
	assertStatus(t, request(handler, "PATCH", "/api/v1/config/paths/live%2Fcamera", `{"record":true,"recordFormat":"fmp4","recordSegmentDuration":"1h","recordDeleteAfter":"24h","maxReaders":0}`, cookie, csrf), 200)
	cfg, err := client.GetPathConfig(ctx, "live/camera")
	if err != nil || !cfg.Record || cfg.MaxReaders != 0 {
		t.Fatalf("real patch failed: %+v %v", cfg, err)
	}
	configResponse := request(handler, "GET", "/api/v1/config/paths/live%2Fcamera", "", cookie, "")
	assertStatus(t, configResponse, 200)
	var editable struct {
		Data service.PathConfig `json:"data"`
	}
	if err := json.Unmarshal(configResponse.Body.Bytes(), &editable); err != nil {
		t.Fatal(err)
	}
	if err := service.ValidatePatch(service.PathPatch{RecordSegmentDuration: &editable.Data.RecordSegmentDuration, RecordDeleteAfter: &editable.Data.RecordDeleteAfter}); err != nil {
		t.Fatal("MediaMTX day durations must be normalized for UI editing", err)
	}
	for _, p := range []string{"srt", "hls", "webrtc", "rtsp", "rtmp"} {
		v, err := client.ListConnections(ctx, p)
		if err != nil || len(v) != 0 {
			t.Fatalf("real %s list: %v %+v", p, err, v)
		}
	}
	assertStatus(t, request(handler, "GET", "/api/v1/connections", "", cookie, ""), 200)
	assertStatus(t, request(handler, "GET", "/api/v1/dashboard", "", cookie, ""), 200)
	assertStatus(t, request(handler, "DELETE", "/api/v1/connections/hls/11111111-1111-4111-8111-111111111111", "", cookie, csrf), http.StatusNotFound)
	assertStatus(t, request(handler, "DELETE", "/api/v1/config/paths/live%2Fcamera", "", cookie, csrf), 200)
	assertStatus(t, request(handler, "GET", "/api/v1/streams/live%2Fcamera", "", cookie, ""), 404)
	t.Log("real MediaMTX v1.21.1: info, authenticated metrics, nested path CRUD, protocol lists, dashboard, missing-session kick verified")
}
