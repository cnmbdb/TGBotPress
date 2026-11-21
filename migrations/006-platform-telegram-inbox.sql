BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_telegram_update (
 rid bigserial PRIMARY KEY,
 bot_rid integer NOT NULL,
 update_id bigint NOT NULL,
 update_body jsonb NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 next_attempt_at timestamp without time zone NOT NULL DEFAULT now(),
 lease_owner varchar(64),
 lease_until timestamp without time zone,
 received_at timestamp without time zone NOT NULL DEFAULT now(),
 processed_at timestamp without time zone,
 expires_at timestamp without time zone NOT NULL DEFAULT (now() + interval '7 days'),
 last_error_code varchar(80),
 UNIQUE (bot_rid, update_id)
);
CREATE INDEX IF NOT EXISTS t_platform_telegram_update_pending_idx
 ON t_platform_telegram_update(status,next_attempt_at,rid)
 WHERE status IN ('pending','processing');
CREATE INDEX IF NOT EXISTS t_platform_telegram_update_expiry_idx
 ON t_platform_telegram_update(expires_at);
COMMIT;
