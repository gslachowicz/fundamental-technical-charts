CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, created TEXT NOT NULL, failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, verify_token TEXT, verify_sent INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS user_data (user_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, confirmed INTEGER NOT NULL DEFAULT 0, unsub INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL, created INTEGER NOT NULL);
-- 2026-10: email verification, price alerts and site notifications (see migrate-2026-10-alerts.sql to update an existing database)
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, level REAL, ma TEXT, dir TEXT NOT NULL, note TEXT, email INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, fired INTEGER, fired_px REAL, fired_level REAL);
CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS alerts_open ON alerts(fired);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, alert_id INTEGER, symbol TEXT, msg TEXT NOT NULL, created INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, emailed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, created);
