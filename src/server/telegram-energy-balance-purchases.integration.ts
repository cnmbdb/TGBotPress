import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'
import { syncTelegramSupportUpdates } from './telegram-support-updates.server'

const connectionString = process.env.PLATFORM_TEST_DATABASE_URL
const token = '12345:Abcdefghijklmnopqrstuvwxyz_123'
const envNames = ['PLATFORM_TELEGRAM_ACTIONS', 'PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY', 'PLATFORM_ENERGY_ORDER_ACTIONS'] as const

test('isolated PostgreSQL charges energy balance once per Telegram callback and records insufficient balance', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol))
  assert.ok(['postgres', 'localhost', '127.0.0.1'].includes(url.hostname))
  assert.match(url.pathname.slice(1), /^telegram_energy_balance_purchase_test_/)
  assert.match(decodeURIComponent(url.username), /^telegram_energy_balance_purchase_test_/)
  const pool = new Pool({ connectionString })
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  process.env.PLATFORM_ENERGY_ORDER_ACTIONS = 'true'
  try {
    const existing = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")
    assert.equal(existing.rows[0].count, 0, 'use a new disposable integration database')
    await pool.query(
      'CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text NOT NULL,bot_admin_username text);' +
      'CREATE TABLE t_telegram_bot_user(rid integer PRIMARY KEY,bot_rid integer NOT NULL,tg_uid text NOT NULL,bind_trc_wallet_addr text,cash_trx numeric(18,6) NOT NULL,cash_usdt numeric(18,6) NOT NULL);' +
      'CREATE TABLE t_energy_platform_bot(rid integer PRIMARY KEY,bot_rid integer NOT NULL,status smallint NOT NULL);' +
      'CREATE TABLE t_energy_platform_package(rid integer PRIMARY KEY,bot_rid integer NOT NULL,package_name text NOT NULL,energy_amount integer NOT NULL,energy_day smallint NOT NULL,trx_price numeric(14,2) NOT NULL,usdt_price numeric(14,2) NOT NULL,status smallint NOT NULL);' +
      'CREATE TABLE t_energy_quick_order(rid serial PRIMARY KEY,bot_rid integer NOT NULL,tg_uid text NOT NULL,wallet_addr text NOT NULL,energy_amount integer NOT NULL,energy_day smallint NOT NULL,package_name text NOT NULL,package_rid integer NOT NULL,status smallint NOT NULL,pay_price numeric(20,6) NOT NULL,pay_type text NOT NULL,pay_time timestamptz NOT NULL,create_time timestamptz NOT NULL,update_time timestamptz NOT NULL);' +
      "CREATE TABLE t_platform_telegram_update(rid integer PRIMARY KEY,bot_rid integer NOT NULL,update_body jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_owner text,lease_until timestamptz,processed_at timestamptz,last_error_code text);" +
      "CREATE TABLE t_platform_telegram_energy_balance_purchase(update_rid bigint PRIMARY KEY,callback_query_id varchar(200) UNIQUE,bot_rid integer NOT NULL,chat_id bigint NOT NULL,package_rid integer NOT NULL,payment_type varchar(8) NOT NULL CHECK(payment_type IN ('trx','usd')),pay_price numeric(20,6),outcome varchar(32) NOT NULL CHECK(outcome IN ('purchased','user_missing','wallet_missing','package_unavailable','unsupported_price','insufficient_balance')),quick_order_rid integer,response_text text NOT NULL,response_markup jsonb NOT NULL,created_at timestamp NOT NULL DEFAULT now(),CHECK((outcome='purchased' AND quick_order_rid IS NOT NULL) OR (outcome<>'purchased' AND quick_order_rid IS NULL)));"
    )
    await pool.query('INSERT INTO t_telegram_bot VALUES(7,$1,$2)', [token, '@support_bot'])
    await pool.query("INSERT INTO t_telegram_bot_user VALUES(155,7,'55','TBoundWallet55',10.000000,3.500000),(156,7,'56','TBoundWallet56',4.000000,0.500000)")
    await pool.query('INSERT INTO t_energy_platform_bot VALUES(17,7,0)')
    await pool.query("INSERT INTO t_energy_platform_package VALUES(123,7,'Quick 65000',65000,1,2.130000,1.250000,0)")
    const makeUpdate = (rid: number, callbackId: string, data: string, userId: number) => ({
      rid, bot_rid: 7,
      update_body: { callback_query: {
        id: callbackId, data, from: { id: userId, username: 'fixture_user' },
        message: { message_id: 500 + rid, chat: { id: userId, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'Confirm purchase', callback_data: data }]] } },
      } },
    })
    const updates = [
      makeUpdate(1, 'energy-purchase-once', 'balancebuyconftrx123', 55),
      makeUpdate(2, 'energy-purchase-once', 'balancebuyconftrx123', 55),
      makeUpdate(3, 'energy-insufficient', 'balancebuyconfusd123', 56),
    ]
    await pool.query('INSERT INTO t_platform_telegram_update(rid,bot_rid,update_body) VALUES(1,7,$1),(2,7,$2),(3,7,$3)', updates.map(row => JSON.stringify(row.update_body)))
    const testPool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('WITH candidates AS')) {
          return pool.query(
            "WITH candidates AS (SELECT rid FROM t_platform_telegram_update WHERE status IN ('pending','failed') AND next_attempt_at<=now() ORDER BY rid LIMIT $1 FOR UPDATE SKIP LOCKED) " +
            "UPDATE t_platform_telegram_update u SET status='processing',attempts=u.attempts+1,lease_owner=$2,lease_until=now()+interval '30 seconds' FROM candidates c WHERE u.rid=c.rid RETURNING u.rid,u.bot_rid,u.update_body",
            values,
          )
        }
        return pool.query(sql, values)
      },
      connect: () => pool.connect(),
    } as never
    const requests: Array<{ method: string; payload: Record<string, unknown> }> = []
    const result = await syncTelegramSupportUpdates({ pool: testPool, fetcher: async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 900 } })
    } })
    assert.deepEqual(result, { skipped: false, processed: 3, failed: 0 })
    const users = await pool.query('SELECT rid,cash_trx::text,cash_usdt::text FROM t_telegram_bot_user ORDER BY rid')
    assert.deepEqual(users.rows, [
      { rid: 155, cash_trx: '7.870000', cash_usdt: '3.500000' },
      { rid: 156, cash_trx: '4.000000', cash_usdt: '0.500000' },
    ])
    const orders = await pool.query('SELECT bot_rid,tg_uid,wallet_addr,energy_amount,energy_day,package_rid,status,pay_price::text,pay_type FROM t_energy_quick_order ORDER BY rid')
    assert.deepEqual(orders.rows, [{
      bot_rid: 7, tg_uid: '55', wallet_addr: 'TBoundWallet55', energy_amount: 65000, energy_day: 1,
      package_rid: 123, status: 1, pay_price: '2.130000', pay_type: 'trx',
    }])
    const receipts = await pool.query('SELECT update_rid,callback_query_id,outcome,quick_order_rid FROM t_platform_telegram_energy_balance_purchase ORDER BY update_rid')
    assert.deepEqual(receipts.rows, [
      { update_rid: '1', callback_query_id: 'energy-purchase-once', outcome: 'purchased', quick_order_rid: 1 },
      { update_rid: '3', callback_query_id: 'energy-insufficient', outcome: 'insufficient_balance', quick_order_rid: null },
    ])
    const inbox = await pool.query('SELECT rid,status,attempts FROM t_platform_telegram_update ORDER BY rid')
    assert.deepEqual(inbox.rows, [1, 2, 3].map(rid => ({ rid, status: 'processed', attempts: 1 })))
    assert.deepEqual(requests.map(request => request.method), [
      'answerCallbackQuery', 'sendMessage',
      'answerCallbackQuery', 'sendMessage',
      'answerCallbackQuery', 'sendMessage',
    ])
    assert.match(String(requests[1].payload.text), /购买成功/u)
    assert.match(String(requests[5].payload.text), /余额不足/u)
  } finally {
    for (const name of envNames) {
      const value = previous[name]
      if (value == null) delete process.env[name]; else process.env[name] = value
    }
    await pool.end()
  }
})
