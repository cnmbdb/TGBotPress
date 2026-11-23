import { randomUUID } from 'node:crypto'
import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from '../server/database.types'
import { db } from '../server/db.server'
import { can, identity, run } from '../server/api.server'
import { pluginCatalog, type PluginId } from './catalog'
import { lifecycleBlockerSql as premiumLifecycleBlockerSql } from '@tgbotpress/plugin-premium'

export type ManagedModuleId = Exclude<PluginId, 'groups' | 'cloneproxy'>
export const managedModuleIds: ManagedModuleId[] = pluginCatalog.filter(plugin => plugin.id !== 'groups' && plugin.id !== 'cloneproxy').map(plugin => plugin.id as ManagedModuleId)
export type PluginLifecycleState = 'active' | 'draining' | 'uninstalled'
export type PluginLifecycleAction = 'disable' | 'resume' | 'uninstall' | 'install'
export function pluginAcceptsWrites(state: string | null | undefined) { return state === 'active' }
type Db = Pick<Pool, 'query' | 'connect'>
type CountRow = { count: number }
const pendingSupportSql = "SELECT count(*)::int AS count FROM t_platform_telegram_update WHERE status IN ('pending','processing','failed') AND ((update_body ? 'callback_query' AND update_body #>> '{callback_query,message,chat,type}'='private') OR (update_body ? 'message' AND update_body #>> '{message,chat,type}'='private' AND update_body #> '{message,reply_to_message}' IS NOT NULL))"

const blockerQueries: Record<ManagedModuleId, string> = {
  transit: `SELECT (SELECT count(*) FROM t_transit_wallet_trade_list WHERE process_status IN (0,1,8))::int + (SELECT count(*) FROM t_platform_job_outbox WHERE task_name='sendtransittgmessage' AND status IN ('pending','processing'))::int AS count`,
  energy: `SELECT (SELECT count(*) FROM t_energy_wallet_trade_list WHERE process_status IN (1,8))::int + (SELECT count(*) FROM t_energy_quick_order WHERE status IN (1,8))::int + (SELECT count(*) FROM t_energy_platform_order WHERE recovery_status=2)::int + (SELECT count(*) FROM t_energy_ai_bishu WHERE is_buy='B')::int + (SELECT count(*) FROM t_platform_job_outbox WHERE task_name IN ('sendenergytgmessage','recoveryenergy','bindasendnusdt') AND status IN ('pending','processing'))::int AS count`,
  premium: premiumLifecycleBlockerSql,
  monitor: `SELECT 0::int AS count`,
  collection: `SELECT (SELECT count(*) FROM t_platform_collection_wallet_action WHERE state IN ('claimed','signing'))::int + (SELECT count(*) FROM t_platform_job_outbox WHERE task_name='handlecollectionwallet' AND status IN ('pending','processing'))::int AS count`,
  shop: `SELECT 0::int AS count`,
}

async function lock(client: Pick<PoolClient, 'query'>, pluginId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('plugin:'||$1||':lifecycle',0))", [pluginId])
}

export async function managedPluginStatus(pool: Pick<Pool, 'query'>, pluginId: ManagedModuleId) {
  const [state, blockers, executions, inbox] = await Promise.all([
    pool.query<{ state: PluginLifecycleState }>('SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id=$1', [pluginId]),
    pool.query<CountRow>(blockerQueries[pluginId]),
    pool.query<CountRow>("SELECT count(*)::int AS count FROM t_platform_plugin_execution WHERE plugin_id=$1 AND lease_until>now()", [pluginId]),
    pool.query<CountRow>(pendingSupportSql),
  ])
  return { state: state.rows[0]?.state ?? 'active', blockers: (blockers.rows[0]?.count ?? 0)+(inbox.rows[0]?.count ?? 0), executions: executions.rows[0]?.count ?? 0 }
}

export async function changeManagedPlugin(pool: Db, pluginId: ManagedModuleId, action: PluginLifecycleAction) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lock(client, pluginId)
    const row = await client.query<{state:PluginLifecycleState}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id=$1 FOR UPDATE", [pluginId])
    const current = row.rows[0]?.state ?? 'active'
    const manifest=pluginCatalog.find(plugin=>plugin.id===pluginId)
    if(action==='install') for(const dependency of manifest?.dependencies??[]){const dep=await client.query<{state:string}>('SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id=$1',[dependency]);if(dep.rows[0]?.state!=='active')throw new Error('plugin_dependency_unavailable:'+dependency)}
    if(action==='disable'||action==='uninstall'){
      const dependentIds=pluginCatalog.filter(plugin=>(plugin.dependencies as readonly string[]).includes(pluginId)).map(plugin=>plugin.id)
      if(dependentIds.length){const requiredState=action==='disable'?'active':'uninstalled';const comparator=action==='disable'?'=':'<> ';const dependent=await client.query<{plugin_id:string}>(`SELECT plugin_id FROM t_platform_plugin_lifecycle WHERE plugin_id=ANY($1::text[]) AND state${comparator}$2 LIMIT 1`,[dependentIds,requiredState]);if(dependent.rowCount)throw new Error('plugin_has_dependents:'+dependent.rows[0].plugin_id)}
    }
    let next: PluginLifecycleState
    if (action === 'disable') {
      if (current === 'uninstalled') throw new Error('plugin_uninstalled')
      if (current === 'active') await client.query("UPDATE t_platform_plugin_lifecycle SET disabled_at=now(),updated_at=now() WHERE plugin_id=$1",[pluginId])
      next = 'draining'
    } else if (action === 'resume') {
      if (current === 'uninstalled') throw new Error('plugin_uninstalled')
      next = 'active'
    } else if (action === 'install') {
      if (current !== 'uninstalled') throw new Error('plugin_not_uninstalled')
      next = 'active'
    } else {
      if (current === 'uninstalled') { await client.query('COMMIT'); return current }
      if (current !== 'draining') throw new Error('plugin_must_drain')
      const busy = await client.query<CountRow>(blockerQueries[pluginId])
      const running = await client.query<CountRow>("SELECT count(*)::int AS count FROM t_platform_plugin_execution WHERE plugin_id=$1 AND lease_until>now()", [pluginId])
      const inbox = await client.query<CountRow>(pendingSupportSql)
      if ((busy.rows[0]?.count ?? 0) > 0) throw new Error('plugin_has_outstanding_business:' + busy.rows[0].count)
      if ((running.rows[0]?.count ?? 0) > 0) throw new Error('plugin_tasks_still_running:' + running.rows[0].count)
      if ((inbox.rows[0]?.count ?? 0) > 0) throw new Error('plugin_telegram_updates_pending:' + inbox.rows[0].count)
      next = 'uninstalled'
    }
    await client.query("INSERT INTO t_platform_plugin_lifecycle(plugin_id,state,enabled_at,updated_at) VALUES($1,$2,CASE WHEN $2='active' THEN now() ELSE NULL END,now()) ON CONFLICT(plugin_id) DO UPDATE SET state=EXCLUDED.state,enabled_at=CASE WHEN EXCLUDED.state='active' THEN now() ELSE t_platform_plugin_lifecycle.enabled_at END,updated_at=now()", [pluginId, next])
    await client.query('COMMIT')
    return next
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}


export async function claimManagedPluginUpdate(pool:Db,pluginId:ManagedModuleId,updateRid:number,receivedAt:Date|string) {
  const client=await pool.connect(),owner=randomUUID(),taskName='telegram-update:'+updateRid
  try {
    await client.query('BEGIN');await lock(client,pluginId)
    const result=await client.query<{state:string;disabled_at:Date|string|null;enabled_at:Date|string|null}>("SELECT state,disabled_at,enabled_at FROM t_platform_plugin_lifecycle WHERE plugin_id=$1",[pluginId])
    const row=result.rows[0]
    if(row){
      const received=new Date(receivedAt).getTime(),disabled=row.disabled_at==null?null:new Date(row.disabled_at).getTime(),enabled=row.enabled_at==null?null:new Date(row.enabled_at).getTime()
      const allowed=row.state==='active'?!(disabled!==null&&enabled!==null&&received>disabled&&received<enabled):row.state==='draining'&&disabled!==null&&received<=disabled
      if(!allowed){await client.query('COMMIT');return {allowed:false as const}}
    }
    const lease=await client.query("INSERT INTO t_platform_plugin_execution(plugin_id,task_name,owner,lease_until) VALUES($1,$2,$3,now()+interval '180 seconds') ON CONFLICT(plugin_id,task_name) DO UPDATE SET owner=EXCLUDED.owner,lease_until=EXCLUDED.lease_until WHERE t_platform_plugin_execution.lease_until<=now() OR t_platform_plugin_execution.owner=EXCLUDED.owner RETURNING owner",[pluginId,taskName,owner])
    if(!lease.rowCount){await client.query('COMMIT');return {allowed:false as const}}
    await client.query('COMMIT');return {allowed:true as const,owner,taskName}
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
}

export async function releaseManagedPluginUpdate(pool:Pick<Pool,'query'>,pluginId:ManagedModuleId,updateRid:number,owner:string) {
  await pool.query('DELETE FROM t_platform_plugin_execution WHERE plugin_id=$1 AND task_name=$2 AND owner=$3',[pluginId,'telegram-update:'+updateRid,owner])
}

export async function runPluginTaskWithLease<T>(pluginId: string, taskName: string, drainTasks: readonly string[], task: (draining: boolean) => Promise<T>, pool: Db = db) {
  const owner = randomUUID(), client = await pool.connect()
  let acquired = false, heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    await client.query('BEGIN')
    await lock(client, pluginId)
    const state = await client.query<{state:string}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id=$1", [pluginId])
    if (state.rows[0]?.state === 'uninstalled') { await client.query('COMMIT'); return { skipped: true, reason: 'plugin_uninstalled' } as T }
    const draining = state.rows[0]?.state === 'draining'
    if (draining && !drainTasks.includes(taskName)) { await client.query('COMMIT'); return { skipped: true, reason: 'plugin_draining' } as T }
    const lease = await client.query("INSERT INTO t_platform_plugin_execution(plugin_id,task_name,owner,lease_until) VALUES($1,$2,$3,now()+interval '180 seconds') ON CONFLICT(plugin_id,task_name) DO UPDATE SET owner=EXCLUDED.owner,lease_until=EXCLUDED.lease_until WHERE t_platform_plugin_execution.lease_until<=now() RETURNING owner", [pluginId,taskName,owner])
    if (!lease.rowCount) { await client.query('COMMIT'); return { skipped: true, reason: 'plugin_task_already_running' } as T }
    acquired = true
    await client.query('COMMIT')
    heartbeat = setInterval(() => { void pool.query("UPDATE t_platform_plugin_execution SET lease_until=now()+interval '180 seconds' WHERE plugin_id=$1 AND task_name=$2 AND owner=$3", [pluginId,taskName,owner]).catch(()=>undefined) }, 60_000)
    heartbeat.unref?.()
    return await task(draining)
  } catch (error) { await client.query('ROLLBACK').catch(()=>undefined); throw error }
  finally {
    if (heartbeat) clearInterval(heartbeat)
    if (acquired) await pool.query('DELETE FROM t_platform_plugin_execution WHERE plugin_id=$1 AND task_name=$2 AND owner=$3', [pluginId,taskName,owner]).catch(()=>undefined)
    client.release()
  }
}

export async function runManagedPluginTask<T>(pluginId: ManagedModuleId, taskName: string, task: (draining: boolean) => Promise<T>, pool: Db = db) {
  const plugin = pluginCatalog.find(item => item.id === pluginId)
  return runPluginTaskWithLease(pluginId, taskName, (plugin?.drainTasks as readonly string[] | undefined) ?? [], task, pool)
}

export function guardManagedPluginWrite(request: Request, pluginId: ManagedModuleId, handler: (request: Request) => Promise<Response>) {
  return run(async () => {
    if (request.method === 'GET' || request.method === 'HEAD') return handler(request)
    const plugin = pluginCatalog.find(item => item.id === pluginId)
    if (!plugin) return Response.json({ message: '插件不存在' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
    const lockClient = await db.connect()
    try {
      await lockClient.query("SELECT pg_advisory_lock(hashtextextended('plugin:'||$1||':lifecycle',0))", [pluginId])
      const user = await identity(request)
      if (!plugin.menuRoutes.some(route => can(user, '', route))) return Response.json({ message: '没有操作权限' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
      const result = await lockClient.query<{state:string}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id=$1", [pluginId])
      const state = result.rows[0]?.state ?? 'active'
      if (!pluginAcceptsWrites(state)) return Response.json({ message: state === 'draining' ? '插件正在排空，暂不接受新操作' : '插件已卸载' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
      return await handler(request)
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(hashtextextended('plugin:'||$1||':lifecycle',0))", [pluginId]).catch(()=>undefined)
      lockClient.release()
    }
  })
}

export async function pluginUpdateAllowed(pool: Pick<Pool,'query'>, pluginId: string, receivedAt: Date | string | null) {
  const result=await pool.query<{state:string;disabled_at:Date|string|null;enabled_at:Date|string|null}>("SELECT state,disabled_at,enabled_at FROM t_platform_plugin_lifecycle WHERE plugin_id=$1",[pluginId])
  const row=result.rows[0];if(!row)return true
  if(row.state==='uninstalled')return false
  if(receivedAt==null)return row.state==='active'
  const received=new Date(receivedAt).getTime()
  const disabled=row.disabled_at==null?null:new Date(row.disabled_at).getTime()
  const enabled=row.enabled_at==null?null:new Date(row.enabled_at).getTime()
  if(row.state==='draining')return disabled!==null&&received<=disabled
  if(disabled!==null&&enabled!==null&&received>disabled&&received<enabled)return false
  return true
}
