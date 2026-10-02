package service

import (
	"context"
	"errors"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mediamtx-control/mediamtx-control/internal/mediamtx"
	"github.com/mediamtx-control/mediamtx-control/internal/metrics"
)

var ErrValidation = errors.New("invalid request")

type Service struct {
	MTX     mediamtx.MediaMTXClient
	Metrics *metrics.Collector
}
type Instance struct {
	Online  bool   `json:"online"`
	Version string `json:"version"`
	Uptime  int64  `json:"uptime"`
}
type Track struct {
	Type  string `json:"type"`
	Codec string `json:"codec"`
}
type Stream struct {
	Name       string  `json:"name"`
	Online     bool    `json:"online"`
	SourceType string  `json:"sourceType"`
	Tracks     []Track `json:"tracks"`
	Readers    int     `json:"readers"`
	Configured bool    `json:"configured"`
}
type Connection struct {
	ID            string    `json:"id"`
	Protocol      string    `json:"protocol"`
	Path          string    `json:"path"`
	RemoteAddr    string    `json:"remoteAddr"`
	CreatedAt     time.Time `json:"createdAt"`
	State         string    `json:"state"`
	BytesReceived uint64    `json:"bytesReceived"`
	BytesSent     uint64    `json:"bytesSent"`
}

// Explicit subset: no command hooks, credentials or arbitrary filesystem paths.
type PathConfig struct {
	Name                  string `json:"name"`
	Source                string `json:"source"`
	SourceHasCredentials  bool   `json:"sourceHasCredentials"`
	SourceOnDemand        bool   `json:"sourceOnDemand"`
	MaxReaders            int    `json:"maxReaders"`
	Record                bool   `json:"record"`
	RecordFormat          string `json:"recordFormat"`
	RecordSegmentDuration string `json:"recordSegmentDuration"`
	RecordDeleteAfter     string `json:"recordDeleteAfter"`
	OverridePublisher     bool   `json:"overridePublisher"`
}
type PathPatch struct {
	Source                *string `json:"source,omitempty"`
	SourceOnDemand        *bool   `json:"sourceOnDemand,omitempty"`
	MaxReaders            *int    `json:"maxReaders,omitempty"`
	Record                *bool   `json:"record,omitempty"`
	RecordFormat          *string `json:"recordFormat,omitempty"`
	RecordSegmentDuration *string `json:"recordSegmentDuration,omitempty"`
	RecordDeleteAfter     *string `json:"recordDeleteAfter,omitempty"`
	OverridePublisher     *bool   `json:"overridePublisher,omitempty"`
}
type ConnectionList struct {
	Items                []Connection
	UnavailableProtocols []string
}

func (s *Service) Instance(ctx context.Context) (Instance, error) {
	v, err := s.MTX.GetInfo(ctx)
	if err != nil {
		return Instance{}, err
	}
	uptime := int64(0)
	if !v.Started.IsZero() {
		uptime = max(0, int64(time.Since(v.Started).Seconds()))
	}
	return Instance{Online: true, Version: v.Version, Uptime: uptime}, nil
}
func stream(p mediamtx.Path, configured bool) Stream {
	v := Stream{Name: p.Name, Online: p.Ready, Tracks: []Track{}, Readers: len(p.Readers), Configured: configured}
	if p.Online != nil {
		v.Online = *p.Online
	}
	if p.Source != nil {
		v.SourceType = p.Source.Type
	}
	codecs := p.Tracks
	if p.Tracks2 != nil {
		codecs = []string{}
		for _, t := range p.Tracks2 {
			codecs = append(codecs, t.Codec)
		}
	}
	for _, codec := range codecs {
		kind := "unknown"
		switch codec {
		case "AV1", "VP9", "VP8", "H265", "H264", "MPEG-4 Video", "MPEG-1/2 Video", "M-JPEG":
			kind = "video"
		case "Opus", "FLAC", "Vorbis", "MPEG-4 Audio", "MPEG-4 Audio LATM", "MPEG-1/2 Audio", "AAC", "AC3", "Speex", "G726", "G722", "G711", "LPCM":
			kind = "audio"
		}
		if codec == "MPEG-4 Audio" {
			codec = "AAC"
		}
		v.Tracks = append(v.Tracks, Track{Type: kind, Codec: codec})
	}
	return v
}
func (s *Service) Streams(ctx context.Context) ([]Stream, error) {
	paths, err := s.MTX.ListPaths(ctx)
	if err != nil {
		return nil, err
	}
	configs, err := s.MTX.ListPathConfigs(ctx)
	if err != nil {
		return nil, err
	}
	result := map[string]Stream{}
	for _, c := range configs {
		result[c.Name] = stream(mediamtx.Path{Name: c.Name}, true)
	}
	for _, p := range paths {
		_, configured := result[p.Name]
		result[p.Name] = stream(p, configured)
	}
	out := make([]Stream, 0, len(result))
	for _, v := range result {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
func (s *Service) Stream(ctx context.Context, name string) (Stream, error) {
	if !ValidName(name) {
		return Stream{}, ErrValidation
	}
	p, err := s.MTX.GetPath(ctx, name)
	if err != nil && !errors.Is(err, mediamtx.ErrNotFound) {
		return Stream{}, err
	}
	cfg, cfgErr := s.MTX.GetPathConfig(ctx, name)
	if cfgErr != nil && !errors.Is(cfgErr, mediamtx.ErrNotFound) {
		return Stream{}, cfgErr
	}
	if err == nil {
		return stream(p, cfgErr == nil), nil
	}
	if cfgErr == nil {
		return stream(mediamtx.Path{Name: cfg.Name}, true), nil
	}
	return Stream{}, mediamtx.ErrNotFound
}
func (s *Service) Connections(ctx context.Context, protocol, path string) (ConnectionList, error) {
	ps := mediamtx.Protocols
	if protocol != "" {
		if !mediamtx.ValidProtocol(protocol) {
			return ConnectionList{}, ErrValidation
		}
		ps = []string{protocol}
	}
	type result struct {
		p     string
		items []mediamtx.Connection
		err   error
	}
	ch := make(chan result, len(ps))
	var wg sync.WaitGroup
	for _, p := range ps {
		wg.Add(1)
		go func(p string) { defer wg.Done(); v, e := s.MTX.ListConnections(ctx, p); ch <- result{p, v, e} }(p)
	}
	wg.Wait()
	close(ch)
	out := ConnectionList{Items: []Connection{}, UnavailableProtocols: []string{}}
	for r := range ch {
		if errors.Is(r.err, mediamtx.ErrUnsupported) {
			out.UnavailableProtocols = append(out.UnavailableProtocols, r.p)
			continue
		}
		if r.err != nil {
			return out, r.err
		}
		for _, v := range r.items {
			if path != "" && v.Path != path {
				continue
			}
			in, outBytes := v.BytesReceived, v.BytesSent
			if v.InboundBytes != nil {
				in = *v.InboundBytes
			}
			if v.OutboundBytes != nil {
				outBytes = *v.OutboundBytes
			}
			state := v.State
			if r.p == "hls" {
				state = "read"
			}
			out.Items = append(out.Items, Connection{ID: v.ID, Protocol: r.p, Path: v.Path, RemoteAddr: v.RemoteAddr, CreatedAt: v.Created, State: state, BytesReceived: in, BytesSent: outBytes})
		}
	}
	sort.Strings(out.UnavailableProtocols)
	sort.Slice(out.Items, func(i, j int) bool {
		a, b := out.Items[i], out.Items[j]
		return a.Protocol+"/"+a.ID < b.Protocol+"/"+b.ID
	})
	return out, nil
}

var idPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (s *Service) Kick(ctx context.Context, p, id string) error {
	if !mediamtx.ValidProtocol(p) || !idPattern.MatchString(id) {
		return ErrValidation
	}
	return s.MTX.KickConnection(ctx, p, id)
}

var upstreamDays = regexp.MustCompile(`^(-?[0-9]+)d(.*)$`)

// MediaMTX serializes durations using days and serializes zero as an empty
// string. Our public write contract uses Go durations; return editable values.
func writableDuration(value string) string {
	if value == "" {
		return "0s"
	}
	original := value
	if match := upstreamDays.FindStringSubmatch(value); match != nil {
		days, err := strconv.ParseInt(match[1], 10, 32)
		if err != nil {
			return original
		}
		value = strconv.FormatInt(days*24, 10) + "h" + match[2]
	}
	if duration, err := time.ParseDuration(value); err == nil {
		return duration.String()
	}
	return original
}

func pathConfig(v mediamtx.PathConfig) PathConfig {
	source := v.Source
	secret := false
	u, err := url.Parse(source)
	if err != nil {
		// Do not return a potentially credential-bearing malformed upstream URL.
		source, secret = "", true
	} else if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		secret = true
		u.User = nil
		u.RawQuery = ""
		u.Fragment = ""
		source = u.String()
	}
	return PathConfig{Name: v.Name, Source: source, SourceHasCredentials: secret, SourceOnDemand: v.SourceOnDemand, MaxReaders: v.MaxReaders, Record: v.Record, RecordFormat: v.RecordFormat, RecordSegmentDuration: writableDuration(v.RecordSegmentDuration), RecordDeleteAfter: writableDuration(v.RecordDeleteAfter), OverridePublisher: v.OverridePublisher}
}
func (s *Service) PathConfigs(ctx context.Context) ([]PathConfig, error) {
	v, err := s.MTX.ListPathConfigs(ctx)
	if err != nil {
		return nil, err
	}
	out := []PathConfig{}
	for _, c := range v {
		out = append(out, pathConfig(c))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
func (s *Service) PathConfig(ctx context.Context, n string) (PathConfig, error) {
	if !ValidName(n) {
		return PathConfig{}, ErrValidation
	}
	v, err := s.MTX.GetPathConfig(ctx, n)
	return pathConfig(v), err
}
func ValidName(n string) bool {
	if n == "" || len(n) > 256 || strings.ContainsAny(n, "\\?#%\x00\r\n\t") || strings.TrimSpace(n) != n {
		return false
	}
	for _, r := range n {
		if r < 32 || r == 127 {
			return false
		}
	}
	if strings.HasPrefix(n, "~") {
		_, err := regexp.Compile(n[1:])
		return len(n) > 1 && err == nil
	}
	for _, v := range strings.Split(n, "/") {
		if v == "" || v == "." || v == ".." {
			return false
		}
	}
	return true
}
func ValidatePatch(p PathPatch) error {
	if p == (PathPatch{}) {
		return ErrValidation
	}
	if p.Source != nil {
		v := *p.Source
		if v != "publisher" {
			u, err := url.Parse(v)
			if err != nil || u.Hostname() == "" || u.Fragment != "" || len(v) > 2048 {
				return ErrValidation
			}
			switch u.Scheme {
			case "rtsp", "rtsps", "rtmp", "rtmps", "http", "https", "srt", "udp", "whep", "wheps":
			default:
				return ErrValidation
			}
		}
	}
	if p.MaxReaders != nil && (*p.MaxReaders < 0 || *p.MaxReaders > 1000000) {
		return ErrValidation
	}
	if p.RecordFormat != nil && *p.RecordFormat != "fmp4" && *p.RecordFormat != "mpegts" {
		return ErrValidation
	}
	for _, d := range []*string{p.RecordSegmentDuration, p.RecordDeleteAfter} {
		if d != nil {
			v, err := time.ParseDuration(*d)
			if err != nil || v < 0 || v > 365*24*time.Hour {
				return ErrValidation
			}
		}
	}
	if p.RecordSegmentDuration != nil {
		v, _ := time.ParseDuration(*p.RecordSegmentDuration)
		if v <= 0 {
			return ErrValidation
		}
	}
	return nil
}
func (s *Service) CreatePath(ctx context.Context, n string, p PathPatch) error {
	if !ValidName(n) {
		return ErrValidation
	}
	if p == (PathPatch{}) {
		v := "publisher"
		p.Source = &v
	}
	if err := ValidatePatch(p); err != nil {
		return err
	}
	return s.MTX.AddPathConfig(ctx, n, mediamtx.PathPatch(p))
}
func (s *Service) UpdatePath(ctx context.Context, n string, p PathPatch) error {
	if !ValidName(n) {
		return ErrValidation
	}
	if err := ValidatePatch(p); err != nil {
		return err
	}
	return s.MTX.UpdatePathConfig(ctx, n, mediamtx.PathPatch(p))
}
func (s *Service) DeletePath(ctx context.Context, n string) error {
	if !ValidName(n) {
		return ErrValidation
	}
	return s.MTX.DeletePathConfig(ctx, n)
}

type Dashboard struct {
	Instance Instance `json:"instance"`
	Streams  struct {
		Total  int `json:"total"`
		Online int `json:"online"`
	} `json:"streams"`
	Connections struct {
		Publishers           int      `json:"publishers"`
		Viewers              int      `json:"viewers"`
		Idle                 int      `json:"idle"`
		UnavailableProtocols []string `json:"unavailableProtocols"`
	} `json:"connections"`
	Traffic metrics.Snapshot `json:"traffic"`
}

func (s *Service) Dashboard(ctx context.Context) (Dashboard, error) {
	var d Dashboard
	var err error
	d.Traffic = s.Metrics.Snapshot()
	d.Instance, err = s.Instance(ctx)
	if err != nil {
		return d, err
	}
	streams, err := s.Streams(ctx)
	if err != nil {
		return d, err
	}
	d.Streams.Total = len(streams)
	for _, v := range streams {
		if v.Online {
			d.Streams.Online++
		}
	}
	conns, err := s.Connections(ctx, "", "")
	if err != nil {
		return d, err
	}
	d.Connections.UnavailableProtocols = conns.UnavailableProtocols
	for _, v := range conns.Items {
		switch v.State {
		case "publish":
			d.Connections.Publishers++
		case "read":
			d.Connections.Viewers++
		default:
			d.Connections.Idle++
		}
	}
	return d, nil
}
