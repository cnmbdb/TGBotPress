CREATE TABLE IF NOT EXISTS t_platform_plugin_storage (
  plugin_id text NOT NULL,
  bot_id bigint NOT NULL DEFAULT 0,
  storage_key text NOT NULL,
  value_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, bot_id, storage_key)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_storage_updated_idx ON t_platform_plugin_storage(updated_at);
