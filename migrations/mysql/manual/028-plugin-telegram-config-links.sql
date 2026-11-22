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

DROP FUNCTION IF EXISTS platform_plugin_auto_targets;
CREATE FUNCTION platform_plugin_auto_targets(p_type VARCHAR(32),p_bot BIGINT,p_rid BIGINT,p_name TEXT,p_opt INT)
RETURNS JSON DETERMINISTIC READS SQL DATA
RETURN COALESCE((
  SELECT JSON_ARRAYAGG(plugin_id) FROM (
    SELECT CASE WHEN p_type='command' AND LOWER(COALESCE(p_name,'')) IN ('trx','z0') THEN 'transit'
                WHEN p_type='command' AND LOWER(COALESCE(p_name,''))='buyenergy' THEN 'energy'
                WHEN p_type='command' AND LOWER(COALESCE(p_name,''))='buypremium' THEN 'premium' END AS plugin_id
    UNION SELECT CASE p_opt WHEN 3 THEN 'energy' WHEN 10 THEN 'energy' WHEN 11 THEN 'energy' WHEN 4 THEN 'premium' WHEN 6 THEN 'monitor' WHEN 7 THEN 'shop' WHEN 9 THEN 'transit' WHEN 8 THEN 'transit' END WHERE p_type='keyreply'
    UNION SELECT 'energy' WHERE p_type='keyreply' AND p_opt=8
    UNION SELECT 'premium' WHERE p_type='keyreply' AND p_opt=8
    UNION SELECT 'cloneproxy' WHERE p_type='keyboard' AND LOWER(COALESCE(p_name,'')) LIKE '%克隆/代理%'
    UNION SELECT CASE k.opt_type WHEN 3 THEN 'energy' WHEN 10 THEN 'energy' WHEN 11 THEN 'energy' WHEN 4 THEN 'premium' WHEN 6 THEN 'monitor' WHEN 7 THEN 'shop' WHEN 9 THEN 'transit' WHEN 8 THEN 'transit' END
      FROM t_telegram_bot_keyreply_keyboard r JOIN t_telegram_bot_keyreply k ON k.rid=r.keyreply_rid
      WHERE p_type IN ('keyboard','keyreply_keyboard') AND r.rid=p_rid AND r.bot_rid=p_bot
    UNION SELECT 'energy' FROM t_telegram_bot_keyreply_keyboard r JOIN t_telegram_bot_keyreply k ON k.rid=r.keyreply_rid WHERE p_type IN ('keyboard','keyreply_keyboard') AND r.rid=p_rid AND r.bot_rid=p_bot AND k.opt_type=8
    UNION SELECT 'premium' FROM t_telegram_bot_keyreply_keyboard r JOIN t_telegram_bot_keyreply k ON k.rid=r.keyreply_rid WHERE p_type IN ('keyboard','keyreply_keyboard') AND r.rid=p_rid AND r.bot_rid=p_bot AND k.opt_type=8
    UNION SELECT 'cloneproxy' FROM t_telegram_bot_keyreply_keyboard r JOIN t_telegram_bot_keyboard kb ON kb.rid=r.keyboard_rid WHERE p_type='keyreply_keyboard' AND r.rid=p_rid AND r.bot_rid=p_bot AND LOWER(kb.keyboard_name) LIKE '%克隆/代理%'
  ) candidates WHERE plugin_id IS NOT NULL
),JSON_ARRAY());

DROP FUNCTION IF EXISTS platform_plugin_config_targets;
CREATE FUNCTION platform_plugin_config_targets(p_type VARCHAR(32),p_bot BIGINT,p_rid BIGINT,p_name TEXT,p_opt INT)
RETURNS JSON DETERMINISTIC READS SQL DATA
RETURN CASE WHEN EXISTS(SELECT 1 FROM t_platform_plugin_config_link l WHERE l.config_type=p_type AND l.bot_rid=p_bot AND l.config_rid=p_rid AND l.manual_override)
  THEN COALESCE((SELECT JSON_ARRAYAGG(plugin_id) FROM t_platform_plugin_config_link l WHERE l.config_type=p_type AND l.bot_rid=p_bot AND l.config_rid=p_rid AND l.manual_override AND l.plugin_id<>'__none__'),JSON_ARRAY())
  ELSE COALESCE((SELECT JSON_ARRAYAGG(plugin_id) FROM (
      SELECT l.plugin_id FROM t_platform_plugin_config_link l WHERE l.config_type=p_type AND l.bot_rid=p_bot AND l.config_rid=p_rid AND NOT l.manual_override AND l.plugin_id<>'__none__'
      UNION SELECT j.plugin_id FROM JSON_TABLE(platform_plugin_auto_targets(p_type,p_bot,p_rid,p_name,p_opt),'$[*]' COLUMNS(plugin_id VARCHAR(64) PATH '$')) j
    ) targets),JSON_ARRAY()) END;

DROP FUNCTION IF EXISTS platform_plugin_config_effective;
CREATE FUNCTION platform_plugin_config_effective(p_type VARCHAR(32),p_bot BIGINT,p_rid BIGINT,p_name TEXT,p_opt INT)
RETURNS BOOLEAN DETERMINISTIC READS SQL DATA
RETURN JSON_LENGTH(platform_plugin_config_targets(p_type,p_bot,p_rid,p_name,p_opt))=0 OR EXISTS(
  SELECT 1 FROM JSON_TABLE(platform_plugin_config_targets(p_type,p_bot,p_rid,p_name,p_opt),'$[*]' COLUMNS(plugin_id VARCHAR(64) PATH '$')) j
  JOIN t_platform_plugin_lifecycle state ON state.plugin_id=j.plugin_id AND state.state='active'
);
