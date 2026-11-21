CREATE TABLE IF NOT EXISTS t_platform_plugin_install (
  plugin_id text PRIMARY KEY,
  package_name text NOT NULL,
  version text NOT NULL,
  source text NOT NULL CHECK (source IN ('builtin', 'github-packages')),
  integrity_sha512 text,
  install_path text,
  status text NOT NULL CHECK (status IN ('installed', 'staged', 'failed', 'removed')),
  last_error text,
  installed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_install_status_idx ON t_platform_plugin_install(status);
INSERT INTO t_platform_plugin_install(plugin_id,package_name,version,source,status,installed_at,updated_at)
VALUES
 ('groups','@tgbotpress/plugin-groups','0.1.0','builtin','installed',now(),now()),
 ('transit','@tgbotpress/plugin-transit','0.1.0','builtin','installed',now(),now()),
 ('energy','@tgbotpress/plugin-energy','0.1.0','builtin','installed',now(),now()),
 ('premium','@tgbotpress/plugin-premium','0.1.0','builtin','installed',now(),now()),
 ('monitor','@tgbotpress/plugin-monitor','0.1.0','builtin','installed',now(),now()),
 ('collection','@tgbotpress/plugin-collection','0.1.0','builtin','installed',now(),now()),
 ('shop','@tgbotpress/plugin-shop','0.1.0','builtin','installed',now(),now()),
 ('cloneproxy','@tgbotpress/plugin-cloneproxy','0.1.0','builtin','installed',now(),now())
ON CONFLICT(plugin_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS t_platform_plugin_install_history (
  id bigserial PRIMARY KEY,
  plugin_id text NOT NULL,
  package_name text NOT NULL,
  version text NOT NULL,
  source text NOT NULL,
  integrity_sha512 text,
  install_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_install_history_plugin_idx ON t_platform_plugin_install_history(plugin_id,created_at DESC);
