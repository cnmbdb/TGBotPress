import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import type { Pool, PoolClient, QueryResultRow } from 'pg'
import { db } from '../../server/db.server'
import { changeGroupsPlugin, groupsPluginStatus } from './lifecycle.server'
import { enqueueGroupManagementUpdate, syncGroupManagementTasks } from './tasks.server'

const schema = `groups_plugin_test_${randomUUID().replaceAll('-', '')}`
let isolated: Pool | undefined
let initialized = false

test('group plugin persists pause, drains, uninstalls without data loss, and replays once', async t => {
  if (!process.env.PLATFORM_DB_HOST && !process.env.DB_HOST) { t.skip('No sandbox PostgreSQL configured'); return }
  await db.query(`CREATE SCHEMA "${schema}"`)
  initialized = true
  const connect = db.connect.bind(db)
  isolated = {
    ...db,
    connect: async () => { const client = await connect(); await client.query(`SET search_path TO "${schema}", public`); return client },
    query: async <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => { const client = await connect(); try { await client.query(`SET search_path TO "${schema}", public`); return await client.query<T>(sql, values) } finally { client.release() } },
  } as unknown as Pool
  const pool = isolated
  await pool.query(`CREATE TABLE t_platform_telegram_update(rid bigserial primary key,bot_rid integer not null,update_id bigint not null,update_body jsonb not null,status text not null,attempts integer not null default 0,unique(bot_rid,update_id))`)
  await pool.query(await readFile(new URL('../../../migrations/025-platform-plugin-lifecycle.sql', import.meta.url), 'utf8'))
  await pool.query(await readFile(new URL('../../../migrations/026-platform-groups-plugin.sql', import.meta.url), 'utf8'))

  async function intake(updateId: number) {
    const client: PoolClient = await pool.connect()
    try {
      await client.query('BEGIN')
      const body = { update_id: updateId, message: { chat: { id: -1001, type: 'supergroup' }, text: `hello ${updateId}` } }
      const inserted = await client.query<{rid:number}>("INSERT INTO t_platform_telegram_update(bot_rid,update_id,update_body,status) VALUES(1,$1,$2::jsonb,'processed') ON CONFLICT(bot_rid,update_id) DO NOTHING RETURNING rid", [updateId, JSON.stringify(body)])
      const inbox = inserted.rowCount ? inserted : await client.query<{rid:number}>('SELECT rid FROM t_platform_telegram_update WHERE bot_rid=1 AND update_id=$1', [updateId])
      await enqueueGroupManagementUpdate(client, inbox.rows[0].rid, 1, body)
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }

  await intake(101)
  await intake(101)
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM t_platform_plugin_task WHERE plugin_id='groups'")).rows[0].n), 1, 'duplicate Telegram update has one plugin task')

  await changeGroupsPlugin(pool, 'disable')
  assert.equal(await changeGroupsPlugin(pool, 'disable'),'draining','repeated disable stays draining')
  assert.equal((await groupsPluginStatus(pool)).state, 'draining')
  await intake(102)
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM t_platform_plugin_task WHERE status='paused'")).rows[0].n), 1, 'new group tasks pause while draining')

  const executions = new Map<number, number>()
  const first = await syncGroupManagementTasks({ pool, process: async (task: { source_update_rid: number }) => { executions.set(task.source_update_rid, (executions.get(task.source_update_rid) ?? 0) + 1) } })
  assert.equal(first.processed, 1, 'draining worker completes previously accepted work')
  await changeGroupsPlugin(pool, 'uninstall')
  assert.equal((await groupsPluginStatus(pool)).state, 'uninstalled')
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM t_platform_plugin_task WHERE status='paused'")).rows[0].n), 1, 'uninstall retains paused work')
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM t_platform_telegram_update")).rows[0].n), 2, 'uninstall preserves inbox data')
  assert.deepEqual(await syncGroupManagementTasks({ pool, process: async () => assert.fail('uninstalled plugin must not execute') }), { skipped: true, processed: 0, failed: 0 })

  await changeGroupsPlugin(pool, 'install')
  assert.equal(await changeGroupsPlugin(pool,'resume'),'active','repeated resume stays active')
  assert.equal((await groupsPluginStatus(pool)).state, 'active')
  const second = await syncGroupManagementTasks({ pool, process: async (task: { source_update_rid: number }) => { executions.set(task.source_update_rid, (executions.get(task.source_update_rid) ?? 0) + 1) } })
  assert.equal(second.processed, 1, 'reinstall replays held work')
  const repeat = await syncGroupManagementTasks({ pool, process: async (task: { source_update_rid: number }) => { executions.set(task.source_update_rid, (executions.get(task.source_update_rid) ?? 0) + 1) } })
  assert.equal(repeat.processed, 0, 'processed group work is not replayed twice')
  assert.deepEqual([...executions.values()].sort(), [1, 1])

  // Hold one claimed task while disable/intake race, then prove uninstall waits for it.
  await intake(105)
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const running = syncGroupManagementTasks({ pool, batchSize: 1, process: async task => { entered(); await hold; executions.set(task.source_update_rid, (executions.get(task.source_update_rid) ?? 0) + 1) } })
  await started
  await Promise.all([changeGroupsPlugin(pool, 'disable'), intake(103)])
  assert.equal((await groupsPluginStatus(pool)).state, 'draining')
  await assert.rejects(changeGroupsPlugin(pool, 'uninstall'), /groups_plugin_tasks_not_drained/)
  release()
  await running
  await intake(104)
  for (let i = 0; i < 4; i++) {
    const drained = await syncGroupManagementTasks({ pool, process: async task => { executions.set(task.source_update_rid, (executions.get(task.source_update_rid) ?? 0) + 1) } })
    if (!drained.processed) break
  }
  assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM t_platform_plugin_task WHERE plugin_id='groups' AND status IN ('pending','processing')")).rows[0].n), 0)
  assert.ok(Number((await pool.query("SELECT count(*)::int AS n FROM t_platform_plugin_task WHERE plugin_id='groups' AND status='paused'")).rows[0].n) >= 1)
  await changeGroupsPlugin(pool, 'uninstall')
  await changeGroupsPlugin(pool, 'install')
  const replay = await syncGroupManagementTasks({ pool, process: async task => { executions.set(task.source_update_rid, (executions.get(task.source_update_rid) ?? 0) + 1) } })
  assert.ok(replay.processed >= 1, 'reinstall resumes tasks accepted during the disable race')
  assert.ok([...executions.values()].every(count => count === 1), 'each successful update is processed exactly once')
})

after(async () => {
  if (initialized) await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await db.end()
})
