package audit

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/mediamtx-control/mediamtx-control/internal/store/sqlite"
)

func TestAuditSurvivesRequestCancellation(t *testing.T) {
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	l := Logger{Store: db}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sentinel := errors.New("upstream failed")
	err = l.Run(ctx, "admin", "stream.update", "live", "127.0.0.1", func() error { cancel(); return sentinel })
	if !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	entries, total, err := db.Audits(context.Background(), 1, 50)
	if err != nil || total != 1 || entries[0].Outcome != "failure" {
		t.Fatalf("completion lost: %+v %v", entries, err)
	}
	called := false
	err = l.Run(ctx, "admin", "stream.delete", "live", "127.0.0.1", func() error { called = true; return nil })
	if err == nil || called {
		t.Fatal("mutation ran without persisted audit intent")
	}
}
