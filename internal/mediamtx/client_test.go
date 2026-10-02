package mediamtx

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPaginationEscapingAndAuth(t *testing.T) {
	var calls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, p, ok := r.BasicAuth()
		if !ok || u != "panel" || p != "secret" {
			t.Error("missing upstream credentials")
		}
		switch r.URL.Path {
		case "/v3/paths/list":
			calls++
			if r.URL.Query().Get("itemsPerPage") != "1000" {
				t.Error("missing page size")
			}
			fmt.Fprintf(w, `{"pageCount":2,"items":[{"name":"page-%s"}]}`, r.URL.Query().Get("page"))
		case "/v3/config/paths/add/live/camera":
			if r.Method != "POST" || !strings.Contains(r.RequestURI, "live%2Fcamera") {
				t.Errorf("bad escaping: %s %s", r.Method, r.RequestURI)
			}
			w.Write([]byte(`{"status":"ok"}`))
		default:
			t.Errorf("unexpected endpoint %s", r.URL)
			w.WriteHeader(404)
		}
	}))
	defer upstream.Close()
	c := New(upstream.URL, time.Second, "panel", "secret")
	paths, err := c.ListPaths(context.Background())
	if err != nil || len(paths) != 2 || calls != 2 || paths[1].Name != "page-1" {
		t.Fatalf("pagination: %v %+v calls=%d", err, paths, calls)
	}
	source := "publisher"
	if err = c.AddPathConfig(context.Background(), "live/camera", PathPatch{Source: &source}); err != nil {
		t.Fatal(err)
	}
}
func TestProtocolEndpointsAndErrors(t *testing.T) {
	for _, p := range Protocols {
		t.Run(p, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				expected := "/v3/" + protocols[p]
				switch r.Method {
				case "GET":
					if r.URL.Path != expected+"/list" {
						t.Error(r.URL.Path)
					}
					w.Write([]byte(`{"pageCount":1,"items":[]}`))
				case "POST":
					if r.URL.Path != expected+"/kick/id" {
						t.Error(r.URL.Path)
					}
				default:
					t.Error(r.Method)
				}
			}))
			defer srv.Close()
			c := New(srv.URL, time.Second, "", "")
			if _, e := c.ListConnections(context.Background(), p); e != nil {
				t.Fatal(e)
			}
			if e := c.KickConnection(context.Background(), p, "id"); e != nil {
				t.Fatal(e)
			}
		})
	}
	for status, want := range map[int]error{404: ErrNotFound, 400: ErrRejected, 401: ErrUnavailable, 500: ErrUnavailable} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				w.Write([]byte("secret upstream diagnostic"))
			}))
			defer srv.Close()
			_, err := New(srv.URL, time.Second, "", "").GetInfo(context.Background())
			if !errors.Is(err, want) || strings.Contains(err.Error(), "secret") {
				t.Fatalf("error %v", err)
			}
		})
	}
}
func TestRedirectAndTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "http://example.invalid/", 302) }))
	defer srv.Close()
	if _, err := New(srv.URL, time.Second, "secret", "secret").GetInfo(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer slow.Close()
	if _, err := New(slow.URL, 20*time.Millisecond, "", "").GetInfo(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
}
