BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_admin_email_binding (
 admin_id bigint PRIMARY KEY REFERENCES t_admin(id) ON DELETE CASCADE,
 email varchar(254) NOT NULL,
 code_hash char(64) NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts < 5),
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 expires_at DATETIME(6) NOT NULL
);
CREATE INDEX t_platform_admin_email_binding_expiry_idx ON t_platform_admin_email_binding(expires_at);
COMMIT;
