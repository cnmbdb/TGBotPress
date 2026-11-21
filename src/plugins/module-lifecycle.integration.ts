import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import type { Pool, QueryResultRow } from 'pg'
import { db } from '../server/db.server'
import { changeManagedPlugin, managedPluginStatus, pluginAcceptsWrites, pluginUpdateAllowed, claimManagedPluginUpdate, releaseManagedPluginUpdate, runManagedPluginTask } from './module-lifecycle.server'

const schema = `plugin_lifecycle_test_${randomUUID().replaceAll('-', '')}`
let initialized = false
let isolated: Pool

test('plugin writes are allowed only when active', () => {
  assert.equal(pluginAcceptsWrites('active'),true)
  assert.equal(pluginAcceptsWrites('draining'),false)
  assert.equal(pluginAcceptsWrites('uninstalled'),false)
})

test('managed plugin lifecycle drains, blocks uninstall, preserves data, and restores on reinstall', async t => {
  if (!process.env.PLATFORM_DB_HOST && !process.env.DB_HOST) { t.skip('No sandbox PostgreSQL configured'); return }
  await db.query(`CREATE SCHEMA "${schema}"`)
  initialized = true
  const connect = db.connect.bind(db)
  isolated = {
    connect: async () => { const c = await connect(); await c.query(`SET search_path TO "${schema}",public`); return c },
    query: async <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => { const c = await connect(); try { await c.query(`SET search_path TO "${schema}",public`); return await c.query<T>(sql, values) } finally { c.release() } },
  } as unknown as Pool
  await isolated.query("CREATE TABLE t_platform_plugin_lifecycle(plugin_id text primary key,state text not null,enabled_bot_ids integer[] not null default '{}',updated_at timestamptz not null default now())")
  await isolated.query('CREATE TABLE t_transit_wallet_trade_list(rid serial primary key,process_status integer not null)')
  await isolated.query('CREATE TABLE t_platform_job_outbox(task_name text,status text)')
  await isolated.query('CREATE TABLE t_platform_telegram_update(rid bigserial primary key,status text,update_body jsonb not null,received_at timestamptz not null default now())')
  await isolated.query('CREATE TABLE t_energy_wallet_trade_list(process_status integer)')
  await isolated.query('CREATE TABLE t_energy_quick_order(status integer)')
  await isolated.query('CREATE TABLE t_energy_platform_order(recovery_status integer)')
  await isolated.query('CREATE TABLE t_energy_ai_bishu(is_buy text)')
  await isolated.query('CREATE TABLE t_premium_wallet_trade_list(process_status integer)')
  await isolated.query('CREATE TABLE t_premium_platform_order(status integer)')
  await isolated.query('CREATE TABLE t_platform_collection_wallet_action(state text)')
  await isolated.query(await readFile(new URL('../../migrations/027-platform-plugin-lifecycle-modules.sql', import.meta.url), 'utf8'))
  const initial = await isolated.query("SELECT plugin_id,state FROM t_platform_plugin_lifecycle WHERE plugin_id IN ('transit','energy','premium','monitor','collection','shop') ORDER BY plugin_id")
  assert.equal(initial.rowCount, 6)
  assert.ok(initial.rows.every(row => row.state === 'active'))
  await isolated.query('INSERT INTO t_energy_wallet_trade_list(process_status) VALUES(1)')
  assert.equal((await managedPluginStatus(isolated,'energy')).blockers,1)
  await changeManagedPlugin(isolated,'energy','disable')
  await assert.rejects(changeManagedPlugin(isolated,'energy','uninstall'),/plugin_has_outstanding_business:1/)
  await isolated.query('UPDATE t_energy_wallet_trade_list SET process_status=9')
  await changeManagedPlugin(isolated,'energy','uninstall');await changeManagedPlugin(isolated,'energy','install')
  await isolated.query('INSERT INTO t_premium_platform_order(status) VALUES(6)')
  assert.equal((await managedPluginStatus(isolated,'premium')).blockers,1)
  await changeManagedPlugin(isolated,'premium','disable')
  await assert.rejects(changeManagedPlugin(isolated,'premium','uninstall'),/plugin_has_outstanding_business:1/)
  await isolated.query('UPDATE t_premium_platform_order SET status=2')
  await changeManagedPlugin(isolated,'premium','uninstall');await changeManagedPlugin(isolated,'premium','install')
  await isolated.query("INSERT INTO t_platform_collection_wallet_action(state) VALUES('signing')")
  assert.equal((await managedPluginStatus(isolated,'collection')).blockers,1)
  await changeManagedPlugin(isolated,'collection','disable')
  await assert.rejects(changeManagedPlugin(isolated,'collection','uninstall'),/plugin_has_outstanding_business:1/)
  await isolated.query("UPDATE t_platform_collection_wallet_action SET state='succeeded'")
  await changeManagedPlugin(isolated,'collection','uninstall');await changeManagedPlugin(isolated,'collection','install')
  for (const id of ['energy','premium','monitor','collection','shop'] as const) {
    assert.equal(await changeManagedPlugin(isolated,id,'disable'),'draining')
    assert.equal(await changeManagedPlugin(isolated,id,'disable'),'draining','repeated disable stays draining')
    assert.equal((await managedPluginStatus(isolated,id)).state,'draining')
    assert.equal(await changeManagedPlugin(isolated,id,'uninstall'),'uninstalled')
    assert.equal(await changeManagedPlugin(isolated,id,'install'),'active')
    assert.equal(await changeManagedPlugin(isolated,id,'resume'),'active','repeated resume stays active')
  }

  await assert.rejects(changeManagedPlugin(isolated,'transit','disable'),/plugin_has_dependents:collection/)
  await changeManagedPlugin(isolated,'collection','disable')
  await changeManagedPlugin(isolated,'collection','uninstall')
  await isolated.query('INSERT INTO t_transit_wallet_trade_list(process_status) VALUES(1)')
  await changeManagedPlugin(isolated, 'transit', 'disable')
  assert.equal((await managedPluginStatus(isolated, 'transit')).state, 'draining')
  assert.equal((await managedPluginStatus(isolated, 'transit')).blockers, 1)
  const disabledAt=await isolated.query<{disabled_at:Date}>("SELECT disabled_at FROM t_platform_plugin_lifecycle WHERE plugin_id='transit'")
  assert.equal(await pluginUpdateAllowed(isolated,'transit',new Date(disabledAt.rows[0].disabled_at.getTime()-10)),true,'pre-disable Telegram actions remain drainable')
  assert.equal(await pluginUpdateAllowed(isolated,'transit',new Date(disabledAt.rows[0].disabled_at.getTime()+10)),false,'new Telegram actions are rejected during drain')
  await isolated.query('UPDATE t_transit_wallet_trade_list SET process_status=9 WHERE rid=1')
  const acceptedUpdate=await claimManagedPluginUpdate(isolated,'transit',900,new Date(disabledAt.rows[0].disabled_at.getTime()-10))
  assert.equal(acceptedUpdate.allowed,true,'a Telegram action received before disable remains claimable')
  await assert.rejects(changeManagedPlugin(isolated,'transit','uninstall'),/plugin_tasks_still_running:1/)
  await releaseManagedPluginUpdate(isolated,'transit',900,acceptedUpdate.owner)
  const rejectedUpdate=await claimManagedPluginUpdate(isolated,'transit',901,new Date(disabledAt.rows[0].disabled_at.getTime()+10))
  assert.equal(rejectedUpdate.allowed,false,'a new Telegram action is denied during drain')
  await isolated.query('UPDATE t_transit_wallet_trade_list SET process_status=1 WHERE rid=1')
  await assert.rejects(changeManagedPlugin(isolated,'transit','uninstall'),/plugin_has_outstanding_business:1/)
  await isolated.query('UPDATE t_transit_wallet_trade_list SET process_status=9 WHERE rid=1')
  const drainingScan = await runManagedPluginTask('transit','transitwalletusdttrade',async()=>({continued:true}),isolated)
  assert.deepEqual(drainingScan,{continued:true},'deposit discovery continues to settle transfers during transit drain')
  await isolated.query("INSERT INTO t_platform_telegram_update(status,update_body) VALUES('pending','{\"callback_query\":{\"message\":{\"chat\":{\"type\":\"private\"}}}}'::jsonb)")
  await assert.rejects(changeManagedPlugin(isolated,'transit','uninstall'),/plugin_telegram_updates_pending:1/)
  await isolated.query("UPDATE t_platform_telegram_update SET status='processed'")

  let entered!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { entered=resolve })
  const hold = new Promise<void>(resolve => { release=resolve })
  const current = runManagedPluginTask('transit','shanduiBonus',async()=>{ entered(); await hold; return {processed:true} },isolated)
  await started
  await changeManagedPlugin(isolated,'transit','disable')
  const secondDisabledAt=await isolated.query<{disabled_at:Date}>("SELECT disabled_at FROM t_platform_plugin_lifecycle WHERE plugin_id='transit'")
  await assert.rejects(changeManagedPlugin(isolated,'transit','uninstall'),/plugin_tasks_still_running:1/)
  release()
  assert.deepEqual(await current,{processed:true})
  assert.equal(await changeManagedPlugin(isolated,'transit','uninstall'),'uninstalled')
  await assert.rejects(changeManagedPlugin(isolated,'collection','install'),/plugin_dependency_unavailable:transit/)
  assert.equal(Number((await isolated.query('SELECT count(*)::int AS n FROM t_transit_wallet_trade_list')).rows[0].n),1)
  const stopped = await runManagedPluginTask('transit','shanduiBonus',async()=>assert.fail('uninstalled plugin task executed'),isolated)
  assert.deepEqual(stopped,{skipped:true,reason:'plugin_uninstalled'})
  assert.equal(await changeManagedPlugin(isolated,'transit','install'),'active')
  const enabledAt=await isolated.query<{enabled_at:Date}>("SELECT enabled_at FROM t_platform_plugin_lifecycle WHERE plugin_id='transit'")
  assert.equal(await pluginUpdateAllowed(isolated,'transit',new Date(secondDisabledAt.rows[0].disabled_at.getTime()+10)),false,'updates received while disabled stay rejected after resume')
  assert.equal(await pluginUpdateAllowed(isolated,'transit',new Date(enabledAt.rows[0].enabled_at.getTime()+10)),true,'new Telegram actions work after reinstall')
  assert.equal((await managedPluginStatus(isolated,'transit')).state,'active')
  assert.equal(await changeManagedPlugin(isolated,'collection','install'),'active')
})

after(async()=>{ if(initialized) await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) })
