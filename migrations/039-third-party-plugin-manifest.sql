ALTER TABLE t_platform_plugin_install ADD COLUMN IF NOT EXISTS manifest_json jsonb;
ALTER TABLE t_platform_plugin_install_attempt ADD COLUMN IF NOT EXISTS manifest_json jsonb;
