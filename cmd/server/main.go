package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/mediamtx-control/mediamtx-control/internal/api"
	"github.com/mediamtx-control/mediamtx-control/internal/auth"
	"github.com/mediamtx-control/mediamtx-control/internal/config"
	"github.com/mediamtx-control/mediamtx-control/internal/mediamtx"
	"github.com/mediamtx-control/mediamtx-control/internal/metrics"
	"github.com/mediamtx-control/mediamtx-control/internal/service"
	"github.com/mediamtx-control/mediamtx-control/internal/store/sqlite"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	cfgPath := flag.String("config", "", "optional YAML configuration file")
	createUser := flag.String("create-user", "", "create a local user and exit; password from MTXUI_USER_PASSWORD")
	role := flag.String("role", "viewer", "role for -create-user: admin, operator, viewer")
	healthcheck := flag.Bool("healthcheck", false, "probe local /healthz and exit (container health check)")
	flag.Parse()
	cfg, err := config.Load(*cfgPath)
	if err != nil {
		return err
	}
	if *healthcheck {
		client := http.Client{Timeout: 3 * time.Second}
		address := cfg.Server.Listen
		if len(address) > 0 && address[0] == ':' {
			address = "127.0.0.1" + address
		}
		resp, err := client.Get("http://" + address + "/healthz")
		if err != nil {
			return errors.New("health check failed")
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return errors.New("health check failed")
		}
		return nil
	}
	db, err := sqlite.Open(cfg.Database.Path)
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *createUser != "" {
		if !auth.ValidUsername(*createUser) || !auth.ValidRole(*role) {
			return errors.New("invalid username or role")
		}
		password := os.Getenv("MTXUI_USER_PASSWORD")
		os.Unsetenv("MTXUI_USER_PASSWORD")
		hash, err := auth.HashPassword(password)
		if err != nil {
			return err
		}
		if err = db.CreateUser(ctx, *createUser, hash, *role); err != nil {
			return err
		}
		slog.Info("user created", "username", *createUser, "role", *role)
		return nil
	}
	count, err := db.UserCount(ctx)
	if err != nil {
		return err
	}
	if count == 0 {
		password := os.Getenv("MTXUI_BOOTSTRAP_PASSWORD")
		if password == "" {
			return errors.New("no users exist: set MTXUI_BOOTSTRAP_PASSWORD (12+ bytes) or run -create-user admin -role admin")
		}
		username := os.Getenv("MTXUI_BOOTSTRAP_USERNAME")
		if username == "" {
			username = "admin"
		}
		if !auth.ValidUsername(username) {
			return errors.New("invalid bootstrap username")
		}
		hash, err := auth.HashPassword(password)
		if err != nil {
			return err
		}
		if err = db.CreateUser(ctx, username, hash, "admin"); err != nil {
			return err
		}
		slog.Info("bootstrap administrator created", "username", username)
	}
	os.Unsetenv("MTXUI_BOOTSTRAP_PASSWORD")
	client := mediamtx.New(cfg.MediaMTX.URL, cfg.MediaMTX.Timeout, cfg.MediaMTX.Username, cfg.MediaMTX.Password)
	collector := metrics.New(cfg.Metrics.URL, cfg.Metrics.Interval, cfg.MediaMTX.Timeout, cfg.Metrics.Username, cfg.Metrics.Password)
	svc := &service.Service{MTX: client, Metrics: collector}
	handler, err := api.New(cfg, svc, db)
	if err != nil {
		return err
	}
	background, stopBackground := context.WithCancel(ctx)
	defer stopBackground()
	done := make(chan struct{})
	go func() { defer close(done); collector.Run(background) }()
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-background.Done():
				return
			case <-ticker.C:
				if err := db.Cleanup(background); err != nil && !errors.Is(err, context.Canceled) {
					slog.Error("session cleanup failed", "error", err)
				}
			}
		}
	}()
	server := &http.Server{Addr: cfg.Server.Listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	serverErr := make(chan error, 1)
	go func() { serverErr <- server.ListenAndServe() }()
	slog.Info("listening", "address", cfg.Server.Listen, "secureCookie", cfg.Auth.SecureCookie)
	var serveErr error
	select {
	case <-ctx.Done():
	case serveErr = <-serverErr:
	}
	stopBackground()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err = server.Shutdown(shutdown); err != nil {
		server.Close()
		slog.Error("graceful shutdown timed out")
	}
	<-done
	<-cleanupDone
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		return fmt.Errorf("listen: %w", serveErr)
	}
	return nil
}
