import type { Pool, PoolClient } from 'pg'
import { can, identity, run } from '../../server/api.server'
import { db } from '../../server/db.server'
import { pluginAcceptsWrites } from '../module-lifecycle.server'

type Database = Pick<Pool, 'query' | 'connect'>
export type CloneProxyLifecycleState = 'active' | 'draining' | 'uninstalled'
export type CloneProxyLifecycleAction = 'disable' | 'resume' | 'uninstall' | 'install'
const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended('plugin:cloneproxy:lifecycle',0))"

export async function lockCloneProxyLifecycle(client: Pick<PoolClient, 'query'>) {
  await client.query(lockSql)
}

export async function getCloneProxyLifecycle(pool: Pick<Pool, 'query'>): Promise<CloneProxyLifecycleState> {
  const result = await pool.query<{ state: CloneProxyLifecycleState }>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id='cloneproxy'")
  return result.rows[0]?.state ?? 'active'
}

export async function getCloneProxyLifecycleStatus(pool: Pick<Pool, 'query'>) {
  const [state, blockers, executions] = await Promise.all([
    getCloneProxyLifecycle(pool),
    pool.query<{count:number}>("SELECT (SELECT count(*) FROM t_telegram_clone_proxy_order WHERE order_type='opening' AND status IN (0,1))::int+(SELECT count(*) FROM t_platform_cloneproxy_token_waiter WHERE consumed_at IS NULL AND expires_at>now())::int AS count"),
    pool.query<{count:number}>("SELECT count(*)::int AS count FROM t_platform_plugin_execution WHERE plugin_id='cloneproxy' AND lease_until>now()"),
  ])
  return { state, blockers: blockers.rows[0]?.count ?? 0, executions: executions.rows[0]?.count ?? 0 }
}

/** Caller owns a transaction and must acquire lockCloneProxyLifecycle first. */
export async function transitionCloneProxyLifecycle(client: PoolClient, action: CloneProxyLifecycleAction) {
  const found = await client.query<{ state: CloneProxyLifecycleState; enabled_bot_ids: number[] }>("SELECT state,enabled_bot_ids FROM t_platform_plugin_lifecycle WHERE plugin_id='cloneproxy' FOR UPDATE")
  const current = found.rows[0] ?? { state: 'active' as const, enabled_bot_ids: [] }
  if (action === 'install') {
    if (current.state !== 'uninstalled') throw new Error('plugin_not_uninstalled')
    await client.query('UPDATE t_telegram_clone_proxy_config SET is_enable=1,update_time=now() WHERE master_bot_rid=ANY($1::integer[])',[current.enabled_bot_ids])
    await client.query("UPDATE t_platform_plugin_lifecycle SET state='active',enabled_bot_ids='{}',enabled_at=now(),updated_at=now() WHERE plugin_id='cloneproxy'")
    return 'active' as const
  }
  if (action === 'disable') {
    if (current.state === 'uninstalled') throw new Error('plugin_uninstalled')
    if (current.state === 'draining') return current.state
    const bots = await client.query<{ master_bot_rid: number }>('UPDATE t_telegram_clone_proxy_config SET is_enable=0,update_time=now() WHERE is_enable=1 RETURNING master_bot_rid')
    await client.query("INSERT INTO t_platform_plugin_lifecycle(plugin_id,state,enabled_bot_ids,disabled_at,updated_at) VALUES('cloneproxy','draining',$1,now(),now()) ON CONFLICT(plugin_id) DO UPDATE SET state=EXCLUDED.state,enabled_bot_ids=EXCLUDED.enabled_bot_ids,disabled_at=now(),updated_at=now()", [bots.rows.map(r => r.master_bot_rid)])
    return 'draining' as const
  }
  if (action === 'resume') {
    if (current.state === 'uninstalled') throw new Error('plugin_uninstalled')
    if (current.state === 'active') return current.state
    await client.query('UPDATE t_telegram_clone_proxy_config SET is_enable=1,update_time=now() WHERE master_bot_rid=ANY($1::integer[])', [current.enabled_bot_ids])
    await client.query("UPDATE t_platform_plugin_lifecycle SET state='active',enabled_bot_ids='{}',enabled_at=now(),updated_at=now() WHERE plugin_id='cloneproxy'")
    return 'active' as const
  }
  if (current.state === 'uninstalled') return current.state
  if (current.state !== 'draining') throw new Error('plugin_must_drain')
  const blockers = await client.query<{ orders: number; waiters: number; executions:number }>("SELECT (SELECT count(*)::int FROM t_telegram_clone_proxy_order WHERE order_type='opening' AND status IN (0,1)) AS orders, (SELECT count(*)::int FROM t_platform_cloneproxy_token_waiter WHERE consumed_at IS NULL AND expires_at>now()) AS waiters,(SELECT count(*)::int FROM t_platform_plugin_execution WHERE plugin_id='cloneproxy' AND lease_until>now()) AS executions")
  if (Object.values(blockers.rows[0]).some(Number)) throw new Error('plugin_has_outstanding_business')
  await client.query("UPDATE t_platform_plugin_lifecycle SET state='uninstalled',updated_at=now() WHERE plugin_id='cloneproxy'")
  return 'uninstalled' as const
}

export async function changeCloneProxyLifecycle(pool: Database, action: CloneProxyLifecycleAction) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await lockCloneProxyLifecycle(client)
    const state = await transitionCloneProxyLifecycle(client, action)
    await client.query('COMMIT')
    return state
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

export function guardCloneProxyWrite(request: Request, handler: (request: Request) => Promise<Response>) {
  return run(async () => {
    if (request.method === 'GET' || request.method === 'HEAD') return handler(request)
    const client = await db.connect()
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended('plugin:cloneproxy:lifecycle',0))")
      const user = await identity(request)
      const allowed = can(user, '克隆/代理基础设置', 'admin.telegram.cloneproxy.basic') || can(user, '克隆/代理商户管理', 'admin.telegram.cloneproxy.merchants')
      if (!allowed) return Response.json({ message: '没有操作权限' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
      const state = await client.query<{state:string}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id='cloneproxy'")
      if (!pluginAcceptsWrites(state.rows[0]?.state)) return Response.json({ message: state.rows[0]?.state === 'draining' ? '插件正在排空，暂不接受新操作' : '插件已卸载' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
      return await handler(request)
    } finally { await client.query("SELECT pg_advisory_unlock(hashtextextended('plugin:cloneproxy:lifecycle',0))").catch(()=>undefined); client.release() }
  })
}
