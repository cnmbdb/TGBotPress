CREATE TABLE IF NOT EXISTS t_platform_plugin_install_attempt (
  plugin_id text PRIMARY KEY,
  package_name text NOT NULL,
  version text NOT NULL,
  source text NOT NULL CHECK (source IN ('builtin', 'github-packages')),
  integrity_sha512 text,
  install_path text,
  status text NOT NULL CHECK (status IN ('staged', 'installed', 'failed')),
  last_error text,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_install_attempt_status_idx ON t_platform_plugin_install_attempt(status);
