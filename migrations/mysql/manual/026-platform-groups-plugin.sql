ALTER TABLE t_platform_plugin_lifecycle
  ADD COLUMN disabled_at DATETIME(6),
  ADD COLUMN enabled_at DATETIME(6);

CREATE TABLE IF NOT EXISTS t_platform_plugin_task (
  rid BIGINT AUTO_INCREMENT PRIMARY KEY,
  plugin_id VARCHAR(64) NOT NULL,
  source_update_rid BIGINT NOT NULL,
  bot_rid INT NOT NULL,
  update_body JSON NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending','paused','processing','failed','processed')),
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  lease_owner VARCHAR(100),
  lease_until DATETIME(6),
  received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at DATETIME(6),
  last_error_code VARCHAR(100),
  UNIQUE KEY t_platform_plugin_task_source_uq(plugin_id,source_update_rid)
);
CREATE INDEX t_platform_plugin_task_work_idx ON t_platform_plugin_task(plugin_id,status,next_attempt_at,rid);

INSERT IGNORE INTO t_platform_plugin_lifecycle(plugin_id,state) VALUES ('groups','active');

INSERT IGNORE INTO t_platform_plugin_task(plugin_id,source_update_rid,bot_rid,update_body,status,attempts,next_attempt_at)
SELECT 'groups',u.rid,u.bot_rid,u.update_body,
       CASE WHEN l.state='active' THEN 'pending' ELSE 'paused' END,
       u.attempts,CURRENT_TIMESTAMP(6)
FROM t_platform_telegram_update u
LEFT JOIN t_platform_plugin_lifecycle l ON l.plugin_id='groups'
WHERE u.status IN ('pending','processing','failed')
  AND ((JSON_CONTAINS_PATH(u.update_body,'one','$.message') AND JSON_UNQUOTE(JSON_EXTRACT(u.update_body,'$.message.chat.type')) IN ('group','supergroup'))
    OR (JSON_CONTAINS_PATH(u.update_body,'one','$.edited_message') AND JSON_UNQUOTE(JSON_EXTRACT(u.update_body,'$.edited_message.chat.type')) IN ('group','supergroup')))
  AND NOT (JSON_CONTAINS_PATH(u.update_body,'one','$.message') AND (JSON_EXTRACT(u.update_body,'$.message.new_chat_member') IS NOT NULL OR JSON_EXTRACT(u.update_body,'$.message.new_chat_members') IS NOT NULL));
