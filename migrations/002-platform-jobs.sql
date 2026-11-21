BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_job_leader (
 task_name varchar(100) PRIMARY KEY,
 owner_id varchar(64) NOT NULL,
 lease_expires_at timestamp without time zone NOT NULL,
 updated_at timestamp without time zone NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS t_platform_job_outbox (
 id bigserial PRIMARY KEY,
 task_name varchar(100) NOT NULL,
 idempotency_key varchar(255) NOT NULL UNIQUE,
 entity_type varchar(80) NOT NULL,
 entity_id varchar(100) NOT NULL,
 bot_rid integer NOT NULL,
 chat_id varchar(100) NOT NULL,
 message_text text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
 next_attempt_at timestamp without time zone NOT NULL DEFAULT now(),
 lock_owner varchar(64),
 locked_until timestamp without time zone,
 last_error_code varchar(80),
 created_at timestamp without time zone NOT NULL DEFAULT now(),
 updated_at timestamp without time zone NOT NULL DEFAULT now(),
 sent_at timestamp without time zone
);
CREATE INDEX IF NOT EXISTS t_platform_job_outbox_pending_idx
 ON t_platform_job_outbox(status,next_attempt_at,id);
CREATE INDEX IF NOT EXISTS t_platform_job_outbox_expired_lease_idx
 ON t_platform_job_outbox(status,locked_until,id);
COMMIT;
