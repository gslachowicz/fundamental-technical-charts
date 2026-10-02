-- Run once in Cloudflare > D1 > tickerandtape > Console (paste everything and Execute).
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN verify_token TEXT;
ALTER TABLE users ADD COLUMN verify_sent INTEGER NOT NULL DEFAULT 0;
UPDATE users SET verified = 1;
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, symbol TEXT NOT NULL, kind TEXT NOT NULL, level REAL, ma TEXT, dir TEXT NOT NULL, note TEXT, email INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, fired INTEGER, fired_px REAL, fired_level REAL);
CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user_id);
CREATE INDEX IF NOT EXISTS alerts_open ON alerts(fired);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, alert_id INTEGER, symbol TEXT, msg TEXT NOT NULL, created INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, emailed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, created);
