BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_access_admin_binding (
  email varchar(320) PRIMARY KEY,
  admin_id bigint NOT NULL UNIQUE REFERENCES t_admin(id) ON DELETE CASCADE,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT t_platform_access_admin_binding_email_lower CHECK (email=lower(email))
);
CREATE TABLE IF NOT EXISTS t_platform_access_session (
  token_hash char(64) PRIMARY KEY,
  admin_id bigint NOT NULL REFERENCES t_admin(id) ON DELETE CASCADE,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp without time zone NOT NULL DEFAULT now(),
  expires_at timestamp without time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_access_session_expiry_idx ON t_platform_access_session(expires_at);
COMMIT;
