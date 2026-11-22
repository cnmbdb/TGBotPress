ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN disabled_at TEXT;
ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN enabled_at TEXT;
CREATE TABLE IF NOT EXISTS t_platform_plugin_execution (
  plugin_id text NOT NULL,
  task_name text NOT NULL,
  owner text NOT NULL,
  lease_until TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(plugin_id,task_name)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_execution_expiry_idx ON t_platform_plugin_execution(plugin_id,lease_until);
INSERT INTO t_platform_plugin_lifecycle(plugin_id,state,updated_at)
VALUES ('groups','active',CURRENT_TIMESTAMP),('transit','active',CURRENT_TIMESTAMP),('energy','active',CURRENT_TIMESTAMP),('premium','active',CURRENT_TIMESTAMP),('monitor','active',CURRENT_TIMESTAMP),('collection','active',CURRENT_TIMESTAMP),('shop','active',CURRENT_TIMESTAMP),('cloneproxy','active',CURRENT_TIMESTAMP)
ON CONFLICT(plugin_id) DO NOTHING;
