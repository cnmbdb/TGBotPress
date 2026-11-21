ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN IF NOT EXISTS enabled_at timestamptz;
CREATE TABLE IF NOT EXISTS t_platform_plugin_execution (
  plugin_id text NOT NULL,
  task_name text NOT NULL,
  owner text NOT NULL,
  lease_until timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plugin_id,task_name)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_execution_expiry_idx ON t_platform_plugin_execution(plugin_id,lease_until);
INSERT INTO t_platform_plugin_lifecycle(plugin_id,state,updated_at)
VALUES ('groups','active',now()),('transit','active',now()),('energy','active',now()),('premium','active',now()),('monitor','active',now()),('collection','active',now()),('shop','active',now()),('cloneproxy','active',now())
ON CONFLICT(plugin_id) DO NOTHING;
