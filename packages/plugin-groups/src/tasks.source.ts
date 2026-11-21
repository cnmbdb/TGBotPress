import { randomUUID } from 'node:crypto'
import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from '@tgbotpress/plugin-sdk'
type Update = Record<string, any>
type PoolLike = Pick<Pool, 'query' | 'connect'>
type Task = { rid: number; source_update_rid: number; bot_rid: number; update_body: Update; attempts: number }
type Host = { lockGroupsPlugin: (client: Pick<PoolClient, 'query'>) => Promise<void>; groupsPluginStatus: (pool: PoolLike) => Promise<{ state: string }> }
export function createGroupTasks(host: Host) {
const { lockGroupsPlugin, groupsPluginStatus } = host

function isGroupManagementUpdate(body: Update) {
  const m = body?.message ?? body?.edited_message
  return !!m?.chat && ['group','supergroup'].includes(String(m.chat.type)) && !m.new_chat_member && !m.new_chat_members
}

/** Call in the same transaction that inserts the durable Telegram inbox row. */
async function enqueueGroupManagementUpdate(client: Pick<PoolClient,'query'>, sourceUpdateRid: number, botRid: number, body: Update) {
  if (!isGroupManagementUpdate(body)) return false
  await lockGroupsPlugin(client)
  const result = await client.query<{state:string}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id='groups'")
  const state = result.rows[0]?.state ?? 'active'
  const status = state === 'active' ? 'pending' : 'paused'
  await client.query("INSERT INTO t_platform_plugin_task(plugin_id,source_update_rid,bot_rid,update_body,status) VALUES('groups',$1,$2,$3::jsonb,$4) ON CONFLICT(plugin_id,source_update_rid) DO NOTHING",[sourceUpdateRid,botRid,JSON.stringify(body),status])
  return true
}

async function claim(pool:PoolLike,owner:string,batchSize:number) {
  const c=await pool.connect()
  try {
    await c.query('BEGIN')
    await lockGroupsPlugin(c)
    const state=await c.query<{state:string}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id='groups'")
    if (state.rows[0]?.state==='uninstalled') { await c.query('COMMIT'); return [] as Task[] }
    const rows=await c.query<Task>(`WITH picked AS (
      SELECT t.rid FROM t_platform_plugin_task t JOIN t_platform_telegram_update u ON u.rid=t.source_update_rid
      WHERE t.plugin_id='groups' AND t.attempts<8 AND u.status='processed'
        AND ((t.status IN ('pending','failed') AND t.next_attempt_at<=now()) OR (t.status='processing' AND t.lease_until<now()))
      ORDER BY t.rid LIMIT $1 FOR UPDATE OF t SKIP LOCKED
    ) UPDATE t_platform_plugin_task t SET status='processing',attempts=t.attempts+1,lease_owner=$2,lease_until=now()+interval '45 seconds'
      FROM picked WHERE t.rid=picked.rid RETURNING t.rid,t.source_update_rid,t.bot_rid,t.update_body,t.attempts`,[batchSize,owner])
    await c.query('COMMIT'); return rows.rows
  } catch(e) { await c.query('ROLLBACK'); throw e } finally { c.release() }
}

async function syncGroupManagementTasks(options:{pool:PoolLike;logger?:Pick<Console,'error'>;shouldContinue?:()=>boolean;process:(task:Task)=>Promise<void>;batchSize?:number}) {
  const pool=options.pool,logger=options.logger??console,shouldContinue=options.shouldContinue??(()=>true)
  const state=await groupsPluginStatus(pool)
  if(state.state==='uninstalled') return {skipped:true,processed:0,failed:0}
  const owner='groups-plugin-'+process.pid+'-'+randomUUID(),tasks=await claim(pool,owner,Math.min(100,Math.max(1,options.batchSize??20)))
  let processed=0,failed=0
  for(const task of tasks){
    if(!shouldContinue()) break
    try { await options.process(task); await pool.query("UPDATE t_platform_plugin_task SET status='processed',processed_at=now(),lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2",[task.rid,owner]); processed++ }
    catch { await pool.query("UPDATE t_platform_plugin_task SET status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'failed' END,next_attempt_at=now()+LEAST(interval '5 minutes',interval '2 seconds'*power(2,LEAST(attempts,7))),lease_owner=NULL,lease_until=NULL,last_error_code='groups_plugin_task_failed' WHERE rid=$1 AND status='processing' AND lease_owner=$2",[task.rid,owner]);failed++;logger.error('Group plugin task failed') }
  }
  return {skipped:false,processed,failed}
}

return { isGroupManagementUpdate, enqueueGroupManagementUpdate, syncGroupManagementTasks }
}
export type GroupPluginTask = Task
