package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCounterLayerResetAndChurn(t *testing.T) {
	b := []byte("paths_inbound_bytes{name=\"live\",state=\"ready\"} 100\npaths_outbound_bytes{name=\"live\"} 200\npaths_bytes_received{name=\"live\"} 100\nrtsp_conns_inbound_bytes{id=\"a\"} 100\npaths_readers{name=\"live\",readerType=\"hlsMuxer\"} 1\nhls_sessions{id=\"x\"} 1\nrtsp_sessions{id=\"y\"} 1\npaths_inbound_frames_in_error{name=\"live\"} 3\n")
	initial, err := parse(b)
	if err != nil {
		t.Fatal(err)
	}
	c := New("", time.Second, time.Second, "", "")
	at := time.Now().UTC()
	c.accept(initial, at)
	first := c.Snapshot()
	if first.BytesReceived != 100 || first.InBitrate != 0 || first.Readers != 1 || first.Sessions != 2 || first.Errors != 3 {
		t.Fatalf("first %+v", first)
	}
	next, err := parse([]byte("paths_inbound_bytes{name=\"live\",state=\"notReady\"} 150\npaths_outbound_bytes{name=\"live\"} 300\n"))
	if err != nil {
		t.Fatal(err)
	}
	c.accept(next, at.Add(2*time.Second))
	if v := c.Snapshot(); v.InBitrate != 200 || v.OutBitrate != 400 || v.BytesReceived != 150 {
		t.Fatalf("delta %+v", v)
	}
	reset, err := parse([]byte("paths_inbound_bytes{name=\"live\"} 10\npaths_outbound_bytes{name=\"live\"} 20\n"))
	if err != nil {
		t.Fatal(err)
	}
	c.accept(reset, at.Add(4*time.Second))
	if v := c.Snapshot(); v.InBitrate != 40 || v.BytesReceived != 160 {
		t.Fatalf("reset %+v", v)
	}
	c.accept(counters{in: map[string]float64{}, out: map[string]float64{}, errors: map[string]float64{}}, at.Add(6*time.Second))
	if v := c.Snapshot(); v.InBitrate != 0 || v.BytesReceived != 160 {
		t.Fatalf("churn %+v", v)
	}
	c.failed()
	if v := c.Snapshot(); !v.Stale || v.InBitrate != 0 {
		t.Fatalf("failure %+v", v)
	}
	c.accept(initial, at.Add(8*time.Second))
	if v := c.Snapshot(); v.Stale || v.InBitrate != 0 || v.BytesReceived != 160 {
		t.Fatalf("recovery %+v", v)
	}
}
func TestLegacyAndMalformedMetrics(t *testing.T) {
	v, err := parse([]byte("paths_bytes_received{name=\"a\"} 80\npaths_bytes_sent{name=\"a\"} 90\n"))
	if err != nil || delta(v.in, nil) != 80 {
		t.Fatalf("legacy %v %+v", err, v)
	}
	for _, v := range []string{"not metrics", "paths_inbound_bytes NaN\npaths_outbound_bytes 0\n", "paths_inbound_bytes -1\npaths_outbound_bytes 0\n", "go_threads 2\n"} {
		if _, err := parse([]byte(v)); err == nil {
			t.Fatalf("accepted malformed metrics %q", v)
		}
	}
}
func TestHTTPCollectionAndStaleness(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/metrics" {
			t.Error(r.URL.Path)
		}
		u, p, _ := r.BasicAuth()
		if u != "panel" || p != "secret" {
			t.Error("missing credentials")
		}
		w.Write([]byte("paths_inbound_bytes 0\npaths_outbound_bytes 0\n"))
	}))
	defer srv.Close()
	c := New(srv.URL, time.Second, time.Second, "panel", "secret")
	c.Sample(context.Background())
	if c.Snapshot().Stale {
		t.Fatal("sample was stale")
	}
	old := time.Now().Add(-4 * time.Second)
	c.snapshot.SampledAt = &old
	if !c.Snapshot().Stale {
		t.Fatal("old sample was fresh")
	}
}
