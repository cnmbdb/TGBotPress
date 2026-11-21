import assert from 'node:assert/strict'
import test from 'node:test'
import type { Pool, PoolClient } from 'pg'
import { handleCloneProxyTokenUpdate } from './cloneproxy-token-intake.server'

function fixture(pendingOrder = true) {
  const calls: Array<{ sql: string; args: unknown[] }> = []
  const outbox: Array<{ key: string; text: string }> = []
  let lastUpdateId = 40
  let orderStatus = 1
  const execute = async (sql: string, args: unknown[] = []) => {
    calls.push({ sql, args })
    if (sql.startsWith('SELECT o.rid FROM t_telegram_clone_proxy_order')) return { rows: pendingOrder && orderStatus === 1 ? [{ rid: 21 }] : [], rowCount: pendingOrder && orderStatus === 1 ? 1 : 0 }
    if (sql.startsWith('SELECT last_update_id')) return { rows: [{ last_update_id: lastUpdateId }], rowCount: 1 }
    if (sql.startsWith('SELECT rid,status,master_bot_rid')) return { rows: [{ rid: 21, status: orderStatus, master_bot_rid: 7, pay_user_tg_uid: '9001' }], rowCount: 1 }
    if (sql.startsWith('SELECT clone_proxy_order_rid')) return { rows: [{ clone_proxy_order_rid: 21 }], rowCount: 1 }
    if (sql.startsWith('SELECT rid,merchant_limit')) return { rows: [{ rid: 2, merchant_limit: 10, default_revenue_ratio: '15.00' }], rowCount: 1 }
    if (sql.startsWith('SELECT count(*)::int AS count')) return { rows: [{ count: 0 }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_bot(')) return { rows: [{ rid: 12 }], rowCount: 1 }
    if (sql.startsWith('SELECT rid FROM t_telegram_bot WHERE rid=ANY')) return { rows: [{ rid: 7 }, { rid: 12 }], rowCount: 2 }
    if (sql.startsWith('SELECT EXISTS(')) return { rows: [{ found: false }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO t_telegram_clone_proxy_merchant')) return { rows: [{ rid: 5 }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_telegram_clone_proxy_order')) { orderStatus = 2; return { rows: [], rowCount: 1 } }
    if (sql.startsWith('UPDATE t_telegram_bot SET last_update_id')) { lastUpdateId = Number(args[1]); return { rows: [], rowCount: 1 } }
    if (sql.startsWith('SELECT rid FROM t_telegram_bot_user')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('INSERT INTO t_platform_job_outbox')) { outbox.push({ key: String(args[0]), text: String(args[4]) }); return { rows: [], rowCount: 1 } }
    if (sql.startsWith('SELECT 1 FROM')) return { rows: [], rowCount: 0 }
    if (sql.startsWith('SELECT * FROM t_telegram_bot_')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 1 }
  }
  const pool = {
    query: execute,
    connect: async () => ({ query: execute, release() {} }),
  }
  return { pool: pool as unknown as Pick<Pool, 'query' | 'connect'>, calls, outbox, get lastUpdateId() { return lastUpdateId } }
}

const token = '123456:abcdefghijklmnopqrstuvwxyzABCDE_123456'
const baseUpdate = { update_id: 41, message: { text: token, chat: { id: 9001, type: 'private' }, from: { id: 9001, username: 'alice', first_name: 'Alice' } } }

test('clone proxy token intake is inert while Telegram operations are disabled', async () => {
  const state = fixture()
  const result = await handleCloneProxyTokenUpdate({ pool: state.pool, masterBotRid: 7, update: baseUpdate, enabled: false, fetcher: async () => { throw new Error('network must remain disabled') } })
  assert.deepEqual(result, { handled: false, reason: 'telegram_actions_disabled' })
  assert.deepEqual(state.calls, [])
})

test('clone proxy token intake leaves unrelated messages on the legacy dispatcher', async () => {
  const state = fixture(false)
  const result = await handleCloneProxyTokenUpdate({ pool: state.pool, masterBotRid: 7, update: baseUpdate, enabled: true, fetcher: async () => { throw new Error('no candidate order means no Telegram request') } })
  assert.deepEqual(result, { handled: false, reason: 'no_paid_opening_order' })
  assert.equal(state.calls.length, 1)
})

test('paid token intake provisions idempotently, acknowledges the update and queues a secret-free reply', async () => {
  const state = fixture()
  const telegramCalls: string[] = []
  const result = await handleCloneProxyTokenUpdate({
    pool: state.pool,
    masterBotRid: 7,
    update: baseUpdate,
    enabled: true,
    appEnvironment: 'development',
    fetcher: async input => {
      telegramCalls.push(String(input).split('/').at(-1) ?? '')
      return Response.json({ ok: true, result: { username: 'child_bot', first_name: 'Child Bot' } })
    },
  })
  assert.deepEqual(result, { handled: true, provisioned: true })
  assert.deepEqual(telegramCalls, ['getMe'])
  assert.equal(state.lastUpdateId, 41)
  assert.ok(state.calls.some(({ sql }) => sql.startsWith('INSERT INTO t_telegram_clone_proxy_merchant')))
  assert.ok(state.calls.some(({ sql }) => sql.includes('UPDATE t_platform_cloneproxy_token_waiter SET consumed_at')))
  assert.equal(state.outbox.length, 1)
  assert.match(state.outbox[0].text, /@child_bot/)
  assert.equal(state.outbox[0].text.includes(token), false)
  assert.equal(state.calls.some(({ sql }) => sql.includes(token)), false)
})

test('new clone bot webhook defaults to the unified platform origin when WEB_URL is unset', async () => {
  const state = fixture()
  const envKeys = ['WEB_URL', 'PLATFORM_ORIGIN', 'APP_URL', 'TELEGRAM_WEBHOOK_SECRET_KEY'] as const
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  process.env.WEB_URL = ''
  process.env.PLATFORM_ORIGIN = 'https://backend.example/base'
  process.env.APP_URL = ''
  process.env.TELEGRAM_WEBHOOK_SECRET_KEY = 's'.repeat(32)
  const requests: Array<{ method: string; payload?: Record<string, unknown> }> = []
  try {
    const result = await handleCloneProxyTokenUpdate({
      pool: state.pool, masterBotRid: 7, update: baseUpdate, enabled: true, appEnvironment: 'production', appKey: 'a'.repeat(64),
      fetcher: async (input, init) => {
        const method = String(input).split('/').at(-1) ?? ''
        requests.push({ method, payload: init?.body ? JSON.parse(String(init.body)) : undefined })
        if (method === 'getMe') return Response.json({ ok: true, result: { username: 'child_bot', first_name: 'Child Bot' } })
        if (method === 'setWebhook') return Response.json({ ok: true, result: true })
        throw new Error('unexpected Telegram request')
      },
    })
    assert.deepEqual(result, { handled: true, provisioned: true })
    const registered = requests.find(request => request.method === 'setWebhook')
    assert.equal(registered?.payload?.url, 'https://backend.example/base/api/telegram/getdata?rid=12')
    assert.deepEqual(registered?.payload?.allowed_updates, ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request'])
    assert.ok(state.calls.some(({ sql, args }) => sql.startsWith('UPDATE t_telegram_clone_proxy_merchant SET webhook_status=$2') && args[1] === 1))
  } finally {
    for (const key of envKeys) {
      const value = previous[key]
      if (value == null) delete process.env[key]; else process.env[key] = value
    }
  }
})
