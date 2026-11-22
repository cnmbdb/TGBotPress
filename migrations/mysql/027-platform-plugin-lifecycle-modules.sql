CREATE TABLE IF NOT EXISTS t_platform_plugin_execution (
  plugin_id varchar(64) NOT NULL,
  task_name varchar(100) NOT NULL,
  owner varchar(100) NOT NULL,
  lease_until DATETIME(6) NOT NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(plugin_id,task_name)
);
CREATE INDEX t_platform_plugin_execution_expiry_idx ON t_platform_plugin_execution(plugin_id,lease_until);
INSERT IGNORE INTO t_platform_plugin_lifecycle(plugin_id,state,updated_at)
VALUES ('groups','active',now()),('transit','active',now()),('energy','active',now()),('premium','active',now()),('monitor','active',now()),('collection','active',now()),('shop','active',now()),('cloneproxy','active',now())
;
