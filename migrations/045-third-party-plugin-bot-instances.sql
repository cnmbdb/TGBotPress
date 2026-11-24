CREATE TABLE IF NOT EXISTS t_platform_plugin_instance (
  plugin_id text NOT NULL,
  bot_id bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'disabled')),
  enabled_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, bot_id)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_instance_bot_idx ON t_platform_plugin_instance(bot_id, plugin_id);
