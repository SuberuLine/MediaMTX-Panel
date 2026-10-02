package mediamtx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrNotFound = errors.New("upstream resource not found")
var ErrUnavailable = errors.New("upstream unavailable")
var ErrRejected = errors.New("upstream rejected configuration")
var ErrUnsupported = errors.New("protocol unavailable")
var ErrConflict = errors.New("resource conflict")

type MediaMTXClient interface {
	GetInfo(context.Context) (Info, error)
	ListPaths(context.Context) ([]Path, error)
	GetPath(context.Context, string) (Path, error)
	ListConnections(context.Context, string) ([]Connection, error)
	KickConnection(context.Context, string, string) error
	ListPathConfigs(context.Context) ([]PathConfig, error)
	GetPathConfig(context.Context, string) (PathConfig, error)
	AddPathConfig(context.Context, string, PathPatch) error
	UpdatePathConfig(context.Context, string, PathPatch) error
	DeletePathConfig(context.Context, string) error
}

var protocols = map[string]string{"srt": "srt/conns", "hls": "hls/sessions", "webrtc": "webrtc/sessions", "rtsp": "rtsp/sessions", "rtsps": "rtsps/sessions", "rtmp": "rtmp/conns", "rtmps": "rtmps/conns"}
var Protocols = []string{"srt", "hls", "webrtc", "rtsp", "rtsps", "rtmp", "rtmps"}

func ValidProtocol(p string) bool { _, ok := protocols[p]; return ok }

type Client struct {
	base               string
	http               *http.Client
	username, password string
}

func New(base string, timeout time.Duration, username, password string) *Client {
	return &Client{base: strings.TrimRight(base, "/"), http: &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, username: username, password: password}
}
func (c *Client) request(ctx context.Context, method, path string, body, out any) error {
	var payload io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+"/v3/"+path, payload)
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.username != "" {
		req.SetBasicAuth(c.username, c.password)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case 404:
		return ErrNotFound
	case 400, 422:
		return ErrRejected
	case 409:
		return ErrConflict
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ErrUnavailable
	}
	if out == nil {
		return nil
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 8<<20+1))
	if err != nil || len(b) > 8<<20 {
		return ErrUnavailable
	}
	if err = json.Unmarshal(b, out); err != nil {
		return ErrUnavailable
	}
	return nil
}
func list[T any](ctx context.Context, c *Client, path string) ([]T, error) {
	out := []T{}
	for page := 0; page < 10000; page++ {
		var v struct {
			PageCount int `json:"pageCount"`
			Items     []T `json:"items"`
		}
		if err := c.request(ctx, http.MethodGet, path+"?itemsPerPage=1000&page="+strconv.Itoa(page), nil, &v); err != nil {
			return nil, err
		}
		out = append(out, v.Items...)
		if len(out) > 100000 {
			return nil, ErrUnavailable
		}
		if page+1 >= v.PageCount {
			return out, nil
		}
	}
	return nil, ErrUnavailable
}
func (c *Client) GetInfo(ctx context.Context) (Info, error) {
	var v Info
	err := c.request(ctx, "GET", "info", nil, &v)
	return v, err
}
func (c *Client) ListPaths(ctx context.Context) ([]Path, error) {
	return list[Path](ctx, c, "paths/list")
}
func (c *Client) GetPath(ctx context.Context, n string) (Path, error) {
	var v Path
	err := c.request(ctx, "GET", "paths/get/"+url.PathEscape(n), nil, &v)
	return v, err
}
func (c *Client) ListPathConfigs(ctx context.Context) ([]PathConfig, error) {
	return list[PathConfig](ctx, c, "config/paths/list")
}
func (c *Client) GetPathConfig(ctx context.Context, n string) (PathConfig, error) {
	var v PathConfig
	err := c.request(ctx, "GET", "config/paths/get/"+url.PathEscape(n), nil, &v)
	return v, err
}
func (c *Client) AddPathConfig(ctx context.Context, n string, p PathPatch) error {
	return c.request(ctx, "POST", "config/paths/add/"+url.PathEscape(n), p, nil)
}
func (c *Client) UpdatePathConfig(ctx context.Context, n string, p PathPatch) error {
	return c.request(ctx, "PATCH", "config/paths/patch/"+url.PathEscape(n), p, nil)
}
func (c *Client) DeletePathConfig(ctx context.Context, n string) error {
	return c.request(ctx, "DELETE", "config/paths/delete/"+url.PathEscape(n), nil, nil)
}
func (c *Client) ListConnections(ctx context.Context, p string) ([]Connection, error) {
	endpoint, ok := protocols[p]
	if !ok {
		return nil, ErrUnsupported
	}
	v, err := list[Connection](ctx, c, endpoint+"/list")
	if errors.Is(err, ErrNotFound) {
		err = ErrUnsupported
	}
	return v, err
}
func (c *Client) KickConnection(ctx context.Context, p, id string) error {
	endpoint, ok := protocols[p]
	if !ok {
		return ErrUnsupported
	}
	if id == "" {
		return fmt.Errorf("empty connection id")
	}
	return c.request(ctx, "POST", endpoint+"/kick/"+url.PathEscape(id), nil, nil)
}
