CREATE TABLE IF NOT EXISTS t_platform_plugin_command (
  plugin_id text NOT NULL,
  bot_id bigint NOT NULL,
  command_name varchar(32) NOT NULL,
  description varchar(256) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, bot_id, command_name),
  UNIQUE (bot_id, command_name)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_command_plugin_idx ON t_platform_plugin_command(plugin_id, bot_id);
