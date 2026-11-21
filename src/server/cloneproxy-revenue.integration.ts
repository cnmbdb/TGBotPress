import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { syncCloneProxyRevenue } from './cloneproxy-revenue.server'
import { changeCloneProxyLifecycle } from '../plugins/cloneproxy/lifecycle.server'
import { runPluginTaskWithLease } from '../plugins/module-lifecycle.server'

const connectionString = process.env.TG_CLONE_PROXY_TEST_DB_URL
const testDatabaseUrl = connectionString ? new URL(connectionString) : null
const privateIPv4 = testDatabaseUrl?.hostname.split('.').map(Number)
const isPrivateHost = testDatabaseUrl?.hostname === 'postgres' || (process.env.TG_CLONE_PROXY_TEST_ALLOW_PRIVATE_DB === '1' && privateIPv4?.length === 4 && (privateIPv4[0] === 10 || (privateIPv4[0] === 172 && privateIPv4[1] >= 16 && privateIPv4[1] <= 31) || (privateIPv4[0] === 192 && privateIPv4[1] === 168)))
if (!connectionString || !isPrivateHost) throw new Error('Clone proxy integration requires the disposable sandbox PostgreSQL service')
const schema = 'cloneproxy_' + randomUUID().replaceAll('-', '')
const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema + ' -c timezone=Asia/Shanghai', max: 8 })
await pool.query('CREATE SCHEMA ' + schema)
await pool.query("CREATE TABLE t_platform_plugin_lifecycle(plugin_id text PRIMARY KEY,state text NOT NULL,enabled_bot_ids integer[] NOT NULL DEFAULT '{}',disabled_at timestamptz,enabled_at timestamptz,updated_at timestamptz DEFAULT now())")
await pool.query('CREATE TABLE t_platform_plugin_execution(plugin_id text NOT NULL,task_name text NOT NULL,owner text NOT NULL,lease_until timestamptz NOT NULL,PRIMARY KEY(plugin_id,task_name))')
await pool.query('CREATE TABLE t_platform_cloneproxy_token_waiter(consumed_at timestamptz,expires_at timestamptz)')
await pool.query('CREATE TABLE t_telegram_clone_proxy_config(master_bot_rid integer PRIMARY KEY,is_enable integer,update_time timestamptz)')
await pool.query('INSERT INTO t_telegram_clone_proxy_config VALUES(10,1,now())')
await pool.query('CREATE TABLE t_telegram_clone_proxy_merchant (rid bigserial PRIMARY KEY,master_bot_rid integer NOT NULL,bot_rid integer NOT NULL,owner_tg_uid bigint NOT NULL,owner_tg_username text NOT NULL,owner_tg_name text,revenue_ratio numeric(7,2) NOT NULL,status smallint NOT NULL DEFAULT 1,total_revenue_usdt numeric(20,6) NOT NULL DEFAULT 0,total_revenue_trx numeric(20,6) NOT NULL DEFAULT 0,update_time timestamp)')
await pool.query('CREATE TABLE t_telegram_clone_proxy_order (rid bigserial PRIMARY KEY,merchant_rid bigint,master_bot_rid integer NOT NULL,bot_rid integer,order_type text NOT NULL,source_type text NOT NULL,source_order_rid bigint,pay_user_tg_uid bigint NOT NULL,pay_user_tg_username text,amount numeric(20,6) NOT NULL,need_pay_amount numeric(20,6) NOT NULL,coin_name text NOT NULL,payment_method text NOT NULL,status smallint NOT NULL,revenue_ratio numeric(7,2) NOT NULL,revenue_amount numeric(20,6) NOT NULL,tx_hash text,comments text,create_time timestamp,update_time timestamp,paid_time timestamp,complete_time timestamp)')
await pool.query('CREATE UNIQUE INDEX uq_cloneproxy_test_source ON t_telegram_clone_proxy_order(source_type,source_order_rid) WHERE source_order_rid IS NOT NULL')
await pool.query('CREATE TABLE t_telegram_bot_user (rid serial PRIMARY KEY,bot_rid integer NOT NULL,tg_uid bigint NOT NULL,tg_username text,tg_nickname text,status smallint NOT NULL,cash_trx numeric(20,6) NOT NULL DEFAULT 0,cash_usdt numeric(20,6) NOT NULL DEFAULT 0,max_monitor_wallet integer NOT NULL DEFAULT 0,first_time timestamp)')
await pool.query('CREATE TABLE t_premium_platform_order (rid integer PRIMARY KEY,bot_rid integer NOT NULL,buy_tg_uid text NOT NULL,buy_tg_username text,need_pay_usdt numeric(12,4) NOT NULL,status smallint NOT NULL,tx_hash text,complete_time timestamp,create_time timestamp)')
await pool.query('CREATE TABLE t_shop_order (rid integer PRIMARY KEY,bot_rid integer NOT NULL,tg_uid text NOT NULL,tg_username text,pay_price varchar(50),pay_type smallint NOT NULL,pay_time timestamp)')
await pool.query('CREATE TABLE t_energy_quick_order (rid integer PRIMARY KEY,bot_rid integer NOT NULL,tg_uid text NOT NULL,pay_price numeric(20,6),pay_type varchar(20),status smallint NOT NULL,pay_time timestamp)')

try {
 await test('settles each paid order once across premium, shop, and energy sources', async () => {
  await pool.query("INSERT INTO t_telegram_clone_proxy_merchant (rid,master_bot_rid,bot_rid,owner_tg_uid,owner_tg_username,owner_tg_name,revenue_ratio) VALUES(1,10,20,9001,'owner','Owner',12.34)")
  await pool.query("INSERT INTO t_premium_platform_order VALUES(101,20,'1001','alice',10.0000,2,NULL,NULL,now()-interval '2 days')")
  await pool.query("INSERT INTO t_shop_order VALUES(201,20,'1002','bob','2.500000',1,now()-interval '1 day'),(202,20,'1003','bad','free',2,now())")
  await pool.query("INSERT INTO t_energy_quick_order VALUES(301,20,'1004',1.000000,'usdt',9,now())")

  const first = await syncCloneProxyRevenue(pool)
  assert.deepEqual([first.merchants, first.scanned, first.credited, first.duplicates, first.failed, first.stopped], [1, 3, 3, 0, 0, false])
  const balances = await pool.query('SELECT cash_usdt::text,cash_trx::text FROM t_telegram_bot_user WHERE bot_rid=10 AND tg_uid=9001')
  assert.deepEqual(balances.rows[0], { cash_usdt: '1.357400', cash_trx: '0.308500' })
  const totals = await pool.query('SELECT total_revenue_usdt::text,total_revenue_trx::text FROM t_telegram_clone_proxy_merchant WHERE rid=1')
  assert.deepEqual(totals.rows[0], { total_revenue_usdt: '1.357400', total_revenue_trx: '0.308500' })
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM t_telegram_clone_proxy_order WHERE order_type=\'revenue\'')).rows[0].count, 3)

  const second = await syncCloneProxyRevenue(pool)
  assert.deepEqual([second.scanned, second.credited, second.duplicates, second.failed], [0, 0, 0, 0])
 })

 await test('duplicate concurrent delivery credits one new source order', async () => {
  await pool.query("INSERT INTO t_premium_platform_order VALUES(102,20,'1005','carol',5.0000,2,'hash',now(),now())")
  const outcomes = await Promise.all([syncCloneProxyRevenue(pool), syncCloneProxyRevenue(pool)])
  assert.equal(outcomes.reduce((sum, item) => sum + item.credited, 0), 1)
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM t_telegram_clone_proxy_order WHERE source_type=\'premium\' AND source_order_rid=102')).rows[0].count, 1)
  assert.equal((await pool.query('SELECT cash_usdt::text FROM t_telegram_bot_user WHERE bot_rid=10 AND tg_uid=9001')).rows[0].cash_usdt, '1.974400')
 })
 await test('revenue settles during draining and continues once resumed', async () => {
  assert.equal(await changeCloneProxyLifecycle(pool, 'disable'), 'draining')
  await pool.query("INSERT INTO t_premium_platform_order VALUES(103,20,'1006','eve',10.0000,2,NULL,now(),now())")
  assert.equal((await syncCloneProxyRevenue(pool)).credited, 1)
  assert.equal(await changeCloneProxyLifecycle(pool, 'resume'), 'active')
  await pool.query("INSERT INTO t_premium_platform_order VALUES(104,20,'1007','eve',10.0000,2,NULL,now(),now())")
  assert.equal((await syncCloneProxyRevenue(pool)).credited, 1)
  assert.equal((await syncCloneProxyRevenue(pool)).credited, 0)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM t_telegram_clone_proxy_order WHERE source_type='premium' AND source_order_rid IN (103,104)")).rows[0].n, 2)
 })
 await test('uninstall waits for a leased revenue worker and prevents new workers afterward', async () => {
  await pool.query("UPDATE t_platform_plugin_lifecycle SET state='draining' WHERE plugin_id='cloneproxy'")
  await pool.query("INSERT INTO t_premium_platform_order VALUES(105,20,'1008','race',10.0000,2,NULL,now(),now())")
  let start!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { start = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const taskName = 'synctelegramcloneproxyrevenue'
  const settling = runPluginTaskWithLease('cloneproxy', taskName, [taskName], async () => {
    start()
    await gate
    return syncCloneProxyRevenue(pool)
  }, pool)
  await started
  try { await assert.rejects(changeCloneProxyLifecycle(pool, 'uninstall'), /plugin_has_outstanding_business/) }
  finally { release() }
  assert.equal((await settling).credited, 1)
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM t_telegram_clone_proxy_order WHERE source_type='premium' AND source_order_rid=105")).rows[0].n, 1)
  assert.equal(await changeCloneProxyLifecycle(pool, 'uninstall'), 'uninstalled')
  assert.deepEqual(await runPluginTaskWithLease('cloneproxy', taskName, [taskName], async () => assert.fail('uninstalled task ran'), pool), { skipped: true, reason: 'plugin_uninstalled' })
 })
} finally {
 await pool.query('DROP SCHEMA ' + schema + ' CASCADE')
 await pool.end()
}
