package api

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mediamtx-control/mediamtx-control/docs"
	"github.com/mediamtx-control/mediamtx-control/internal/audit"
	"github.com/mediamtx-control/mediamtx-control/internal/auth"
	"github.com/mediamtx-control/mediamtx-control/internal/config"
	"github.com/mediamtx-control/mediamtx-control/internal/mediamtx"
	"github.com/mediamtx-control/mediamtx-control/internal/service"
	"github.com/mediamtx-control/mediamtx-control/internal/store/sqlite"
)

const cookieName = "mtxui_session"

type sessionKey struct{}
type API struct {
	service    *service.Service
	store      *sqlite.Store
	config     config.Config
	audit      audit.Logger
	dummyHash  string
	limiter    *loginLimiter
	loginSlots chan struct{}
}

func New(c config.Config, s *service.Service, db *sqlite.Store) (http.Handler, error) {
	hash, err := auth.HashPassword("dummy-password-unusable")
	if err != nil {
		return nil, err
	}
	a := &API{service: s, store: db, config: c, audit: audit.Logger{Store: db}, dummyHash: hash, limiter: &loginLimiter{entries: map[string]loginWindow{}}, loginSlots: make(chan struct{}, 4)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { success(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context()); err != nil {
			failure(w, 503, "NOT_READY", "database unavailable")
			return
		}
		if _, err := s.Instance(r.Context()); err != nil {
			failure(w, 503, "NOT_READY", "MediaMTX unavailable")
			return
		}
		success(w, 200, map[string]string{"status": "ready"})
	})
	mux.HandleFunc("GET /openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/yaml")
		w.Write(docs.OpenAPI)
	})
	mux.HandleFunc("POST /api/v1/auth/login", a.login)
	a.route(mux, "POST /api/v1/auth/logout", "", a.logout)
	a.route(mux, "GET /api/v1/auth/me", "", func(w http.ResponseWriter, r *http.Request) { a.me(w, r, 200) })
	a.route(mux, "GET /api/v1/instance", "instance.read", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.Instance(r.Context())
		if err != nil {
			success(w, 200, service.Instance{Online: false})
			return
		}
		success(w, 200, v)
	})
	a.route(mux, "GET /api/v1/dashboard", "dashboard.read", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.Dashboard(r.Context())
		respond(w, v, err, "RESOURCE")
	})
	a.route(mux, "GET /api/v1/metrics", "metrics.read", func(w http.ResponseWriter, r *http.Request) { success(w, 200, s.Metrics.Snapshot()) })
	a.route(mux, "GET /api/v1/streams", "stream.read", a.streams)
	a.route(mux, "GET /api/v1/streams/{name...}", "stream.read", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.Stream(r.Context(), r.PathValue("name"))
		respond(w, v, err, "STREAM")
	})
	a.route(mux, "POST /api/v1/streams", "stream.create", a.createPath)
	a.route(mux, "PATCH /api/v1/streams/{name...}", "stream.update", a.updatePath)
	a.route(mux, "DELETE /api/v1/streams/{name...}", "stream.delete", a.deletePath)
	a.route(mux, "GET /api/v1/connections", "connection.read", a.connections)
	a.route(mux, "DELETE /api/v1/connections/{protocol}/{id}", "connection.kick", a.kick)
	a.route(mux, "GET /api/v1/config/paths", "config.read", a.pathConfigs)
	a.route(mux, "GET /api/v1/config/paths/{name...}", "config.read", func(w http.ResponseWriter, r *http.Request) {
		v, err := s.PathConfig(r.Context(), r.PathValue("name"))
		respond(w, v, err, "PATH")
	})
	a.route(mux, "POST /api/v1/config/paths", "config.update", a.createPath)
	a.route(mux, "PATCH /api/v1/config/paths/{name...}", "config.update", a.updatePath)
	a.route(mux, "DELETE /api/v1/config/paths/{name...}", "config.update", a.deletePath)
	a.route(mux, "GET /api/v1/audit-logs", "audit.read", a.auditLogs)
	mux.HandleFunc("/", a.static)
	return a.middleware(mux), nil
}
func success(w http.ResponseWriter, status int, v any) {
	writeJSON(w, status, map[string]any{"data": v})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Debug("response write failed")
	}
}
func failure(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}
func respond(w http.ResponseWriter, v any, err error, resource string) {
	if err == nil {
		success(w, 200, v)
		return
	}
	apiError(w, err, resource)
}
func apiError(w http.ResponseWriter, err error, resource string) {
	switch {
	case errors.Is(err, service.ErrValidation):
		failure(w, 400, "VALIDATION_ERROR", "invalid request")
	case errors.Is(err, mediamtx.ErrNotFound):
		failure(w, 404, resource+"_NOT_FOUND", strings.ToLower(resource)+" not found")
	case errors.Is(err, mediamtx.ErrUnsupported):
		failure(w, 409, "PROTOCOL_UNAVAILABLE", "protocol unavailable on this instance")
	case errors.Is(err, mediamtx.ErrRejected):
		failure(w, 422, "CONFIG_REJECTED", "MediaMTX rejected the configuration")
	case errors.Is(err, mediamtx.ErrConflict):
		failure(w, 409, "RESOURCE_CONFLICT", "resource already exists or conflicts")
	case errors.Is(err, mediamtx.ErrUnavailable):
		failure(w, 502, "UPSTREAM_UNAVAILABLE", "MediaMTX unavailable")
	default:
		slog.Error("request failed", "error", err)
		failure(w, 500, "INTERNAL_ERROR", "internal server error")
	}
}
func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mt != "application/json" {
		failure(w, 415, "UNSUPPORTED_MEDIA_TYPE", "application/json required")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	b, err := io.ReadAll(r.Body)
	if err != nil {
		failure(w, 413, "BODY_TOO_LARGE", "request body exceeds 64 KiB")
		return false
	}
	if err = decodeObject(b, dst); err != nil {
		failure(w, 400, "VALIDATION_ERROR", "invalid, duplicate, null or unknown JSON fields")
		return false
	}
	return true
}
func session(r *http.Request) sqlite.Session { return r.Context().Value(sessionKey{}).(sqlite.Session) }
func (a *API) route(m *http.ServeMux, pattern, permission string, h http.HandlerFunc) {
	m.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil || len(c.Value) != 43 {
			failure(w, 401, "UNAUTHENTICATED", "login required")
			return
		}
		s, err := a.store.Session(r.Context(), auth.TokenHash(c.Value))
		if errors.Is(err, sql.ErrNoRows) {
			failure(w, 401, "UNAUTHENTICATED", "session expired or invalid")
			return
		}
		if err != nil {
			apiError(w, err, "")
			return
		}
		if permission != "" && !auth.Allowed(s.User.Role, permission) {
			failure(w, 403, "FORBIDDEN", "permission denied")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.CSRF)) != 1 {
				failure(w, 403, "CSRF_INVALID", "valid CSRF token required")
				return
			}
		}
		h(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, s)))
	})
}
func (a *API) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
		w.Header().Set("Cache-Control", "no-store")
		defer func() {
			if recover() != nil {
				slog.Error("request panic")
				failure(w, 500, "INTERNAL_ERROR", "internal server error")
			}
		}()
		if r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
			origin := r.Header.Get("Origin")
			expected := a.config.Auth.Origin
			if expected == "" {
				scheme := "http"
				if r.TLS != nil {
					scheme = "https"
				}
				expected = scheme + "://" + r.Host
			}
			if (origin != "" && origin != expected) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				failure(w, 403, "ORIGIN_REJECTED", "cross-origin mutation rejected")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
func (a *API) login(w http.ResponseWriter, r *http.Request) {
	if !a.limiter.allow(remoteIP(r), time.Now()) {
		w.Header().Set("Retry-After", "60")
		failure(w, 429, "RATE_LIMITED", "too many login attempts")
		return
	}
	select {
	case a.loginSlots <- struct{}{}:
		defer func() { <-a.loginSlots }()
	default:
		failure(w, 429, "RATE_LIMITED", "too many login attempts")
		return
	}
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !auth.ValidUsername(input.Username) || len(input.Password) > 1024 {
		failure(w, 400, "VALIDATION_ERROR", "invalid username or password length")
		return
	}
	u, err := a.store.User(r.Context(), input.Username)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		apiError(w, err, "")
		return
	}
	hash := u.PasswordHash
	if err != nil {
		hash = a.dummyHash
	}
	valid := auth.VerifyPassword(hash, input.Password)
	if !valid || err != nil {
		if _, e := a.store.AddAudit(r.Context(), sqlite.Audit{User: input.Username, Action: "login", IP: remoteIP(r), Outcome: "failure"}); e != nil {
			apiError(w, e, "")
			return
		}
		failure(w, 401, "INVALID_CREDENTIALS", "invalid username or password")
		return
	}
	token, err := auth.Token()
	if err != nil {
		apiError(w, err, "")
		return
	}
	csrf, err := auth.Token()
	if err != nil {
		apiError(w, err, "")
		return
	}
	expires := time.Now().Add(a.config.Auth.SessionTTL)
	if err = a.store.CreateSession(r.Context(), auth.TokenHash(token), u.ID, csrf, expires, sqlite.Audit{User: u.Username, Action: "login", IP: remoteIP(r), Outcome: "success"}); err != nil {
		apiError(w, err, "")
		return
	}
	if old, e := r.Cookie(cookieName); e == nil {
		if e = a.store.DeleteSession(r.Context(), auth.TokenHash(old.Value)); e != nil {
			apiError(w, e, "")
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: a.config.Auth.SecureCookie, SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: int(a.config.Auth.SessionTTL.Seconds())})
	a.me(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, sqlite.Session{User: u, CSRF: csrf, ExpiresAt: expires})), 200)
}
func (a *API) me(w http.ResponseWriter, r *http.Request, status int) {
	s := session(r)
	p := auth.Permissions(s.User.Role)
	sort.Strings(p)
	success(w, status, map[string]any{"user": s.User, "permissions": p, "csrfToken": s.CSRF, "expiresAt": s.ExpiresAt})
}
func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie(cookieName)
	err := a.audit.Run(r.Context(), session(r).User.Username, "logout", "", remoteIP(r), func() error { return a.store.DeleteSession(r.Context(), auth.TokenHash(c.Value)) })
	if err != nil {
		apiError(w, err, "")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, Secure: a.config.Auth.SecureCookie, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	success(w, 200, map[string]bool{"loggedOut": true})
}
func pagination(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	page, size := 1, 50
	for key, dst := range map[string]*int{"page": &page, "pageSize": &size} {
		if v, ok := r.URL.Query()[key]; ok {
			if len(v) != 1 {
				failure(w, 400, "VALIDATION_ERROR", "invalid pagination")
				return 0, 0, false
			}
			n, err := strconv.Atoi(v[0])
			if err != nil || n < 1 || n > 1000000 {
				failure(w, 400, "VALIDATION_ERROR", "invalid pagination")
				return 0, 0, false
			}
			*dst = n
		}
	}
	if size > 200 {
		failure(w, 400, "VALIDATION_ERROR", "pageSize must be between 1 and 200")
		return 0, 0, false
	}
	return page, size, true
}
func paged[T any](w http.ResponseWriter, items []T, page, size int, meta any) {
	start := min((page-1)*size, len(items))
	end := min(start+size, len(items))
	body := map[string]any{"data": items[start:end], "pagination": map[string]int{"page": page, "pageSize": size, "total": len(items)}}
	if meta != nil {
		body["meta"] = meta
	}
	writeJSON(w, 200, body)
}
func (a *API) streams(w http.ResponseWriter, r *http.Request) {
	page, size, ok := pagination(w, r)
	if !ok {
		return
	}
	v, err := a.service.Streams(r.Context())
	if err != nil {
		apiError(w, err, "STREAM")
		return
	}
	paged(w, v, page, size, nil)
}
func (a *API) pathConfigs(w http.ResponseWriter, r *http.Request) {
	page, size, ok := pagination(w, r)
	if !ok {
		return
	}
	v, err := a.service.PathConfigs(r.Context())
	if err != nil {
		apiError(w, err, "PATH")
		return
	}
	paged(w, v, page, size, nil)
}
func (a *API) connections(w http.ResponseWriter, r *http.Request) {
	page, size, ok := pagination(w, r)
	if !ok {
		return
	}
	v, err := a.service.Connections(r.Context(), r.URL.Query().Get("protocol"), r.URL.Query().Get("path"))
	if err != nil {
		apiError(w, err, "CONNECTION")
		return
	}
	paged(w, v.Items, page, size, map[string]any{"unavailableProtocols": v.UnavailableProtocols})
}
func (a *API) mutation(w http.ResponseWriter, r *http.Request, action, resource, kind string, status int, fn func() error) {
	err := a.audit.Run(r.Context(), session(r).User.Username, action, resource, remoteIP(r), fn)
	if err != nil {
		apiError(w, err, kind)
		return
	}
	success(w, status, map[string]bool{"ok": true})
}
func (a *API) createPath(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
		service.PathPatch
	}
	if !decode(w, r, &input) {
		return
	}
	if !service.ValidName(input.Name) {
		apiError(w, service.ErrValidation, "")
		return
	}
	if input.PathPatch != (service.PathPatch{}) {
		if err := service.ValidatePatch(input.PathPatch); err != nil {
			apiError(w, err, "")
			return
		}
	}
	a.mutation(w, r, "stream.create", input.Name, "STREAM", 201, func() error { return a.service.CreatePath(r.Context(), input.Name, input.PathPatch) })
}
func (a *API) updatePath(w http.ResponseWriter, r *http.Request) {
	var input service.PathPatch
	if !decode(w, r, &input) {
		return
	}
	if err := service.ValidatePatch(input); err != nil {
		apiError(w, err, "")
		return
	}
	name := r.PathValue("name")
	a.mutation(w, r, "stream.update", name, "STREAM", 200, func() error { return a.service.UpdatePath(r.Context(), name, input) })
}
func (a *API) deletePath(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	a.mutation(w, r, "stream.delete", name, "STREAM", 200, func() error { return a.service.DeletePath(r.Context(), name) })
}
func (a *API) kick(w http.ResponseWriter, r *http.Request) {
	p, id := r.PathValue("protocol"), r.PathValue("id")
	a.mutation(w, r, "connection.kick", p+"/"+id, "CONNECTION", 200, func() error { return a.service.Kick(r.Context(), p, id) })
}
func (a *API) auditLogs(w http.ResponseWriter, r *http.Request) {
	page, size, ok := pagination(w, r)
	if !ok {
		return
	}
	v, total, err := a.store.Audits(r.Context(), page, size)
	if err != nil {
		apiError(w, err, "")
		return
	}
	writeJSON(w, 200, map[string]any{"data": v, "pagination": map[string]int{"page": page, "pageSize": size, "total": total}})
}
func (a *API) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
		failure(w, 404, "NOT_FOUND", "endpoint not found")
		return
	}
	if (r.Method != "GET" && r.Method != "HEAD") || a.config.Server.StaticDir == "" {
		failure(w, 404, "NOT_FOUND", "endpoint not found")
		return
	}
	// os.Root confines reads, including symlinks, to the explicitly configured UI directory.
	root, err := os.OpenRoot(a.config.Server.StaticDir)
	if err != nil {
		failure(w, 404, "NOT_FOUND", "frontend unavailable")
		return
	}
	defer root.Close()
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" {
		name = "index.html"
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			failure(w, 404, "NOT_FOUND", "file not found")
			return
		}
	}
	missingPage := false
	f, err := root.Open(name)
	if errors.Is(err, os.ErrNotExist) && path.Ext(name) == "" {
		f, err = root.Open(name + ".html")
		if errors.Is(err, os.ErrNotExist) {
			f, err = root.Open("404.html")
			missingPage = err == nil
			if errors.Is(err, os.ErrNotExist) {
				f, err = root.Open("index.html")
			}
		}
	}
	if err != nil {
		failure(w, 404, "NOT_FOUND", "file not found")
		return
	}
	info, err := f.Stat()
	if err == nil && info.IsDir() {
		f.Close()
		// Next exports segment data in a directory next to route.html.
		f, err = root.Open(name + ".html")
		if errors.Is(err, os.ErrNotExist) {
			f, err = root.Open(path.Join(name, "index.html"))
		}
		if err == nil {
			info, err = f.Stat()
		}
	}
	if err != nil || info.IsDir() {
		if f != nil {
			f.Close()
		}
		failure(w, 404, "NOT_FOUND", "file not found")
		return
	}
	defer f.Close()
	if missingPage {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		io.Copy(w, f)
		return
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

type loginWindow struct {
	since time.Time
	count int
}
type loginLimiter struct {
	mu      sync.Mutex
	entries map[string]loginWindow
}

func (l *loginLimiter) allow(ip string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k, v := range l.entries {
		if now.Sub(v.since) >= time.Minute {
			delete(l.entries, k)
		}
	}
	v, ok := l.entries[ip]
	if !ok {
		if len(l.entries) >= 4096 {
			return false
		}
		v.since = now
	}
	if v.count >= 10 {
		return false
	}
	v.count++
	l.entries[ip] = v
	return true
}
