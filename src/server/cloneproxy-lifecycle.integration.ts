import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import type { Pool, QueryResultRow } from 'pg'
import { db } from './db.server'
import { changeCloneProxyLifecycle, getCloneProxyLifecycle } from '../plugins/cloneproxy/lifecycle.server'

const schema='cloneproxy_lifecycle_test_'+randomUUID().replaceAll('-','')
let created=false
let pool:Pool

test('clone proxy lifecycle waits for writes, preserves business data, and blocks unfinished operations',async()=>{
  await db.query(`CREATE SCHEMA "${schema}"`);created=true
  const connect=db.connect.bind(db)
  pool={
    connect:async()=>{const c=await connect();await c.query(`SET search_path TO "${schema}",public`);return c},
    query:async<T extends QueryResultRow=QueryResultRow>(sql:string,values?:unknown[])=>{const c=await connect();try{await c.query(`SET search_path TO "${schema}",public`);return await c.query<T>(sql,values)}finally{c.release()}},
  } as unknown as Pool
  await pool.query("CREATE TABLE t_platform_plugin_lifecycle(plugin_id text primary key,state text not null,enabled_bot_ids integer[] not null default '{}',disabled_at timestamptz,enabled_at timestamptz,updated_at timestamptz not null default now())")
  await pool.query('CREATE TABLE t_platform_plugin_execution(plugin_id text,task_name text,owner text,lease_until timestamptz,started_at timestamptz default now(),primary key(plugin_id,task_name))')
  await pool.query('CREATE TABLE t_telegram_clone_proxy_config(master_bot_rid integer primary key,is_enable integer,update_time timestamptz)')
  await pool.query('CREATE TABLE t_telegram_clone_proxy_merchant(rid integer primary key)')
  await pool.query('CREATE TABLE t_telegram_clone_proxy_order(rid integer primary key,order_type text,status integer)')
  await pool.query('CREATE TABLE t_platform_cloneproxy_token_waiter(consumed_at timestamptz,expires_at timestamptz)')
  await pool.query("INSERT INTO t_platform_plugin_lifecycle(plugin_id,state) VALUES('cloneproxy','active')")
  await pool.query('INSERT INTO t_telegram_clone_proxy_config VALUES(1,1,now()),(2,0,now())')

  const inflight=await pool.connect();await inflight.query('BEGIN')
  await inflight.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('plugin:cloneproxy:lifecycle',0))")
  let finished=false
  const disabling=changeCloneProxyLifecycle(pool,'disable').then(value=>{finished=true;return value})
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(finished,false)
  await inflight.query('COMMIT');inflight.release()
  assert.equal(await disabling,'draining')
  assert.equal(await changeCloneProxyLifecycle(pool,'disable'),'draining','repeated disable stays draining')
  assert.deepEqual((await pool.query('SELECT is_enable FROM t_telegram_clone_proxy_config ORDER BY master_bot_rid')).rows.map(r=>r.is_enable),[0,0])

  await pool.query("INSERT INTO t_telegram_clone_proxy_order VALUES(1,'opening',1)")
  await assert.rejects(changeCloneProxyLifecycle(pool,'uninstall'),/plugin_has_outstanding_business/)
  await pool.query('DELETE FROM t_telegram_clone_proxy_order')
  await pool.query('INSERT INTO t_platform_cloneproxy_token_waiter VALUES(NULL,now()+interval \'5 minutes\')')
  await assert.rejects(changeCloneProxyLifecycle(pool,'uninstall'),/plugin_has_outstanding_business/)
  await pool.query('DELETE FROM t_platform_cloneproxy_token_waiter')
  await pool.query('INSERT INTO t_platform_plugin_execution(plugin_id,task_name,owner,lease_until) VALUES(\'cloneproxy\',\'synctelegramcloneproxyrevenue\',\'fixture\',now()+interval \'1 minute\')')
  await assert.rejects(changeCloneProxyLifecycle(pool,'uninstall'),/plugin_has_outstanding_business/)
  await pool.query('DELETE FROM t_platform_plugin_execution')

  await pool.query('INSERT INTO t_telegram_clone_proxy_merchant VALUES(77)')
  assert.equal(await changeCloneProxyLifecycle(pool,'uninstall'),'uninstalled')
  assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM t_telegram_clone_proxy_merchant')).rows[0].n),1,'logical uninstall keeps existing merchant data')
  assert.equal(await getCloneProxyLifecycle(pool),'uninstalled')
  await assert.rejects(changeCloneProxyLifecycle(pool,'resume'),/plugin_uninstalled/)
  assert.equal(await changeCloneProxyLifecycle(pool,'install'),'active')
  assert.equal(await changeCloneProxyLifecycle(pool,'resume'),'active','repeated resume stays active')
  assert.deepEqual((await pool.query('SELECT is_enable FROM t_telegram_clone_proxy_config ORDER BY master_bot_rid')).rows.map(row=>row.is_enable),[1,0])
  assert.equal(Number((await pool.query('SELECT count(*)::int AS n FROM t_telegram_clone_proxy_merchant')).rows[0].n),1)
  await assert.rejects(changeCloneProxyLifecycle(pool,'install'),/plugin_not_uninstalled/)
})

after(async()=>{if(created)await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)})
