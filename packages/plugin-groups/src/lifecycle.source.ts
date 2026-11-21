import type { Pool, PoolClient } from 'pg'

type Db = Pick<Pool, 'query' | 'connect'>
export type GroupPluginState = 'active' | 'draining' | 'uninstalled'
export type GroupPluginAction = 'disable' | 'resume' | 'uninstall' | 'install'
const lockSql = "SELECT pg_advisory_xact_lock(hashtextextended('plugin:groups:lifecycle',0))"

export async function lockGroupsPlugin(client: Pick<PoolClient, 'query'>) {
  await client.query(lockSql)
}

export async function groupsPluginStatus(pool: Pick<Pool, 'query'>) {
  const [state, queue] = await Promise.all([
    pool.query<{ state: GroupPluginState }>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id='groups'"),
    pool.query<{ pending: number; paused: number; processing: number; failed: number }>("SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='paused')::int AS paused,count(*) FILTER(WHERE status='processing')::int AS processing,count(*) FILTER(WHERE status='failed')::int AS failed FROM t_platform_plugin_task WHERE plugin_id='groups'"),
  ])
  return { state: state.rows[0]?.state ?? 'active', queue: queue.rows[0] }
}

export async function changeGroupsPlugin(pool: Db, action: GroupPluginAction) {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await lockGroupsPlugin(c)
    const row = await c.query<{state:GroupPluginState}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id='groups' FOR UPDATE")
    const state = row.rows[0]?.state ?? 'active'
    let next: GroupPluginState
    if (action === 'disable') {
      if (state === 'uninstalled') throw new Error('groups_plugin_uninstalled')
      next = 'draining'
    } else if (action === 'resume') {
      if (state === 'uninstalled') throw new Error('groups_plugin_uninstalled')
      await c.query("UPDATE t_platform_plugin_task SET status='pending',next_attempt_at=now(),last_error_code=NULL WHERE plugin_id='groups' AND status='paused'")
      next = 'active'
    } else if (action === 'install') {
      if (state !== 'uninstalled') throw new Error('groups_plugin_already_installed')
      await c.query("UPDATE t_platform_plugin_task SET status='pending',next_attempt_at=now(),last_error_code=NULL WHERE plugin_id='groups' AND status='paused'")
      next = 'active'
    } else {
      if (state === 'uninstalled') { await c.query('COMMIT'); return state }
      if (state !== 'draining') throw new Error('groups_plugin_must_drain')
      const active = await c.query("SELECT count(*)::int AS n FROM t_platform_plugin_task WHERE plugin_id='groups' AND status IN ('pending','processing') OR plugin_id='groups' AND status='failed' AND attempts<8")
      if (Number(active.rows[0]?.n ?? 0)) throw new Error('groups_plugin_tasks_not_drained')
      next = 'uninstalled'
    }
    await c.query("INSERT INTO t_platform_plugin_lifecycle(plugin_id,state,enabled_bot_ids,updated_at) VALUES('groups',$1,'{}',now()) ON CONFLICT(plugin_id) DO UPDATE SET state=EXCLUDED.state,disabled_at=CASE WHEN EXCLUDED.state='draining' THEN now() ELSE t_platform_plugin_lifecycle.disabled_at END,enabled_at=CASE WHEN EXCLUDED.state='active' THEN now() ELSE t_platform_plugin_lifecycle.enabled_at END,updated_at=now()", [next])
    await c.query('COMMIT')
    return next
  } catch (error) { await c.query('ROLLBACK'); throw error }
  finally { c.release() }
}
