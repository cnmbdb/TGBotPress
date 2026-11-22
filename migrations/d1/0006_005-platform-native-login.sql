BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_admin_login_rate (
 rate_key char(64) PRIMARY KEY,
 attempts integer NOT NULL DEFAULT 0,
 window_started_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_admin_login_rate_window_idx ON t_platform_admin_login_rate(window_started_at);
CREATE TABLE IF NOT EXISTS t_platform_admin_login_email_code (
 admin_id bigint PRIMARY KEY REFERENCES t_admin(id) ON DELETE CASCADE,
 code_hash char(64) NOT NULL,
 salt char(64) NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 sent_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS t_platform_admin_login_challenge (
 challenge_hash char(64) PRIMARY KEY,
 kind varchar(32) NOT NULL,
 value_hash char(64) NOT NULL DEFAULT '',
 attempts integer NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_admin_login_challenge_expiry_idx ON t_platform_admin_login_challenge(expires_at);
COMMIT;
