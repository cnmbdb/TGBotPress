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
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at DATETIME(6) NOT NULL
);
CREATE INDEX t_platform_passkey_flow_expiry_idx ON t_platform_passkey_flow(expires_at);
CREATE TABLE IF NOT EXISTS t_platform_passkey_reauth_attempt (
  admin_id bigint PRIMARY KEY REFERENCES t_admin(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  locked_until DATETIME(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE UNIQUE INDEX t_admin_passkey_user_handle_idx ON t_admin(passkey_user_handle);
COMMIT;
