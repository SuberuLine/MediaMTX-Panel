CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY,
 username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 csrf_token TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY,
 username TEXT NOT NULL,
 action TEXT NOT NULL,
 resource TEXT NOT NULL,
 time TEXT NOT NULL,
 ip TEXT NOT NULL,
 outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_time ON audit_logs(id DESC);
