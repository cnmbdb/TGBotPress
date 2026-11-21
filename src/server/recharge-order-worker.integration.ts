import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncRechargeOrders } from './recharge-order-worker.server'

const connectionString = process.env.PLATFORM_INTEGRATION_DATABASE_URL
test('recharge settlement atomically credits matching orders, records clone waiters and ignores retries', { skip: !connectionString }, async () => {
  const schema = 'recharge_test_' + randomUUID().replaceAll('-', '')
  const admin = new Pool({ connectionString })
  let pool: Pool | undefined
  const oldActions = process.env.PLATFORM_RECHARGE_ORDER_ACTIONS
  const oldTelegram = process.env.PLATFORM_TELEGRAM_ACTIONS
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    pool = new Pool({ connectionString, options: '-c search_path=' + schema, max: 5 })
    await pool.query('CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text NOT NULL)')
    await pool.query('CREATE TABLE t_telegram_bot_user(rid serial PRIMARY KEY,bot_rid integer NOT NULL,tg_uid bigint NOT NULL,cash_trx numeric(20,6) NOT NULL DEFAULT 0,cash_usdt numeric(20,6) NOT NULL DEFAULT 0)')
    await pool.query('CREATE TABLE t_fms_recharge_order(rid serial PRIMARY KEY,bot_rid integer NOT NULL,recharge_tg_uid varchar(100) NOT NULL,recharge_coin_name varchar(50) NOT NULL,recharge_pay_price numeric(12,4) NOT NULL,need_pay_price numeric(12,4) NOT NULL,status smallint NOT NULL DEFAULT 0,comments varchar(255),complete_time timestamp,update_time timestamp,expire_time timestamp NOT NULL DEFAULT now(),cancel_time timestamp,tx_hash varchar(100))')
    await pool.query('CREATE TABLE t_fms_wallet_trade_list(rid serial PRIMARY KEY,transferfrom_address varchar(200) NOT NULL,amount varchar(100) NOT NULL,coin_name varchar(20) NOT NULL,tx_hash varchar(100) NOT NULL,process_status smallint NOT NULL DEFAULT 1,process_comments varchar(255),process_time timestamp,recharge_order_rid integer)')
    await pool.query("CREATE TABLE t_telegram_clone_proxy_order(rid bigint PRIMARY KEY,master_bot_rid integer NOT NULL,pay_user_tg_uid bigint NOT NULL,order_type varchar(30) NOT NULL,status smallint NOT NULL DEFAULT 0,payment_method varchar(20),need_pay_amount numeric(20,6),external_order_rid bigint,paid_time timestamp,update_time timestamp,comments varchar(1000))")
    await pool.query("INSERT INTO t_telegram_bot VALUES(1,'dummy-token-for-isolated-test')")
    await pool.query("INSERT INTO t_telegram_bot_user(bot_rid,tg_uid,cash_trx,cash_usdt) VALUES(1,1001,10,20)")
    await pool.query("INSERT INTO t_fms_recharge_order(bot_rid,recharge_tg_uid,recharge_coin_name,recharge_pay_price,need_pay_price,status,comments) VALUES(1,'1001','trx',3,3,1,NULL),(1,'1001','usdt',5,5,1,NULL)")
    await pool.query("INSERT INTO t_fms_recharge_order(bot_rid,recharge_tg_uid,recharge_coin_name,recharge_pay_price,need_pay_price,status,comments) VALUES(1,'1001','trx',2.5,2.5,0,NULL),(1,'1999','usdt',4,4,0,NULL),(1,'1777','trx',9,9,0,'__clone_proxy__:20')")
    await pool.query("INSERT INTO t_telegram_clone_proxy_order(rid,master_bot_rid,pay_user_tg_uid,order_type,status) VALUES(20,1,1777,'opening',0)")
    await pool.query("INSERT INTO t_fms_wallet_trade_list(transferfrom_address,amount,coin_name,tx_hash) VALUES('Tfrom1','2.5000','trx','tx-paid'),('Tfrom2','77.0','usdt','tx-unmatched'),('Tfrom3','4.0','usdt','tx-no-user'),('Tfrom4','9.0','trx','tx-clone')")
    await pool.query(await readFile(new URL('../../migrations/002-platform-jobs.sql', import.meta.url), 'utf8'))
    const rechargeMigration = await readFile(new URL('../../migrations/011-platform-recharge-orders.sql', import.meta.url), 'utf8')
    await pool.query(rechargeMigration)
    await pool.query(rechargeMigration)

    process.env.PLATFORM_RECHARGE_ORDER_ACTIONS = 'true'
    process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
    const first = await syncRechargeOrders({ pool })
    assert.deepEqual(first, { skipped: false, scanned: 4, paid: 2, unmatched: 1, userMissing: 1, failed: 0, notificationsSent: 0 })
    const balances = (await pool.query('SELECT cash_trx::text,cash_usdt::text,total_recharge_trx::text,total_recharge_usdt::text FROM t_telegram_bot_user WHERE bot_rid=1 AND tg_uid=1001')).rows[0]
    assert.deepEqual(balances, { cash_trx: '12.500000', cash_usdt: '20.000000', total_recharge_trx: '5.500000', total_recharge_usdt: '5.000000' })
    const trades = await pool.query('SELECT rid,process_status,recharge_order_rid FROM t_fms_wallet_trade_list ORDER BY rid')
    assert.deepEqual(trades.rows.map(row => [Number(row.process_status), row.recharge_order_rid === null ? null : Number(row.recharge_order_rid)]), [[9, 3], [7, null], [3, null], [9, 5]])
    const waiter = await pool.query('SELECT clone_proxy_order_rid,consumed_at IS NULL AS waiting FROM t_platform_cloneproxy_token_waiter WHERE master_bot_rid=1 AND pay_user_tg_uid=1777')
    assert.deepEqual(waiter.rows[0], { clone_proxy_order_rid: '20', waiting: true })
    assert.equal(Number((await pool.query("SELECT count(*)::int AS n FROM t_platform_job_outbox WHERE task_name='handlerechargeorder'")).rows[0].n), 2)

    const retry = await syncRechargeOrders({ pool })
    assert.equal(retry.scanned, 0)
    const afterRetry = (await pool.query('SELECT cash_trx::text,total_recharge_trx::text FROM t_telegram_bot_user WHERE bot_rid=1 AND tg_uid=1001')).rows[0]
    assert.deepEqual(afterRetry, { cash_trx: '12.500000', total_recharge_trx: '5.500000' })
  } finally {
    if (oldActions === undefined) delete process.env.PLATFORM_RECHARGE_ORDER_ACTIONS
    else process.env.PLATFORM_RECHARGE_ORDER_ACTIONS = oldActions
    if (oldTelegram === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = oldTelegram
    await pool?.end()
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE').catch(() => undefined)
    await admin.end()
  }
})
