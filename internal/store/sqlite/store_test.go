package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestPersistenceExpiryAndAudit(t *testing.T) {
	file := filepath.Join(t.TempDir(), "app.db")
	db, err := Open(file)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err = db.CreateUser(ctx, "admin", "encoded-hash", "admin"); err != nil {
		t.Fatal(err)
	}
	u, err := db.User(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.CreateSession(ctx, "hash", u.ID, "csrf", time.Now().Add(time.Hour), Audit{User: "admin", Action: "login", Outcome: "success"}); err != nil {
		t.Fatal(err)
	}
	if err = db.CreateSession(ctx, "expired", u.ID, "csrf", time.Now().Add(-time.Hour), Audit{User: "admin", Action: "login", Outcome: "success"}); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Session(ctx, "expired"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("expired session %v", err)
	}
	db.Close()
	db, err = Open(file)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, err := db.Session(ctx, "hash")
	if err != nil || s.User.Username != "admin" || s.User.PasswordHash != "" {
		t.Fatalf("persisted session: %+v %v", s, err)
	}
	logs, total, err := db.Audits(ctx, 1, 2)
	if err != nil || total != 3 || len(logs) != 2 {
		t.Fatalf("audit: %+v total=%d %v", logs, total, err)
	}
	if err = db.DeleteSession(ctx, "hash"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Session(ctx, "hash"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if err = db.CreateUser(ctx, "admin", "hash", "viewer"); err == nil {
		t.Fatal("duplicate user accepted")
	}
}
