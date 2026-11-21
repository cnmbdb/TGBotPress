CREATE TABLE IF NOT EXISTS t_platform_plugin_lifecycle (
  plugin_id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('active', 'draining', 'uninstalled')),
  enabled_bot_ids integer[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
