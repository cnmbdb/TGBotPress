BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_auth_ticket (
 token_hash char(64) PRIMARY KEY, admin_id bigint NOT NULL REFERENCES t_admin(id),
 device_session_id bigint NOT NULL REFERENCES t_admin_device_session(rid),
 state char(64) NOT NULL, challenge char(64) NOT NULL, expires_at DATETIME(6) NOT NULL
);
CREATE INDEX t_platform_auth_ticket_expiry_idx ON t_platform_auth_ticket(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_session (
 token_hash char(64) PRIMARY KEY, admin_id bigint NOT NULL REFERENCES t_admin(id),
 device_session_id bigint NOT NULL REFERENCES t_admin_device_session(rid),
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), expires_at DATETIME(6) NOT NULL
);
CREATE INDEX t_platform_session_expiry_idx ON t_platform_session(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_audit_log (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, admin_id bigint NOT NULL REFERENCES t_admin(id),
 action varchar(100) NOT NULL, resource_id bigint, created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE TABLE IF NOT EXISTS t_platform_security_maintenance (
 task_key varchar(100) PRIMARY KEY, last_run DATETIME(6) NOT NULL
);
ALTER TABLE t_admin_security_settings
 ADD COLUMN passkey_config JSON;
ALTER TABLE t_admin
 ADD COLUMN passkey_user_handle varchar(64);
-- Keep audit history when an administrator account is removed.
ALTER TABLE t_platform_audit_log MODIFY admin_id BIGINT NULL;

ALTER TABLE t_platform_audit_log ADD CONSTRAINT t_platform_audit_log_admin_id_fkey
 FOREIGN KEY (admin_id) REFERENCES t_admin(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS t_admin_passkey (
 rid BIGINT AUTO_INCREMENT PRIMARY KEY,
 admin_id bigint NOT NULL REFERENCES t_admin(id),
 name varchar(80) NOT NULL DEFAULT '我的通行密钥',
 credential_id varchar(1400) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 public_key LONGBLOB NOT NULL,
 user_handle varchar(128) NOT NULL,
 rp_id varchar(253) NOT NULL,
 sign_count bigint NOT NULL DEFAULT 0,
 backup_eligible boolean NOT NULL DEFAULT false,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 last_used_at DATETIME(6),
 revoked_at DATETIME(6)
);
ALTER TABLE t_admin_passkey ADD COLUMN active_admin_id BIGINT GENERATED ALWAYS AS (CASE WHEN revoked_at IS NULL THEN admin_id ELSE NULL END) STORED;
CREATE INDEX t_admin_passkey_admin_active_idx ON t_admin_passkey(active_admin_id,created_at DESC);
COMMIT;
