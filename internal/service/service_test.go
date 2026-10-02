package service

import (
	"strings"
	"testing"

	"github.com/mediamtx-control/mediamtx-control/internal/mediamtx"
)

func TestSourceSecretsAreRedacted(t *testing.T) {
	for _, source := range []string{"rtsp://user:secret@camera/live?token=secret", "rtsp://user:%zz@camera/live", "https://camera/live#secret"} {
		cfg := pathConfig(mediamtx.PathConfig{Source: source})
		if !cfg.SourceHasCredentials || strings.Contains(cfg.Source, "secret") || strings.Contains(cfg.Source, "user:") {
			t.Fatalf("source not redacted: %+v", cfg)
		}
	}
}

func TestStreamTrackCompatibility(t *testing.T) {
	online := false
	p := mediamtx.Path{Name: "live", Online: &online, Ready: true, Tracks: []string{"H264", "MPEG-4 Audio", "KLV"}}
	s := stream(p, true)
	if s.Online || s.Tracks[0].Type != "video" || s.Tracks[1].Codec != "AAC" || s.Tracks[2].Type != "unknown" {
		t.Fatalf("unexpected stream %+v", s)
	}
}
func TestValidation(t *testing.T) {
	for _, v := range []string{"live", "live/camera", "all_others", "~^camera/[a-z]+$"} {
		if !ValidName(v) {
			t.Errorf("rejected %q", v)
		}
	}
	for _, v := range []string{"", "../x", "live/../x", "/live", "live/", "bad?query", "live\\x", "~["} {
		if ValidName(v) {
			t.Errorf("accepted %q", v)
		}
	}
	for _, v := range []string{"file:///etc/passwd", "javascript:alert(1)", "rtsp://", "http://example.com/#x"} {
		if ValidatePatch(PathPatch{Source: &v}) == nil {
			t.Errorf("accepted source %q", v)
		}
	}
	for _, v := range []string{"publisher", "rtsp://user:secret@camera/live", "srt://camera:9000"} {
		if ValidatePatch(PathPatch{Source: &v}) != nil {
			t.Errorf("rejected source %q", v)
		}
	}
}
