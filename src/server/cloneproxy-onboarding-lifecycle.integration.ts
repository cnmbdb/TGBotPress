import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { changeCloneProxyLifecycle, lockCloneProxyLifecycle } from '../plugins/cloneproxy/lifecycle.server'
import { handleTelegramCloneProxyUpdate } from '../server/telegram-cloneproxy-onboarding.server'

const url = process.env.PLATFORM_INTEGRATION_DATABASE_URL
test('real onboarding racing with disable completes atomically and blocks uninstall until token is submitted', { skip: !url }, async () => {
  const schema = 'cloneproxy_onboarding_lifecycle_' + randomUUID().replaceAll('-', '')
  const admin = new Pool({ connectionString: url })
  let pool: Pool | undefined
  const previous = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    pool = new Pool({ connectionString: url, options: '-c search_path=' + schema, max: 5 })
    await pool.query("CREATE TABLE t_platform_plugin_lifecycle(plugin_id text PRIMARY KEY,state text NOT NULL,enabled_bot_ids integer[] NOT NULL DEFAULT '{}',disabled_at timestamptz,enabled_at timestamptz,updated_at timestamptz DEFAULT now())")
    await pool.query('CREATE TABLE t_platform_plugin_execution(plugin_id text NOT NULL,task_name text NOT NULL,owner text NOT NULL,lease_until timestamptz NOT NULL,PRIMARY KEY(plugin_id,task_name))')
    await pool.query('CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text,bot_username text,recharge_wallet_addr text)')
    await pool.query('CREATE TABLE t_telegram_clone_proxy_config(master_bot_rid integer PRIMARY KEY,is_enable integer,update_time timestamptz,charge_enable integer,open_price numeric,default_revenue_ratio numeric,merchant_limit integer)')
    await pool.query('CREATE TABLE t_telegram_clone_proxy_merchant(rid serial PRIMARY KEY,master_bot_rid integer,owner_tg_uid bigint,status integer)')
    await pool.query('CREATE TABLE t_telegram_clone_proxy_order(rid serial PRIMARY KEY,master_bot_rid integer,pay_user_tg_uid bigint,pay_user_tg_username text,order_type text,source_type text,amount numeric,need_pay_amount numeric,coin_name text,payment_method text,status integer,revenue_ratio numeric,comments text,create_time timestamptz,update_time timestamptz,paid_time timestamptz,expire_time timestamptz,external_order_rid bigint)')
    await pool.query('CREATE TABLE t_platform_cloneproxy_token_waiter(consumed_at timestamptz,expires_at timestamptz)')
    await pool.query("INSERT INTO t_telegram_bot VALUES(1,'12345:abcdefghijklmnopqrstuvwxyzABCDE_123456','master_bot',NULL)")
    await pool.query('INSERT INTO t_telegram_clone_proxy_config VALUES(1,1,now(),0,0,20,5)')
    const blocker = await pool.connect()
    await blocker.query('BEGIN')
    await lockCloneProxyLifecycle(blocker)
    const opening = handleTelegramCloneProxyUpdate({ pool, botRid: 1, fetcher: async () => Response.json({ ok: true }), update: { callback_query: { id: 'open-1', data: 'cloneproxy:add', from: { id: 7788, username: 'opener' }, message: { chat: { id: 7788, type: 'private' } } } } })
    await new Promise(resolve => setTimeout(resolve, 120))
    const disabling = changeCloneProxyLifecycle(pool, 'disable')
    await new Promise(resolve => setTimeout(resolve, 120))
    await blocker.query('COMMIT'); blocker.release()
    assert.equal(await opening, true)
    assert.equal(await disabling, 'draining')
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM t_telegram_clone_proxy_order WHERE order_type='opening' AND status=1")).rows[0].n, 1)
    await assert.rejects(changeCloneProxyLifecycle(pool, 'uninstall'), /plugin_has_outstanding_business/)
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previous
    await pool?.end()
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => undefined)
    await admin.end()
  }
})
