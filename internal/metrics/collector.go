package metrics

import (
	"bytes"
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	dto "github.com/prometheus/client_model/go"
	"github.com/prometheus/common/expfmt"
	"github.com/prometheus/common/model"
)

type Snapshot struct {
	InBitrate     float64    `json:"inBitrate"`
	OutBitrate    float64    `json:"outBitrate"`
	BytesReceived float64    `json:"bytesReceived"`
	BytesSent     float64    `json:"bytesSent"`
	Readers       int        `json:"readers"`
	Sessions      int        `json:"sessions"`
	Errors        float64    `json:"errors"`
	SampledAt     *time.Time `json:"sampledAt"`
	Stale         bool       `json:"stale"`
	Scope         string     `json:"scope"`
}
type counters struct {
	in, out, errors   map[string]float64
	readers, sessions int
}
type Collector struct {
	mu                           sync.RWMutex
	endpoint, username, password string
	interval                     time.Duration
	http                         *http.Client
	snapshot                     Snapshot
	previous                     *counters
	last                         time.Time
}

func New(endpoint string, interval, timeout time.Duration, username, password string) *Collector {
	if u, err := url.Parse(endpoint); err == nil && (u.Path == "" || u.Path == "/") {
		u.Path = "/metrics"
		endpoint = u.String()
	}
	return &Collector{endpoint: endpoint, username: username, password: password, interval: interval, http: &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, snapshot: Snapshot{Stale: true, Scope: "path-payload"}}
}
func (c *Collector) Run(ctx context.Context) {
	c.Sample(ctx)
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.Sample(ctx)
		}
	}
}
func (c *Collector) Snapshot() Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	s := c.snapshot
	if s.SampledAt == nil || time.Since(*s.SampledAt) > 3*c.interval {
		s.Stale = true
		s.InBitrate = 0
		s.OutBitrate = 0
	}
	return s
}
func (c *Collector) Sample(ctx context.Context) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.endpoint, nil)
	if err != nil {
		c.failed()
		return
	}
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.failed()
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		c.failed()
		return
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 8<<20+1))
	if err != nil || len(b) > 8<<20 {
		c.failed()
		return
	}
	sample, err := parse(b)
	if err != nil {
		c.failed()
		return
	}
	c.accept(sample, time.Now().UTC())
}
func (c *Collector) failed() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.snapshot.Stale = true
	c.snapshot.InBitrate = 0
	c.snapshot.OutBitrate = 0
	c.previous = nil
}
func delta(now, previous map[string]float64) float64 {
	v := float64(0)
	for key, n := range now {
		p, ok := previous[key]
		if !ok || n < p {
			v += n
		} else {
			v += n - p
		}
	}
	return v
}
func (c *Collector) accept(now counters, at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	in, out, errs := float64(0), float64(0), float64(0)
	if c.previous != nil {
		in = delta(now.in, c.previous.in)
		out = delta(now.out, c.previous.out)
		errs = delta(now.errors, c.previous.errors)
		dt := at.Sub(c.last).Seconds()
		if dt > 0 {
			c.snapshot.InBitrate = in * 8 / dt
			c.snapshot.OutBitrate = out * 8 / dt
		}
	} else {
		c.snapshot.InBitrate = 0
		c.snapshot.OutBitrate = 0
		if c.snapshot.SampledAt == nil {
			in = delta(now.in, nil)
			out = delta(now.out, nil)
			errs = delta(now.errors, nil)
		}
	}
	c.snapshot.BytesReceived += in
	c.snapshot.BytesSent += out
	c.snapshot.Errors += errs
	c.snapshot.Readers = now.readers
	c.snapshot.Sessions = now.sessions
	c.snapshot.SampledAt = &at
	c.snapshot.Stale = false
	c.previous = &now
	c.last = at
}
func value(m *dto.Metric) float64 {
	if m.Counter != nil {
		return m.Counter.GetValue()
	}
	if m.Gauge != nil {
		return m.Gauge.GetValue()
	}
	return m.Untyped.GetValue()
}
func key(m *dto.Metric) string {
	labels := []string{}
	for _, l := range m.Label {
		if l.GetName() != "state" {
			labels = append(labels, l.GetName()+"="+l.GetValue())
		}
	}
	sort.Strings(labels)
	return strings.Join(labels, "\x00")
}
func parse(b []byte) (counters, error) {
	parser := expfmt.NewTextParser(model.UTF8Validation)
	families, err := parser.TextToMetricFamilies(bytes.NewReader(b))
	if err != nil {
		return counters{}, err
	}
	c := counters{in: map[string]float64{}, out: map[string]float64{}, errors: map[string]float64{}}
	// Select one layer and one counter generation; summing path + session +
	// connection bytes would count the same payload multiple times.
	inbound, outbound := "paths_inbound_bytes", "paths_outbound_bytes"
	if families[inbound] == nil {
		inbound = "paths_bytes_received"
	}
	if families[outbound] == nil {
		outbound = "paths_bytes_sent"
	}
	if families[inbound] == nil || families[outbound] == nil {
		return c, errors.New("path byte counters missing")
	}
	for name, family := range families {
		for _, m := range family.Metric {
			v := value(m)
			if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
				return c, errors.New("invalid metric value")
			}
			switch name {
			case inbound:
				c.in[key(m)] += v
			case outbound:
				c.out[key(m)] += v
			case "paths_inbound_frames_in_error":
				c.errors[key(m)] += v
			case "paths_readers":
				c.readers += int(v)
			case "srt_conns", "hls_sessions", "webrtc_sessions", "rtsp_sessions", "rtsps_sessions", "rtmp_conns", "rtmps_conns":
				c.sessions += int(v)
			}
		}
	}
	return c, nil
}
