BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_auth_ticket (
 token_hash char(64) PRIMARY KEY, admin_id bigint,
 device_session_id bigint NOT NULL REFERENCES t_admin_device_session(rid),
 state char(64) NOT NULL, challenge char(64) NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_auth_ticket_expiry_idx ON t_platform_auth_ticket(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_session (
 token_hash char(64) PRIMARY KEY, admin_id bigint NOT NULL REFERENCES t_admin(id),
 device_session_id bigint NOT NULL REFERENCES t_admin_device_session(rid),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_session_expiry_idx ON t_platform_session(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id bigint NOT NULL REFERENCES t_admin(id),
 action varchar(100) NOT NULL, resource_id bigint, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS t_platform_security_maintenance (
 task_key varchar(100) PRIMARY KEY, last_run TEXT NOT NULL
);
ALTER TABLE t_admin_security_settings
 ADD COLUMN passkey_config TEXT;
ALTER TABLE t_admin
 ADD COLUMN passkey_user_handle varchar(64);
-- Keep audit history when an administrator account is removed.
CREATE TABLE IF NOT EXISTS t_admin_passkey (
 rid INTEGER PRIMARY KEY AUTOINCREMENT,
 admin_id bigint NOT NULL REFERENCES t_admin(id),
 name varchar(80) NOT NULL DEFAULT '我的通行密钥',
 credential_id varchar(1400) NOT NULL UNIQUE,
 public_key BLOB NOT NULL,
 user_handle varchar(128) NOT NULL,
 rp_id varchar(253) NOT NULL,
 sign_count bigint NOT NULL DEFAULT 0,
 backup_eligible boolean NOT NULL DEFAULT false,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_used_at TEXT,
 revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS t_admin_passkey_admin_active_idx
 ON t_admin_passkey (admin_id, created_at DESC) WHERE revoked_at IS NULL;
COMMIT;
