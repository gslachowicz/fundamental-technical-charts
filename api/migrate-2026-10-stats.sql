-- Run once in Cloudflare > D1 > tickerandtape > Console (paste everything and Execute).
-- Control panel: daily active users and anonymous visit statistics (no IPs or identifiers are stored).
ALTER TABLE users ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS user_active (day TEXT NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (day, user_id));
CREATE TABLE IF NOT EXISTS stats_daily (day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key));
CREATE TABLE IF NOT EXISTS visitors (day TEXT NOT NULL, vh TEXT NOT NULL, PRIMARY KEY (day, vh));
