CREATE TABLE IF NOT EXISTS t_platform_plugin_lifecycle (
  plugin_id varchar(191) PRIMARY KEY,
  state varchar(32) NOT NULL CHECK (state IN ('active', 'draining', 'uninstalled')),
  enabled_bot_ids JSON NOT NULL DEFAULT ('[]'),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
