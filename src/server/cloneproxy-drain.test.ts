import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handleTelegramCloneProxyUpdate } from './telegram-cloneproxy-onboarding.server'

test('disabled onboarding still permits existing order payment and cancellation, but not new orders', async () => {
  const previous = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  const calls: string[] = []
  const client = { query: async (sql: string) => {
    calls.push(sql)
    if (sql.startsWith('SELECT status,amount')) return { rows: [{ status: 0, amount: '5', external_order_rid: null, expired: false }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_telegram_bot_user')) return { rows: [{ rid: 1 }], rowCount: 1 }
    if (sql.startsWith('SELECT external_order_rid')) return { rows: [{ external_order_rid: null }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }, release() {} }
  const pool = { query: async () => ({ rows: [{ is_enable: 0, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', recharge_wallet_addr: null }] }), connect: async () => client }
  const fetcher = async () => Response.json({ ok: true })
  const update = (data: string) => ({ callback_query: { id: 'cb', data, from: { id: 77, username: 'alice' }, message: { chat: { id: 77, type: 'private' } } } })
  try {
    await handleTelegramCloneProxyUpdate({ pool: pool as never, fetcher, botRid: 8, update: update('cloneproxy:balance:42') })
    await handleTelegramCloneProxyUpdate({ pool: pool as never, fetcher, botRid: 8, update: update('cloneproxy:cancel:43') })
    await handleTelegramCloneProxyUpdate({ pool: pool as never, fetcher, botRid: 8, update: update('cloneproxy:add') })
    assert.equal(calls.filter(sql => sql.startsWith('UPDATE t_telegram_bot_user')).length, 1)
    assert.equal(calls.filter(sql => sql.startsWith('UPDATE t_telegram_clone_proxy_order SET status=3')).length, 1)
    assert.equal(calls.some(sql => sql.startsWith('INSERT INTO t_telegram_clone_proxy_order')), false)
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previous
  }
})
