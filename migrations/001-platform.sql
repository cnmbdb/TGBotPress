BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS t_platform_auth_ticket (
 token_hash char(64) PRIMARY KEY, admin_id bigint NOT NULL REFERENCES t_admin(id),
 device_session_id bigint NOT NULL REFERENCES t_admin_device_session(rid),
 state char(64) NOT NULL, challenge char(64) NOT NULL, expires_at timestamp without time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_auth_ticket_expiry_idx ON t_platform_auth_ticket(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_session (
 token_hash char(64) PRIMARY KEY, admin_id bigint NOT NULL REFERENCES t_admin(id),
 device_session_id bigint NOT NULL REFERENCES t_admin_device_session(rid),
 created_at timestamp without time zone NOT NULL DEFAULT now(), expires_at timestamp without time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_session_expiry_idx ON t_platform_session(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_audit_log (
 id bigserial PRIMARY KEY, admin_id bigint NOT NULL REFERENCES t_admin(id),
 action varchar(100) NOT NULL, resource_id bigint, created_at timestamp without time zone NOT NULL DEFAULT now()
);
ALTER TABLE IF EXISTS public.t_collection_wallet ADD COLUMN IF NOT EXISTS comments character varying(100);
CREATE TABLE IF NOT EXISTS t_platform_security_maintenance (
 task_key varchar(100) PRIMARY KEY, last_run timestamp without time zone NOT NULL
);
ALTER TABLE IF EXISTS public.t_admin_security_settings
 ADD COLUMN IF NOT EXISTS passkey_config jsonb;
ALTER TABLE IF EXISTS public.t_admin
 ADD COLUMN IF NOT EXISTS passkey_user_handle varchar(64);
-- Keep audit history when an administrator account is removed.
ALTER TABLE t_platform_audit_log ALTER COLUMN admin_id DROP NOT NULL;
ALTER TABLE t_platform_audit_log DROP CONSTRAINT IF EXISTS t_platform_audit_log_admin_id_fkey;
ALTER TABLE t_platform_audit_log ADD CONSTRAINT t_platform_audit_log_admin_id_fkey
 FOREIGN KEY (admin_id) REFERENCES t_admin(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS t_admin_passkey (
 rid bigserial PRIMARY KEY,
 admin_id bigint NOT NULL REFERENCES t_admin(id),
 name varchar(80) NOT NULL DEFAULT '我的通行密钥',
 credential_id varchar(1400) NOT NULL UNIQUE,
 public_key bytea NOT NULL,
 user_handle varchar(128) NOT NULL,
 rp_id varchar(253) NOT NULL,
 sign_count bigint NOT NULL DEFAULT 0,
 backup_eligible boolean NOT NULL DEFAULT false,
 created_at timestamp without time zone NOT NULL DEFAULT now(),
 last_used_at timestamp without time zone,
 revoked_at timestamp without time zone
);
CREATE INDEX IF NOT EXISTS t_admin_passkey_admin_active_idx
 ON t_admin_passkey (admin_id, created_at DESC) WHERE revoked_at IS NULL;
COMMIT;
