BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_telegram_update (
 rid INTEGER PRIMARY KEY AUTOINCREMENT,
 bot_rid integer NOT NULL,
 update_id bigint NOT NULL,
 update_body TEXT NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed','ignored')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_owner varchar(64),
 lease_until TEXT,
 received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 processed_at TEXT,
 expires_at TEXT NOT NULL DEFAULT (datetime('now','+7 day')),
 last_error_code varchar(80),
 UNIQUE (bot_rid, update_id)
);
CREATE INDEX IF NOT EXISTS t_platform_telegram_update_pending_idx
 ON t_platform_telegram_update(status,next_attempt_at,rid)
 WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS t_platform_telegram_update_expiry_idx
 ON t_platform_telegram_update(expires_at);
COMMIT;
