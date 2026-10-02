package config

import (
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strconv"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Listen    string `yaml:"listen"`
		StaticDir string `yaml:"staticDir"`
	} `yaml:"server"`
	MediaMTX struct {
		URL      string        `yaml:"url"`
		Timeout  time.Duration `yaml:"timeout"`
		Username string        `yaml:"username"`
		Password string        `yaml:"password"`
	} `yaml:"mediamtx"`
	Metrics struct {
		URL      string        `yaml:"url"`
		Interval time.Duration `yaml:"interval"`
		Username string        `yaml:"username"`
		Password string        `yaml:"password"`
	} `yaml:"metrics"`
	Database struct {
		Path string `yaml:"path"`
	} `yaml:"database"`
	Auth struct {
		SecureCookie bool          `yaml:"secureCookie"`
		SessionTTL   time.Duration `yaml:"sessionTTL"`
		Origin       string        `yaml:"origin"`
	} `yaml:"auth"`
}

func Load(path string) (Config, error) {
	var c Config
	c.Server.Listen = ":8080"
	c.MediaMTX.URL, c.MediaMTX.Timeout = "http://127.0.0.1:9997", 5*time.Second
	c.Metrics.URL, c.Metrics.Interval = "http://127.0.0.1:9998/metrics", 5*time.Second
	c.Database.Path = "./data/app.db"
	c.Auth.SecureCookie, c.Auth.SessionTTL = true, 24*time.Hour
	if path != "" {
		f, err := os.Open(path)
		if err != nil {
			return c, err
		}
		defer f.Close()
		d := yaml.NewDecoder(f)
		d.KnownFields(true)
		if err = d.Decode(&c); err != nil {
			return c, fmt.Errorf("config: %w", err)
		}
		var extra any
		if err = d.Decode(&extra); !errors.Is(err, io.EOF) {
			return c, errors.New("config must contain one YAML document")
		}
	}
	for key, dst := range map[string]*string{
		"MTXUI_LISTEN": &c.Server.Listen, "MTXUI_STATIC_DIR": &c.Server.StaticDir,
		"MTXUI_MEDIAMTX_URL": &c.MediaMTX.URL, "MTXUI_MEDIAMTX_USERNAME": &c.MediaMTX.Username, "MTXUI_MEDIAMTX_PASSWORD": &c.MediaMTX.Password,
		"MTXUI_METRICS_URL": &c.Metrics.URL, "MTXUI_METRICS_USERNAME": &c.Metrics.Username, "MTXUI_METRICS_PASSWORD": &c.Metrics.Password,
		"MTXUI_DATABASE": &c.Database.Path, "MTXUI_ORIGIN": &c.Auth.Origin,
	} {
		if v, ok := os.LookupEnv(key); ok {
			*dst = v
		}
	}
	for key, dst := range map[string]*time.Duration{"MTXUI_MEDIAMTX_TIMEOUT": &c.MediaMTX.Timeout, "MTXUI_METRICS_INTERVAL": &c.Metrics.Interval, "MTXUI_SESSION_TTL": &c.Auth.SessionTTL} {
		if v, ok := os.LookupEnv(key); ok {
			n, err := time.ParseDuration(v)
			if err != nil {
				return c, fmt.Errorf("invalid %s", key)
			}
			*dst = n
		}
	}
	if v, ok := os.LookupEnv("MTXUI_SECURE_COOKIE"); ok {
		n, err := strconv.ParseBool(v)
		if err != nil {
			return c, errors.New("invalid MTXUI_SECURE_COOKIE")
		}
		c.Auth.SecureCookie = n
	}
	if c.Server.Listen == "" || c.Database.Path == "" {
		return c, errors.New("listen and database path are required")
	}
	if c.MediaMTX.Timeout <= 0 || c.MediaMTX.Timeout > time.Minute || c.Metrics.Interval < time.Second || c.Auth.SessionTTL < time.Minute || c.Auth.SessionTTL > 30*24*time.Hour {
		return c, errors.New("invalid timeout, sampling interval or session TTL")
	}
	for _, raw := range []string{c.MediaMTX.URL, c.Metrics.URL} {
		if err := ValidateURL(raw); err != nil {
			return c, err
		}
	}
	if c.Auth.Origin != "" {
		if err := ValidateURL(c.Auth.Origin); err != nil {
			return c, err
		}
		u, _ := url.Parse(c.Auth.Origin)
		if u.Path != "" {
			return c, errors.New("origin must not contain a path or trailing slash")
		}
	}
	return c, nil
}

func ValidateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("URLs must use http(s), without credentials, query or fragment")
	}
	return nil
}
