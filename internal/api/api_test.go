package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mediamtx-control/mediamtx-control/internal/auth"
	"github.com/mediamtx-control/mediamtx-control/internal/config"
	"github.com/mediamtx-control/mediamtx-control/internal/mediamtx"
	"github.com/mediamtx-control/mediamtx-control/internal/metrics"
	"github.com/mediamtx-control/mediamtx-control/internal/service"
	"github.com/mediamtx-control/mediamtx-control/internal/store/sqlite"
)

type fixture struct {
	handler   http.Handler
	db        *sqlite.Store
	mutations atomic.Int32
	offline   atomic.Bool
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if f.offline.Load() {
			w.WriteHeader(503)
			w.Write([]byte(`{"error":"private password=secret"}`))
			return
		}
		if r.Method != "GET" {
			f.mutations.Add(1)
			if strings.Contains(r.URL.Path, "missing") {
				w.WriteHeader(404)
				return
			}
			w.Write([]byte(`{"status":"ok"}`))
			return
		}
		switch r.URL.Path {
		case "/v3/info":
			fmt.Fprintf(w, `{"version":"v1.21.1","started":%q}`, time.Now().Add(-time.Hour).UTC().Format(time.RFC3339))
		case "/v3/paths/list":
			w.Write([]byte(`{"pageCount":1,"items":[{"name":"live/camera","online":true,"source":{"type":"srtConn","id":"private"},"tracks2":[{"codec":"H264"},{"codec":"MPEG-4 Audio"}],"readers":[{"id":"r","type":"hlsMuxer"}]}]}`))
		case "/v3/config/paths/list":
			w.Write([]byte(`{"pageCount":1,"items":[{"name":"offline","source":"publisher"},{"name":"live/camera","source":"rtsp://user:password@camera/live?token=secret","runOnReady":"private command"}]}`))
		case "/v3/paths/get/live/camera":
			w.Write([]byte(`{"name":"live/camera","online":true,"tracks":["H264"]}`))
		case "/v3/config/paths/get/live/camera":
			w.Write([]byte(`{"name":"live/camera","source":"publisher"}`))
		case "/v3/config/paths/get/offline":
			w.Write([]byte(`{"name":"offline","source":"publisher"}`))
		case "/v3/srt/conns/list":
			w.Write([]byte(`{"pageCount":1,"items":[{"id":"11111111-1111-4111-8111-111111111111","created":"2026-01-01T00:00:00Z","path":"live/camera","state":"publish","remoteAddr":"127.0.0.1:8000","inboundBytes":100,"bytesReceived":999}]}`))
		case "/v3/hls/sessions/list":
			w.Write([]byte(`{"pageCount":1,"items":[{"id":"22222222-2222-4222-8222-222222222222","created":"2026-01-01T00:00:00Z","path":"live/camera","outboundBytes":200}]}`))
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(upstream.Close)
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	f.db = db
	t.Cleanup(func() { db.Close() })
	hash, err := auth.HashPassword("test-password-1234")
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range []string{"admin", "operator", "viewer"} {
		if err = db.CreateUser(context.Background(), role, hash, role); err != nil {
			t.Fatal(err)
		}
	}
	c, err := config.Load("")
	if err != nil {
		t.Fatal(err)
	}
	c.Auth.SecureCookie = true
	svc := &service.Service{MTX: mediamtx.New(upstream.URL, time.Second, "", ""), Metrics: metrics.New(upstream.URL, time.Second, time.Second, "", "")}
	f.handler, err = New(c, svc, db)
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func request(h http.Handler, method, target, body string, cookie *http.Cookie, csrf string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:10000"
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	if csrf != "" {
		r.Header.Set("X-CSRF-Token", csrf)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func login(t *testing.T, f *fixture, role string) (*http.Cookie, string) {
	t.Helper()
	w := request(f.handler, "POST", "/api/v1/auth/login", fmt.Sprintf(`{"username":%q,"password":"test-password-1234"}`, role), nil, "")
	if w.Code != 200 {
		t.Fatalf("login %d %s", w.Code, w.Body)
	}
	var v struct {
		Data struct {
			CSRF string `json:"csrfToken"`
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return w.Result().Cookies()[0], v.Data.CSRF
}
func assertStatus(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status %d want %d: %s", w.Code, want, w.Body)
	}
	if !json.Valid(w.Body.Bytes()) {
		t.Fatalf("response is not JSON: %s", w.Body)
	}
}

func TestAuthenticationRBACAndCSRF(t *testing.T) {
	f := newFixture(t)
	assertStatus(t, request(f.handler, "GET", "/api/v1/streams", "", nil, ""), 401)
	admin, csrf := login(t, f, "admin")
	if !admin.HttpOnly || !admin.Secure || admin.SameSite != http.SameSiteStrictMode || len(csrf) != 43 {
		t.Fatalf("unsafe cookie: %+v csrf=%q", admin, csrf)
	}
	w := request(f.handler, "GET", "/api/v1/auth/me", "", admin, "")
	assertStatus(t, w, 200)
	if strings.Contains(w.Body.String(), "password_hash") || strings.Contains(w.Body.String(), "argon2") {
		t.Fatal("password hash leaked")
	}
	assertStatus(t, request(f.handler, "POST", "/api/v1/streams", `{"name":"new"}`, admin, ""), 403)
	assertStatus(t, request(f.handler, "POST", "/api/v1/streams", `{"name":"new"}`, admin, csrf), 201)
	viewer, viewerCSRF := login(t, f, "viewer")
	for _, p := range []string{"/api/v1/connections", "/api/v1/config/paths", "/api/v1/audit-logs", "/api/v1/instance"} {
		assertStatus(t, request(f.handler, "GET", p, "", viewer, ""), 403)
	}
	assertStatus(t, request(f.handler, "GET", "/api/v1/dashboard", "", viewer, ""), 200)
	assertStatus(t, request(f.handler, "DELETE", "/api/v1/streams/new", "", viewer, viewerCSRF), 403)
	operator, opCSRF := login(t, f, "operator")
	assertStatus(t, request(f.handler, "PATCH", "/api/v1/streams/new", `{"record":true}`, operator, opCSRF), 403)
	assertStatus(t, request(f.handler, "DELETE", "/api/v1/connections/srt/11111111-1111-4111-8111-111111111111", "", operator, opCSRF), 200)
	cross := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"test-password-1234"}`))
	cross.Header.Set("Content-Type", "application/json")
	cross.Header.Set("Origin", "https://evil.invalid")
	cw := httptest.NewRecorder()
	f.handler.ServeHTTP(cw, cross)
	assertStatus(t, cw, 403)
	assertStatus(t, request(f.handler, "POST", "/api/v1/auth/logout", "", admin, csrf), 200)
	assertStatus(t, request(f.handler, "GET", "/api/v1/auth/me", "", admin, ""), 401)
	logs, _, err := f.db.Audits(context.Background(), 1, 100)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, a := range logs {
		if a.Outcome == "success" {
			found[a.Action] = true
		}
	}
	for _, action := range []string{"login", "logout", "stream.create", "connection.kick"} {
		if !found[action] {
			t.Errorf("missing audit %s", action)
		}
	}
}
func TestNormalizedModelsFiltersAndPagination(t *testing.T) {
	f := newFixture(t)
	cookie, _ := login(t, f, "admin")
	w := request(f.handler, "GET", "/api/v1/streams?pageSize=1", "", cookie, "")
	assertStatus(t, w, 200)
	var body struct {
		Data       []service.Stream
		Pagination struct{ Total int }
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data) != 1 || body.Pagination.Total != 2 || body.Data[0].Name != "live/camera" || body.Data[0].Tracks[1].Codec != "AAC" {
		t.Fatalf("bad stream normalization: %s", w.Body)
	}
	for _, p := range []string{"/api/v1/streams/live%2Fcamera", "/api/v1/streams/offline"} {
		assertStatus(t, request(f.handler, "GET", p, "", cookie, ""), 200)
	}
	assertStatus(t, request(f.handler, "GET", "/api/v1/streams/missing", "", cookie, ""), 404)
	w = request(f.handler, "GET", "/api/v1/config/paths", "", cookie, "")
	assertStatus(t, w, 200)
	for _, secret := range []string{"password", "token=secret", "runOnReady", "private command"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatalf("leaked %q: %s", secret, w.Body)
		}
	}
	w = request(f.handler, "GET", "/api/v1/connections?protocol=srt&path=live%2Fcamera", "", cookie, "")
	assertStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), `"bytesReceived":100`) || strings.Contains(w.Body.String(), "999") {
		t.Fatal(w.Body)
	}
	w = request(f.handler, "GET", "/api/v1/dashboard", "", cookie, "")
	assertStatus(t, w, 200)
	for _, want := range []string{`"publishers":1`, `"viewers":1`, `"total":2`, `"stale":true`} {
		if !strings.Contains(w.Body.String(), want) {
			t.Fatalf("missing %s: %s", want, w.Body)
		}
	}
	for _, p := range []string{"/api/v1/streams?page=0", "/api/v1/streams?pageSize=201", "/api/v1/streams?page=bad", "/api/v1/connections?protocol=unknown"} {
		assertStatus(t, request(f.handler, "GET", p, "", cookie, ""), 400)
	}
	w = request(f.handler, "GET", "/api/v1/streams?page=99", "", cookie, "")
	assertStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), `"data":[]`) {
		t.Fatal(w.Body)
	}
}
func TestValidationAndUpstreamFailure(t *testing.T) {
	f := newFixture(t)
	cookie, csrf := login(t, f, "admin")
	for _, body := range []string{`{"name":"../escape"}`, `{"name":"x","runOnReady":"command"}`, `{"name":"x","maxReaders":-1}`, `{"name":"x","record":null}`, `{"name":"x","record":"yes"}`, `null`, `{"name":"x"} {}`} {
		assertStatus(t, request(f.handler, "POST", "/api/v1/streams", body, cookie, csrf), 400)
	}
	assertStatus(t, request(f.handler, "PATCH", "/api/v1/streams/x", `{}`, cookie, csrf), 400)
	if f.mutations.Load() != 0 {
		t.Fatal("invalid config reached upstream")
	}
	assertStatus(t, request(f.handler, "POST", "/api/v1/streams", `{"name":"x","source":"publisher","maxReaders":0,"record":false}`, cookie, csrf), 201)
	assertStatus(t, request(f.handler, "DELETE", "/api/v1/streams/missing", "", cookie, csrf), 404)
	f.offline.Store(true)
	assertStatus(t, request(f.handler, "GET", "/healthz", "", nil, ""), 200)
	assertStatus(t, request(f.handler, "GET", "/readyz", "", nil, ""), 503)
	w := request(f.handler, "GET", "/api/v1/dashboard", "", cookie, "")
	assertStatus(t, w, 502)
	if bytes.Contains(w.Body.Bytes(), []byte("secret")) {
		t.Fatal("upstream diagnostic leaked")
	}
	w = request(f.handler, "GET", "/api/v1/instance", "", cookie, "")
	assertStatus(t, w, 200)
	if !strings.Contains(w.Body.String(), `"online":false`) {
		t.Fatal(w.Body)
	}
}
func TestRateLimitAndLoginRotation(t *testing.T) {
	f := newFixture(t)
	first, csrf := login(t, f, "admin")
	next := request(f.handler, "POST", "/api/v1/auth/login", `{"username":"admin","password":"test-password-1234"}`, first, "")
	assertStatus(t, next, 200)
	second := next.Result().Cookies()[0]
	if second.Value == first.Value {
		t.Fatal("session not rotated")
	}
	assertStatus(t, request(f.handler, "GET", "/api/v1/auth/me", "", first, ""), 401)
	assertStatus(t, request(f.handler, "POST", "/api/v1/streams", `{"name":"x"}`, second, csrf), 403)
	for i := 0; i < 8; i++ {
		assertStatus(t, request(f.handler, "POST", "/api/v1/auth/login", `{"username":"bad user","password":"bad"}`, nil, ""), 400)
	}
	assertStatus(t, request(f.handler, "POST", "/api/v1/auth/login", `{"username":"admin","password":"test-password-1234"}`, nil, ""), 429)
}
func TestStaticRootAndAPIFallback(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>UI</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	a := &API{}
	a.config.Server.StaticDir = dir
	for p, status := range map[string]int{"/": 200, "/streams/live": 200, "/.env": 404, "/api/v1/unknown": 404, "/missing.js": 404} {
		r := httptest.NewRequest("GET", p, nil)
		w := httptest.NewRecorder()
		a.static(w, r)
		if w.Code != status {
			t.Errorf("%s: %d want %d", p, w.Code, status)
		}
	}
}
