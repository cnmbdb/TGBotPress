import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendCloneProxyButton, CLONE_PROXY_BUTTON, handleTelegramCloneProxyUpdate, telegramCloneProxyClaimPredicate } from './telegram-cloneproxy-onboarding.server'

const enabledPool = { query: async (sql: string) => {
  if (sql.includes('AS enabled')) return { rows: [{ enabled: 1 }] }
  if (sql.includes('FROM t_telegram_clone_proxy_config c JOIN')) return { rows: [{
    is_enable: 1, charge_enable: 0, open_price: '0', default_revenue_ratio: '20',
    merchant_limit: 5, bot_token: '12345:Abcdefghijklmnopqrstuvwxyz_123', recharge_wallet_addr: null,
  }] }
  throw new Error('unexpected query: ' + sql)
} }

test('clone proxy entry button is appended only to enabled private reply keyboards', async () => {
  const markup = { keyboard: [[{ text: 'Help' }]], resize_keyboard: true }
  const appended = await appendCloneProxyButton(enabledPool as never, 8, 'private', markup) as { keyboard: unknown[][] }
  assert.equal((appended.keyboard[1][0] as { text: string }).text, CLONE_PROXY_BUTTON)
  const unchanged = await appendCloneProxyButton(enabledPool as never, 8, 'group', markup)
  assert.equal(unchanged, markup)
  assert.deepEqual(await appendCloneProxyButton(enabledPool as never, 8, 'private', {
    ...markup, keyboard: [...markup.keyboard, [{ text: CLONE_PROXY_BUTTON }]],
  }), { ...markup, keyboard: [...markup.keyboard, [{ text: CLONE_PROXY_BUTTON }]] })
  assert.match(telegramCloneProxyClaimPredicate, /cloneproxy:%/u)
  assert.match(telegramCloneProxyClaimPredicate, /克隆\/代理机器人/u)
})

test('private entry button sends the legacy offer and add callback', async () => {
  const previous = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  try {
    const requests: Array<{ url: string; payload: Record<string, unknown> }> = []
    const handled = await handleTelegramCloneProxyUpdate({
      pool: enabledPool as never,
      fetcher: async (input, init) => {
        requests.push({ url: String(input), payload: JSON.parse(String(init?.body)) })
        return Response.json({ ok: true })
      },
      botRid: 8,
      update: { message: { chat: { id: 77, type: 'private' }, from: { id: 77, username: 'alice' }, text: '克隆/代理' } },
    })
    assert.equal(handled, true)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://api.telegram.org/bot12345:Abcdefghijklmnopqrstuvwxyz_123/sendMessage')
    assert.match(String(requests[0].payload.text), /欢迎使用克隆代理机器人/u)
    assert.deepEqual(requests[0].payload.reply_markup, { inline_keyboard: [[{ text: '添加机器人', callback_data: 'cloneproxy:add' }]] })
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previous
  }
})

test('free onboarding creates an already-paid opening order and prompts for the bot token', async () => {
  const previous = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  const calls: Array<{ sql: string; params?: unknown[] }> = []
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      if (sql.startsWith('SELECT is_enable')) return { rows: [{ is_enable: 1, charge_enable: 0, open_price: '0', default_revenue_ratio: '20', merchant_limit: 5 }] }
      if (sql.startsWith('SELECT 1 FROM t_telegram_clone_proxy_merchant')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('SELECT rid,status,amount::text')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: 0 }], rowCount: 1 }
      if (sql.startsWith('INSERT INTO t_telegram_clone_proxy_order')) return { rows: [{ rid: 42 }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
    release() {},
  }
  const pool = {
    query: enabledPool.query,
    connect: async () => client,
  }
  try {
    const requests: Array<{ url: string; payload: Record<string, unknown> }> = []
    const handled = await handleTelegramCloneProxyUpdate({
      pool: pool as never,
      fetcher: async (input, init) => {
        requests.push({ url: String(input), payload: JSON.parse(String(init?.body)) })
        return Response.json({ ok: true })
      },
      botRid: 8,
      update: { callback_query: { id: 'callback-1', data: 'cloneproxy:add', from: { id: 77, username: 'alice' }, message: { chat: { id: 77, type: 'private' } } } },
    })
    assert.equal(handled, true)
    const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO t_telegram_clone_proxy_order'))
    assert.ok(insert)
    assert.deepEqual(insert.params?.slice(0, 6), [8, '77', 'alice', 0, 'free', 1])
    assert.equal((requests.at(-1)?.payload.reply_markup as Record<string, unknown>)?.force_reply, true)
    assert.match(String(requests.at(-1)?.payload.text), /请发送你的机器人 token/u)
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previous
  }
})

test('repeated balance callback never debits a paid opening order twice', async () => {
  const previous = process.env.PLATFORM_TELEGRAM_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  let status = 0
  let debitCount = 0
  const client = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT status,amount::text')) return { rows: [{ status, amount: '5.25', external_order_rid: null, expired: false }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot_user SET cash_usdt=')) { debitCount++; return { rows: [{ rid: 1 }], rowCount: 1 } }
      if (sql.startsWith('UPDATE t_telegram_clone_proxy_order SET payment_method=')) status = 1
      return { rows: [], rowCount: 0 }
    },
    release() {},
  }
  const pool = { query: enabledPool.query, connect: async () => client }
  try {
    const fetcher = async () => Response.json({ ok: true })
    const update = { callback_query: { id: 'balance-1', data: 'cloneproxy:balance:42', from: { id: 77, username: 'alice' }, message: { chat: { id: 77, type: 'private' } } } }
    await handleTelegramCloneProxyUpdate({ pool: pool as never, fetcher, botRid: 8, update })
    await handleTelegramCloneProxyUpdate({ pool: pool as never, fetcher, botRid: 8, update })
    assert.equal(status, 1)
    assert.equal(debitCount, 1)
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previous
  }
})
