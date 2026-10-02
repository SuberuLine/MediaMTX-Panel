package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestConfigStrictYAMLAndEnvironment(t *testing.T) {
	f := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(f, []byte("server:\n  listen: ':9090'\nmediamtx:\n  timeout: 3s\n"), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MTXUI_LISTEN", ":7070")
	t.Setenv("MTXUI_SECURE_COOKIE", "false")
	c, err := Load(f)
	if err != nil || c.Server.Listen != ":7070" || c.Auth.SecureCookie || c.MediaMTX.Timeout != 3*time.Second {
		t.Fatalf("config %+v %v", c, err)
	}
	if err = os.WriteFile(f, []byte("server:\n  typo: true\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Load(f); err == nil {
		t.Fatal("unknown YAML field accepted")
	}
	t.Setenv("MTXUI_METRICS_INTERVAL", "0s")
	if _, err = Load(""); err == nil {
		t.Fatal("zero interval accepted")
	}
}
