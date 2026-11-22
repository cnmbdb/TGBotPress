BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_passkey_flow (
  token_hash char(64) PRIMARY KEY,
  purpose varchar(16) NOT NULL CHECK (purpose IN ('register','login')),
  admin_id bigint,
  session_hash char(64),
  origin text NOT NULL,
  settings_hash char(64) NOT NULL,
  challenge varchar(200) NOT NULL,
  user_handle varchar(64),
  password_hash varchar(255),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS t_platform_passkey_flow_expiry_idx ON t_platform_passkey_flow(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_passkey_reauth_attempt (
  admin_id bigint PRIMARY KEY REFERENCES t_admin(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS t_admin_passkey_user_handle_idx ON t_admin(passkey_user_handle) WHERE passkey_user_handle IS NOT NULL;
COMMIT;
