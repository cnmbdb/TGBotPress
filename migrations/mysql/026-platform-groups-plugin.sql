ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN disabled_at DATETIME(6);
ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN enabled_at DATETIME(6);

CREATE TABLE IF NOT EXISTS t_platform_plugin_task (
  rid BIGINT AUTO_INCREMENT PRIMARY KEY,
  plugin_id text NOT NULL,
  source_update_rid bigint NOT NULL,
  bot_rid integer NOT NULL,
  update_body JSON NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','paused','processing','failed','processed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  lease_owner text,
  lease_until DATETIME(6),
  received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at DATETIME(6),
  last_error_code text,
  UNIQUE(plugin_id,source_update_rid)
);
CREATE INDEX t_platform_plugin_task_work_idx
  ON t_platform_plugin_task(plugin_id,status,next_attempt_at,rid);

INSERT IGNORE INTO t_platform_plugin_lifecycle(plugin_id,state)
VALUES ('groups','active') ;

-- Only replay inbox rows that have not already reached a terminal status.
INSERT IGNORE INTO t_platform_plugin_task(plugin_id,source_update_rid,bot_rid,update_body,status,attempts,next_attempt_at)
SELECT 'groups',u.rid,u.bot_rid,u.update_body,
       CASE WHEN l.state='active' THEN 'pending' ELSE 'paused' END,
       u.attempts,now()
FROM t_platform_telegram_update u
LEFT JOIN t_platform_plugin_lifecycle l ON l.plugin_id='groups'
WHERE u.status IN ('pending','processing','failed')
  AND ((u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}' IN ('group','supergroup'))
    OR (u.update_body ? 'edited_message' AND u.update_body #>> '{edited_message,chat,type}' IN ('group','supergroup')))
  AND NOT (u.update_body ? 'message' AND (u.update_body #> '{message,new_chat_member}' IS NOT NULL OR u.update_body #> '{message,new_chat_members}' IS NOT NULL))
;
