package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/mediamtx-control/mediamtx-control/migrations"
	_ "modernc.org/sqlite"
)

type Store struct{ db *sql.DB }
type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	Role         string `json:"role"`
	PasswordHash string `json:"-"`
}
type Session struct {
	User      User
	CSRF      string
	ExpiresAt time.Time
}
type Audit struct {
	ID       int64  `json:"id"`
	User     string `json:"user"`
	Action   string `json:"action"`
	Resource string `json:"resource"`
	Time     string `json:"time"`
	IP       string `json:"ip"`
	Outcome  string `json:"outcome"`
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if _, err = db.Exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;"); err != nil {
		db.Close()
		return nil, err
	}
	if err = s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) migrate() error {
	if _, err := s.db.Exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)"); err != nil {
		return err
	}
	files, err := migrations.Files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, f := range files {
		var n int
		if err = s.db.QueryRow("SELECT count(*) FROM schema_migrations WHERE name=?", f.Name()).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			continue
		}
		body, err := migrations.Files.ReadFile(f.Name())
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err = tx.Exec(string(body)); err == nil {
			_, err = tx.Exec("INSERT INTO schema_migrations(name) VALUES(?)", f.Name())
		}
		if err != nil {
			tx.Rollback()
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) Close() error                   { return s.db.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *Store) User(ctx context.Context, username string) (User, error) {
	var u User
	err := s.db.QueryRowContext(ctx, "SELECT id,username,password_hash,role FROM users WHERE username=?", username).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role)
	return u, err
}
func (s *Store) UserCount(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&n)
	return n, err
}
func (s *Store) CreateUser(ctx context.Context, username, hash, role string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)", username, hash, role, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO audit_logs(username,action,resource,time,ip,outcome) VALUES('cli','user.create',?,?, 'local','success')", username, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) CreateSession(ctx context.Context, hash string, userID int64, csrf string, expires time.Time, a Audit) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<=?", time.Now().Unix()); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)", hash, userID, csrf, expires.Unix()); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "INSERT INTO audit_logs(username,action,resource,time,ip,outcome) VALUES(?,?,?,?,?,?)", a.User, a.Action, a.Resource, time.Now().UTC().Format(time.RFC3339Nano), a.IP, a.Outcome); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Session(ctx context.Context, hash string) (Session, error) {
	var v Session
	var expires int64
	err := s.db.QueryRowContext(ctx, "SELECT u.id,u.username,u.role,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", hash, time.Now().Unix()).Scan(&v.User.ID, &v.User.Username, &v.User.Role, &v.CSRF, &expires)
	v.ExpiresAt = time.Unix(expires, 0)
	return v, err
}
func (s *Store) DeleteSession(ctx context.Context, hash string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash=?", hash)
	return err
}
func (s *Store) Cleanup(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at<=?", time.Now().Unix())
	return err
}
func (s *Store) AddAudit(ctx context.Context, a Audit) (int64, error) {
	r, err := s.db.ExecContext(ctx, "INSERT INTO audit_logs(username,action,resource,time,ip,outcome) VALUES(?,?,?,?,?,?)", a.User, a.Action, a.Resource, time.Now().UTC().Format(time.RFC3339Nano), a.IP, a.Outcome)
	if err != nil {
		return 0, err
	}
	return r.LastInsertId()
}
func (s *Store) FinishAudit(ctx context.Context, id int64, outcome string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE audit_logs SET outcome=? WHERE id=?", outcome, id)
	return err
}
func (s *Store) Audits(ctx context.Context, page, size int) ([]Audit, int, error) {
	var total int
	if err := s.db.QueryRowContext(ctx, "SELECT count(*) FROM audit_logs").Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id,username,action,resource,time,ip,outcome FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?", size, (page-1)*size)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	result := []Audit{}
	for rows.Next() {
		var a Audit
		if err = rows.Scan(&a.ID, &a.User, &a.Action, &a.Resource, &a.Time, &a.IP, &a.Outcome); err != nil {
			return nil, 0, err
		}
		result = append(result, a)
	}
	return result, total, rows.Err()
}
