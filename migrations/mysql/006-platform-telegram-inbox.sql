BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_telegram_update (
 rid BIGINT AUTO_INCREMENT PRIMARY KEY,
 bot_rid integer NOT NULL,
 update_id bigint NOT NULL,
 update_body JSON NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed','ignored')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 lease_owner varchar(64),
 lease_until DATETIME(6),
 received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 processed_at DATETIME(6),
 expires_at DATETIME(6) NOT NULL DEFAULT (CURRENT_TIMESTAMP(6) + INTERVAL 7 day),
 last_error_code varchar(80),
 UNIQUE (bot_rid, update_id)
);
CREATE INDEX t_platform_telegram_update_pending_idx
 ON t_platform_telegram_update(status,next_attempt_at,rid);
CREATE INDEX t_platform_telegram_update_expiry_idx
 ON t_platform_telegram_update(expires_at);
COMMIT;
