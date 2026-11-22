CREATE TABLE IF NOT EXISTS t_platform_plugin_install (
  plugin_id text PRIMARY KEY,
  package_name text NOT NULL,
  version text NOT NULL,
  source text NOT NULL CHECK (source IN ('builtin', 'github-packages')),
  integrity_sha512 text,
  install_path text,
  status text NOT NULL CHECK (status IN ('installed', 'staged', 'failed', 'removed')),
  last_error text,
  installed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_install_status_idx ON t_platform_plugin_install(status);
INSERT INTO t_platform_plugin_install(plugin_id,package_name,version,source,status,installed_at,updated_at)
VALUES
 ('groups','@tgbotpress/plugin-groups','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('transit','@tgbotpress/plugin-transit','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('energy','@tgbotpress/plugin-energy','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('premium','@tgbotpress/plugin-premium','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('monitor','@tgbotpress/plugin-monitor','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('collection','@tgbotpress/plugin-collection','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('shop','@tgbotpress/plugin-shop','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('cloneproxy','@tgbotpress/plugin-cloneproxy','0.1.0','builtin','installed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(plugin_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS t_platform_plugin_install_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id text NOT NULL,
  package_name text NOT NULL,
  version text NOT NULL,
  source text NOT NULL,
  integrity_sha512 text,
  install_path text,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_install_history_plugin_idx ON t_platform_plugin_install_history(plugin_id,created_at DESC);
