BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_access_admin_binding (
  email varchar(320) PRIMARY KEY,
  admin_id bigint NOT NULL UNIQUE REFERENCES t_admin(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT t_platform_access_admin_binding_email_lower CHECK (email=lower(email))
);
CREATE TABLE IF NOT EXISTS t_platform_access_session (
  token_hash char(64) PRIMARY KEY,
  admin_id bigint NOT NULL REFERENCES t_admin(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_access_session_expiry_idx ON t_platform_access_session(expires_at);
COMMIT;
