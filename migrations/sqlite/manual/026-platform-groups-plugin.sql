ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN disabled_at TEXT;
ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN enabled_at TEXT;
CREATE TABLE IF NOT EXISTS t_platform_plugin_task(rid INTEGER PRIMARY KEY AUTOINCREMENT,plugin_id TEXT NOT NULL,source_update_rid BIGINT NOT NULL,bot_rid INTEGER NOT NULL,update_body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','paused','processing','failed','processed')),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,lease_owner TEXT,lease_until TEXT,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at TEXT,last_error_code TEXT,UNIQUE(plugin_id,source_update_rid));
CREATE INDEX IF NOT EXISTS t_platform_plugin_task_work_idx ON t_platform_plugin_task(plugin_id,status,next_attempt_at,rid);
INSERT OR IGNORE INTO t_platform_plugin_lifecycle(plugin_id,state) VALUES('groups','active');
INSERT OR IGNORE INTO t_platform_plugin_task(plugin_id,source_update_rid,bot_rid,update_body,status,attempts,next_attempt_at)
SELECT 'groups',u.rid,u.bot_rid,u.update_body,CASE WHEN l.state='active' THEN 'pending' ELSE 'paused' END,u.attempts,CURRENT_TIMESTAMP
FROM t_platform_telegram_update u LEFT JOIN t_platform_plugin_lifecycle l ON l.plugin_id='groups'
WHERE u.status IN ('pending','processing','failed')
AND ((json_extract(u.update_body,'$.message.chat.type') IN ('group','supergroup')) OR (json_extract(u.update_body,'$.edited_message.chat.type') IN ('group','supergroup')))
AND json_extract(u.update_body,'$.message.new_chat_member') IS NULL AND json_extract(u.update_body,'$.message.new_chat_members') IS NULL;
