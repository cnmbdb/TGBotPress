ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
ALTER TABLE t_platform_plugin_lifecycle ADD COLUMN IF NOT EXISTS enabled_at timestamptz;

CREATE TABLE IF NOT EXISTS t_platform_plugin_task (
  rid bigserial PRIMARY KEY,
  plugin_id text NOT NULL,
  source_update_rid bigint NOT NULL,
  bot_rid integer NOT NULL,
  update_body jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','paused','processing','failed','processed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error_code text,
  UNIQUE(plugin_id,source_update_rid)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_task_work_idx
  ON t_platform_plugin_task(plugin_id,status,next_attempt_at,rid)
  WHERE status IN ('pending','processing','failed');

INSERT INTO t_platform_plugin_lifecycle(plugin_id,state)
VALUES ('groups','active') ON CONFLICT(plugin_id) DO NOTHING;

-- Only replay inbox rows that have not already reached a terminal status.
INSERT INTO t_platform_plugin_task(plugin_id,source_update_rid,bot_rid,update_body,status,attempts,next_attempt_at)
SELECT 'groups',u.rid,u.bot_rid,u.update_body,
       CASE WHEN l.state='active' THEN 'pending' ELSE 'paused' END,
       u.attempts,now()
FROM t_platform_telegram_update u
LEFT JOIN t_platform_plugin_lifecycle l ON l.plugin_id='groups'
WHERE u.status IN ('pending','processing','failed')
  AND ((u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}' IN ('group','supergroup'))
    OR (u.update_body ? 'edited_message' AND u.update_body #>> '{edited_message,chat,type}' IN ('group','supergroup')))
  AND NOT (u.update_body ? 'message' AND (u.update_body #> '{message,new_chat_member}' IS NOT NULL OR u.update_body #> '{message,new_chat_members}' IS NOT NULL))
ON CONFLICT(plugin_id,source_update_rid) DO NOTHING;
