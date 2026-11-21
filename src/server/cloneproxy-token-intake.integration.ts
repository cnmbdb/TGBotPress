import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Pool } from 'pg'
import { handleCloneProxyTokenUpdate } from './cloneproxy-token-intake.server'
import { syncRechargeOrders } from './recharge-order-worker.server'
import { changeCloneProxyLifecycle, lockCloneProxyLifecycle } from '../plugins/cloneproxy/lifecycle.server'

const connectionString = process.env.PLATFORM_INTEGRATION_DATABASE_URL

test('clone proxy private token intake provisions atomically and delivers the durable success notification', { skip: !connectionString }, async () => {
  const schema = 'cloneproxy_token_test_' + randomUUID().replaceAll('-', '')
  const admin = new Pool({ connectionString })
  let pool: Pool | undefined
  const token = '123456:abcdefghijklmnopqrstuvwxyzABCDE_123456'
  const previousTelegramFlag = process.env.PLATFORM_TELEGRAM_ACTIONS
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    pool = new Pool({ connectionString, options: '-c search_path=' + schema, max: 4 })
    await pool.query('CREATE TABLE t_telegram_bot(rid serial PRIMARY KEY,bot_token varchar(100) NOT NULL,bot_admin_username varchar(100),bot_firstname varchar(100),bot_username varchar(100),comments varchar(255),create_by integer,create_time timestamp,update_by integer,update_time timestamp,recharge_wallet_addr varchar(100),get_tx_time timestamp,last_update_id bigint DEFAULT 0)')
    await pool.query('CREATE TABLE t_telegram_bot_user(rid serial PRIMARY KEY,bot_rid integer NOT NULL,tg_uid bigint NOT NULL,tg_username varchar(200),tg_nickname varchar(200),status smallint NOT NULL DEFAULT 1,first_time timestamp,cash_trx numeric(20,6) NOT NULL DEFAULT 0,cash_usdt numeric(20,6) NOT NULL DEFAULT 0,max_monitor_wallet integer NOT NULL DEFAULT 0,total_recharge_trx numeric(20,6) NOT NULL DEFAULT 0,total_recharge_usdt numeric(20,6) NOT NULL DEFAULT 0)')
    await pool.query('CREATE TABLE t_telegram_bot_command(rid serial PRIMARY KEY,bot_rid integer,command varchar(100),description varchar(255),command_type smallint,seq_sn integer,create_by integer,create_time timestamp,update_by integer,update_time timestamp)')
    await pool.query('CREATE TABLE t_telegram_bot_keyreply(rid serial PRIMARY KEY,bot_rid integer,key_type smallint,monitor_word varchar(255),reply_photo varchar(500),reply_content text,opt_type smallint,status smallint,create_by integer,create_time timestamp,update_by integer,update_time timestamp)')
    await pool.query('CREATE TABLE t_telegram_bot_keyreply_keyboard(rid serial PRIMARY KEY,bot_rid integer,keyreply_rid integer,keyboard_rid integer,create_by integer,create_time timestamp,update_by integer,update_time timestamp)')
    await pool.query('CREATE TABLE t_telegram_bot_ad(rid serial PRIMARY KEY,bot_rid integer,notice_cycle smallint,notice_obj varchar(200),notice_photo varchar(500),notice_ad varchar(2000),status smallint,last_notice_time timestamp,create_by integer,create_time timestamp,update_by integer,update_time timestamp)')
    await pool.query('CREATE TABLE t_telegram_bot_ad_keyboard(rid serial PRIMARY KEY,bot_rid integer,ad_rid integer,keyboard_rid integer,create_by integer,create_time timestamp,update_by integer,update_time timestamp)')
    await pool.query('CREATE TABLE t_telegram_clone_proxy_config(rid serial PRIMARY KEY,master_bot_rid integer NOT NULL,is_enable integer NOT NULL DEFAULT 1,update_time timestamp,merchant_limit integer NOT NULL DEFAULT 0,default_revenue_ratio numeric(7,2) NOT NULL DEFAULT 0)')
    await pool.query("CREATE TABLE t_platform_plugin_lifecycle(plugin_id text PRIMARY KEY,state text NOT NULL,enabled_bot_ids integer[] NOT NULL DEFAULT '{}',disabled_at timestamptz,enabled_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now())")
    await pool.query('CREATE TABLE t_platform_plugin_execution(plugin_id text NOT NULL,task_name text NOT NULL,owner text NOT NULL,lease_until timestamptz NOT NULL,PRIMARY KEY(plugin_id,task_name))')
    await pool.query('CREATE TABLE t_telegram_clone_proxy_merchant(rid bigserial PRIMARY KEY,master_bot_rid integer NOT NULL,bot_rid integer NOT NULL,owner_tg_uid bigint NOT NULL,owner_tg_username varchar(200) NOT NULL,owner_tg_name varchar(200),bot_token_hash varchar(64) NOT NULL,revenue_ratio numeric(7,2) NOT NULL,status smallint NOT NULL,total_revenue_usdt numeric(20,6) NOT NULL DEFAULT 0,total_revenue_trx numeric(20,6) NOT NULL DEFAULT 0,webhook_status smallint NOT NULL DEFAULT 0,webhook_error varchar(500),create_time timestamp,update_time timestamp)')
    await pool.query("CREATE TABLE t_telegram_clone_proxy_order(rid bigserial PRIMARY KEY,merchant_rid bigint,master_bot_rid integer NOT NULL,bot_rid integer,order_type varchar(30) NOT NULL,pay_user_tg_uid bigint NOT NULL,status smallint NOT NULL DEFAULT 0,update_time timestamp,complete_time timestamp,comments varchar(1000))")
    await pool.query('CREATE TABLE t_fms_wallet_trade_list(rid bigserial PRIMARY KEY,process_status smallint NOT NULL DEFAULT 1)')
    await pool.query("INSERT INTO t_telegram_bot(rid,bot_token,bot_username,last_update_id) VALUES(1,'master-token-fixture','master_bot',40)")
    await pool.query("SELECT setval(pg_get_serial_sequence('t_telegram_bot','rid'),1,true)")
    await pool.query("INSERT INTO t_telegram_clone_proxy_config(master_bot_rid,merchant_limit,default_revenue_ratio) VALUES(1,2,15)")
    await pool.query("INSERT INTO t_telegram_clone_proxy_order(rid,master_bot_rid,pay_user_tg_uid,order_type,status) VALUES(21,1,9001,'opening',1)")
    await pool.query(await (await import('node:fs/promises')).readFile(new URL('../../migrations/002-platform-jobs.sql', import.meta.url), 'utf8'))
    await pool.query(await (await import('node:fs/promises')).readFile(new URL('../../migrations/011-platform-recharge-orders.sql', import.meta.url), 'utf8'))
    await pool.query("INSERT INTO t_platform_cloneproxy_token_waiter(master_bot_rid,pay_user_tg_uid,clone_proxy_order_rid,expires_at) VALUES(1,9001,21,now()+interval '15 minutes')")

    const update = { update_id: 41, message: { text: token, chat: { id: 9001, type: 'private' }, from: { id: 9001, username: 'alice', first_name: 'Alice' } } }
    const deliveries: Array<{ url: string; body: Record<string, unknown> }> = []
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/getMe')) return Response.json({ ok: true, result: { username: 'child_bot', first_name: 'Child Bot' } })
      deliveries.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
      return Response.json({ ok: true, result: { message_id: 1 } })
    }
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    await lockCloneProxyLifecycle(blocker)
    const provisioning = handleCloneProxyTokenUpdate({ pool, masterBotRid: 1, update, enabled: true, appEnvironment: 'development', fetcher })
    await new Promise(resolve => setTimeout(resolve, 120))
    const disabling = changeCloneProxyLifecycle(pool, 'disable')
    await new Promise(resolve => setTimeout(resolve, 120))
    await blocker.query('COMMIT')
    blocker.release()
    const first = await provisioning
    const draining = await disabling
    assert.deepEqual(first, { handled: true, provisioned: true })
    assert.equal(draining, 'draining')
    // Existing lifecycle semantics block on an active execution lease, not merchant existence.
    await pool.query("INSERT INTO t_platform_plugin_execution(plugin_id,task_name,owner,lease_until) VALUES('cloneproxy','synctelegramcloneproxyrevenue','fixture',now()+interval '1 minute')")
    await assert.rejects(changeCloneProxyLifecycle(pool, 'uninstall'), /plugin_has_outstanding_business/)
    await pool.query("DELETE FROM t_platform_plugin_execution WHERE plugin_id='cloneproxy' AND task_name='synctelegramcloneproxyrevenue'")

    const result = await pool.query("SELECT b.rid,b.bot_username,o.status AS order_status,m.status AS merchant_status,m.webhook_status,w.consumed_at IS NOT NULL AS consumed FROM t_telegram_bot b JOIN t_telegram_clone_proxy_order o ON o.bot_rid=b.rid JOIN t_telegram_clone_proxy_merchant m ON m.bot_rid=b.rid JOIN t_platform_cloneproxy_token_waiter w ON w.master_bot_rid=o.master_bot_rid AND w.pay_user_tg_uid=o.pay_user_tg_uid WHERE b.rid<>1")
    assert.deepEqual(result.rows, [{ rid: 2, bot_username: 'child_bot', order_status: 2, merchant_status: 1, webhook_status: 1, consumed: true }])
    assert.equal(Number((await pool.query('SELECT last_update_id FROM t_telegram_bot WHERE rid=1')).rows[0].last_update_id), 41)
    const notifications = await pool.query("SELECT idempotency_key,message_text FROM t_platform_job_outbox WHERE task_name='handlerechargeorder'")
    assert.equal(notifications.rowCount, 1)
    assert.match(notifications.rows[0].message_text, /@child_bot/)
    assert.equal(notifications.rows[0].message_text.includes(token), false)
    assert.equal(notifications.rows[0].idempotency_key, 'cloneproxy-token:1:41:reply')

    process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
    const sent = await syncRechargeOrders({ pool, enabled: true, fetcher, logger: { error() {} } })
    assert.equal(sent.notificationsSent, 1)
    assert.equal(deliveries.length, 1)
    assert.match(deliveries[0].url, /\/sendMessage$/)
    assert.equal(deliveries[0].body.chat_id, '9001')
    assert.match(String(deliveries[0].body.text), /@child_bot/)
    assert.equal(String(deliveries[0].body.text).includes(token), false)
    assert.equal((await pool.query("SELECT status FROM t_platform_job_outbox WHERE idempotency_key='cloneproxy-token:1:41:reply'")).rows[0].status, 'sent')
  } finally {
    if (previousTelegramFlag === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previousTelegramFlag
    await pool?.end()
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => undefined)
    await admin.end()
  }
})
