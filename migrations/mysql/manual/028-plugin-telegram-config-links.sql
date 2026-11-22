CREATE TABLE IF NOT EXISTS t_platform_plugin_config_link (
  plugin_id VARCHAR(64) NOT NULL,
  config_type VARCHAR(32) NOT NULL CHECK (config_type IN ('command','keyboard','keyreply','keyreply_keyboard')),
  bot_rid BIGINT NOT NULL DEFAULT 0,
  config_rid BIGINT NOT NULL,
  manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  create_by VARCHAR(100),
  create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE KEY t_platform_plugin_config_link_uq(plugin_id,config_type,bot_rid,config_rid,manual_override)
);
CREATE INDEX t_platform_plugin_config_lookup_idx ON t_platform_plugin_config_link(config_type,bot_rid,config_rid);
CREATE INDEX t_platform_plugin_config_plugin_idx ON t_platform_plugin_config_link(plugin_id,bot_rid);

CREATE TABLE IF NOT EXISTS t_platform_plugin_config_refresh (
  bot_rid BIGINT PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  lease_until DATETIME(6),
  lease_owner VARCHAR(100),
  last_error_code VARCHAR(100),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX t_platform_plugin_config_refresh_work_idx ON t_platform_plugin_config_refresh(status,next_attempt_at,bot_rid);

INSERT IGNORE INTO t_platform_plugin_config_link(plugin_id,config_type,bot_rid,config_rid,manual_override,create_by)
SELECT CASE LOWER(command) WHEN 'trx' THEN 'transit' WHEN 'z0' THEN 'transit' WHEN 'buyenergy' THEN 'energy' WHEN 'buypremium' THEN 'premium' END,'command',bot_rid,rid,FALSE,'auto'
FROM t_telegram_bot_command WHERE LOWER(command) IN ('trx','z0','buyenergy','buypremium');
INSERT IGNORE INTO t_platform_plugin_config_link(plugin_id,config_type,bot_rid,config_rid,manual_override,create_by)
SELECT CASE opt_type WHEN 3 THEN 'energy' WHEN 10 THEN 'energy' WHEN 11 THEN 'energy' WHEN 4 THEN 'premium' WHEN 6 THEN 'monitor' WHEN 7 THEN 'shop' WHEN 9 THEN 'transit' WHEN 8 THEN 'transit' END,'keyreply',bot_rid,rid,FALSE,'auto'
FROM t_telegram_bot_keyreply WHERE opt_type IN (3,4,6,7,8,9,10,11);
INSERT IGNORE INTO t_platform_plugin_config_link(plugin_id,config_type,bot_rid,config_rid,manual_override,create_by)
SELECT 'cloneproxy','keyboard',0,rid,FALSE,'auto' FROM t_telegram_bot_keyboard WHERE LOWER(keyboard_name) LIKE '%克隆/代理%';
