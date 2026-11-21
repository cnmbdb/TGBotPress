import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'
import { syncTelegramSupportUpdates } from './telegram-support-updates.server'

const connectionString = process.env.PLATFORM_TEST_DATABASE_URL
const token = '12345:Abcdefghijklmnopqrstuvwxyz_123'
const envNames = ['PLATFORM_TELEGRAM_ACTIONS', 'PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY'] as const

test('premium wallet callback charges once and persists inbox, balance, and order states', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol))
  assert.ok(['postgres', 'localhost', '127.0.0.1'].includes(url.hostname))
  assert.match(url.pathname.slice(1), /^telegram_premium_wallet_pay_test_/)
  assert.match(decodeURIComponent(url.username), /^telegram_premium_wallet_pay_test_/)
  const pool = new Pool({ connectionString })
  const previous = Object.fromEntries(envNames.map(name => [name, process.env[name]]))
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY = 'true'
  try {
    await pool.query(`
      CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token text NOT NULL);
      CREATE TABLE t_telegram_bot_user(rid integer PRIMARY KEY,bot_rid integer NOT NULL,tg_uid text NOT NULL,cash_usdt numeric(18,6) NOT NULL);
      CREATE TABLE t_premium_platform_order(rid integer PRIMARY KEY,bot_rid integer NOT NULL,buy_tg_uid text NOT NULL,need_pay_usdt numeric(18,6) NOT NULL,status smallint NOT NULL,premium_tg_username text,premium_package_month integer,update_time timestamptz);
      CREATE TABLE t_platform_telegram_update(rid integer PRIMARY KEY,bot_rid integer NOT NULL,update_body jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),lease_owner text,lease_until timestamptz,processed_at timestamptz,last_error_code text);
    `)
    await pool.query('INSERT INTO t_telegram_bot VALUES(7,$1)', [token])
    await pool.query("INSERT INTO t_telegram_bot_user VALUES(155,7,'55',10.000000),(156,7,'56',1.000000)")
    await pool.query("INSERT INTO t_premium_platform_order VALUES(72,7,'55',5.500000,0,'member_user',12,NULL),(73,7,'56',2.000000,0,'short_user',3,NULL)")
    const makeUpdate = (rid: number, orderRid: number, chatId: string) => ({
      rid, bot_rid: 7,
      update_body: {
        callback_query: {
          id: `pay-${rid}`, data: `tgpremiumwalletpay_${orderRid}`, from: { id: Number(chatId) },
          message: { message_id: 500 + rid, chat: { id: Number(chatId), type: 'private' }, reply_markup: { inline_keyboard: [[{ text: '余额支付', callback_data: `tgpremiumwalletpay_${orderRid}` }]] } },
        },
      },
    })
    await pool.query('INSERT INTO t_platform_telegram_update(rid,bot_rid,update_body) VALUES(1,7,$1),(2,7,$2),(3,7,$3)', [
      JSON.stringify(makeUpdate(1, 72, '55').update_body),
      JSON.stringify(makeUpdate(2, 73, '56').update_body),
      JSON.stringify(makeUpdate(3, 72, '55').update_body),
    ])
    const testPool = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('WITH candidates AS')) {
          return pool.query(`WITH candidates AS (
            SELECT rid FROM t_platform_telegram_update WHERE status='pending' ORDER BY rid LIMIT $1 FOR UPDATE SKIP LOCKED
          ) UPDATE t_platform_telegram_update u SET status='processing',attempts=u.attempts+1,lease_owner=$2,lease_until=now()+interval '30 seconds'
          FROM candidates c WHERE u.rid=c.rid RETURNING u.rid,u.bot_rid,u.update_body`, values)
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
    const users = await pool.query('SELECT rid,cash_usdt::text FROM t_telegram_bot_user ORDER BY rid')
    assert.deepEqual(users.rows, [{ rid: 155, cash_usdt: '4.500000' }, { rid: 156, cash_usdt: '1.000000' }])
    const orders = await pool.query('SELECT rid,status FROM t_premium_platform_order ORDER BY rid')
    assert.deepEqual(orders.rows, [{ rid: 72, status: 1 }, { rid: 73, status: 0 }])
    const inbox = await pool.query('SELECT rid,status,attempts FROM t_platform_telegram_update ORDER BY rid')
    assert.deepEqual(inbox.rows, [1, 2, 3].map(rid => ({ rid, status: 'processed', attempts: 1 })))
    assert.deepEqual(requests.map(request => request.method), ['answerCallbackQuery', 'editMessageText', 'answerCallbackQuery', 'sendMessage', 'answerCallbackQuery', 'sendMessage'])
    assert.equal(requests[1].payload.chat_id, '55')
    assert.match(String(requests[1].payload.text), /会员订单支付成功/)
    assert.equal(requests[3].payload.text, '用户USDT余额不足')
    assert.equal(requests[5].payload.text, '订单不存在或者不是待支付状态')
  } finally {
    for (const name of envNames) {
      const value = previous[name]
      if (value == null) delete process.env[name]; else process.env[name] = value
    }
    await pool.end()
  }
})
