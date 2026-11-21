CREATE TABLE IF NOT EXISTS t_platform_plugin_install_attempt (
  plugin_id varchar(64) PRIMARY KEY,
  package_name text NOT NULL,
  version text NOT NULL,
  source text NOT NULL CHECK (source IN ('builtin', 'github-packages')),
  integrity_sha512 text,
  install_path text,
  status varchar(32) NOT NULL CHECK (status IN ('staged', 'installed', 'failed')),
  last_error text,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX t_platform_plugin_install_attempt_status_idx ON t_platform_plugin_install_attempt(status);
