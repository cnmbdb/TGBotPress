import assert from 'node:assert/strict'
import test from 'node:test'
import { energyBalancePurchaseCallback, energyBalancePurchaseClaimPredicate, handleEnergyBalancePurchaseCallback } from './telegram-energy-balance-purchases.server'

const update = (data: string, id: string, rid = 9101) => ({
  rid,
  bot_rid: 7,
  update_body: {
    callback_query: {
      id,
      data,
      from: { id: 55, username: 'alice' },
      message: { message_id: 42, chat: { id: 55, type: 'private' }, reply_markup: { inline_keyboard: [[{ text: 'confirm', callback_data: data }]] } },
    },
  },
})

test('energy balance callbacks require the private caller and exact originating keyboard button', () => {
  assert.equal(energyBalancePurchaseCallback(update('balancebuytrx123', 'cb1').update_body)?.action, 'select')
  assert.deepEqual(energyBalancePurchaseCallback(update('balancebuyconfusd123', 'cb2').update_body)?.payment, 'usd')
  assert.deepEqual(energyBalancePurchaseCallback(update('balancebuyother123_trx', 'cb-other').update_body), {
    callback: update('balancebuyother123_trx', 'cb-other').update_body.callback_query,
    message: update('balancebuyother123_trx', 'cb-other').update_body.callback_query.message,
    chatId: '55', userId: '55', packageRid: 123, payment: 'trx', action: 'other',
  })
  const forged = update('balancebuyconftrx123', 'cb3')
  forged.update_body.callback_query.message.chat.type = 'group'
  assert.equal(energyBalancePurchaseCallback(forged.update_body), null)
  const detached = update('balancebuyconftrx123', 'cb4')
  detached.update_body.callback_query.message.reply_markup.inline_keyboard[0][0].callback_data = 'balancebuyusd123'
  assert.equal(energyBalancePurchaseCallback(detached.update_body), null)
})

test('energy balance claim predicate scopes both callback patterns to a private user keyboard', () => {
  assert.match(energyBalancePurchaseClaimPredicate, /chat,type\}'='private'/u)
  assert.match(energyBalancePurchaseClaimPredicate, /chat,id\}'=u\.update_body/u)
  assert.match(energyBalancePurchaseClaimPredicate, /balancebuy\(trx\|usd\)/u)
  assert.match(energyBalancePurchaseClaimPredicate, /balancebuyconf\(trx\|usd\)/u)
  assert.match(energyBalancePurchaseClaimPredicate, /balancebuyother/u)
  assert.match(energyBalancePurchaseClaimPredicate, /jsonb_array_elements/u)
})

test('other-address callback prompts for a wallet and stores a short-lived package/payment-bound state', async () => {
  const telegramEnv = process.env.PLATFORM_TELEGRAM_ACTIONS
  const energyEnv = process.env.PLATFORM_ENERGY_ORDER_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_ENERGY_ORDER_ACTIONS = 'true'
  const poolQueries: Array<{ sql: string; values?: unknown[] }> = []
  const requests: Array<{ method: string; payload: any }> = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    poolQueries.push({ sql, values })
    if (sql.startsWith('SELECT bot_token,bot_admin_username')) return { rows: [{ bot_token: '12345:' + 'a'.repeat(32), bot_admin_username: '@support_bot' }], rowCount: 1 }
    if (sql.startsWith('SELECT p.package_name')) return { rows: [{ package_name: '快速套餐' }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM')) return { rows: [{ bot_token: '12345:' + 'a'.repeat(32) }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  try {
    assert.equal(await handleEnergyBalancePurchaseCallback({ pool: pool as never, fetcher: (async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true, result: { message_id: 901 } })
    }) as typeof fetch, botRid: 7, update: update('balancebuyother123_trx', 'other-address') }), true)
    assert.equal(requests[0].method, 'answerCallbackQuery')
    assert.equal(requests[1].method, 'sendMessage')
    assert.deepEqual(requests[1].payload.reply_markup, { force_reply: true, selective: true })
    assert.match(requests[1].payload.text, /快速套餐/u)
    const state = poolQueries.find(row => row.sql.startsWith('INSERT INTO t_platform_telegram_conversation_state'))
    assert.deepEqual(state?.values?.slice(0, 4), [7, '55', '55', '901'])
    assert.deepEqual(JSON.parse(String(state?.values?.[4])), { packageRid: 123, payment: 'trx' })
  } finally {
    if (telegramEnv === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = telegramEnv
    if (energyEnv === undefined) delete process.env.PLATFORM_ENERGY_ORDER_ACTIONS
    else process.env.PLATFORM_ENERGY_ORDER_ACTIONS = energyEnv
  }
})

test('reply purchase validates the prompt state, charges once, targets the submitted wallet, and replays by update id', async () => {
  const telegramEnv = process.env.PLATFORM_TELEGRAM_ACTIONS
  const energyEnv = process.env.PLATFORM_ENERGY_ORDER_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_ENERGY_ORDER_ACTIONS = 'true'
  const wallet = 'T' + 'A'.repeat(33)
  const messageUpdate = { rid: 9102, bot_rid: 7, update_body: { message: { message_id: 77, text: wallet, chat: { id: 55, type: 'private' }, from: { id: 55 }, reply_to_message: { message_id: 901 } } } }
  const poolQueries: Array<{ sql: string; values?: unknown[] }> = []
  const clientQueries: Array<{ sql: string; values?: unknown[] }> = []
  const requests: Array<{ method: string; payload: any }> = []
  let existingReceipt: any = null
  let debitCount = 0
  let orderWallet = ''
  const client = { query: async (sql: string, values?: unknown[]) => {
    clientQueries.push({ sql, values })
    if (sql.startsWith('SELECT update_rid,outcome,response_text,response_markup')) return { rows: existingReceipt ? [existingReceipt] : [], rowCount: existingReceipt ? 1 : 0 }
    if (sql.startsWith('SELECT context FROM t_platform_telegram_conversation_state')) return { rows: [{ context: { packageRid: 123, payment: 'trx' } }], rowCount: 1 }
    if (sql.startsWith('SELECT rid,bind_trc_wallet_addr,cash_trx::text,cash_usdt::text')) return { rows: [{ rid: 77, bind_trc_wallet_addr: null, cash_trx: '10.000000', cash_usdt: '3.500000' }], rowCount: 1 }
    if (sql.startsWith('SELECT p.rid,p.package_name')) return { rows: [{ rid: 123, package_name: '快速套餐', energy_amount: 65000, energy_day: 1, trx_price: '2.125000', usdt_price: '1.25' }], rowCount: 1 }
    if (sql.startsWith('UPDATE t_telegram_bot_user SET cash_trx=')) { debitCount++; return { rows: [{ cash_trx: '7.875000', cash_usdt: '3.500000' }], rowCount: 1 } }
    if (sql.startsWith('INSERT INTO t_energy_quick_order')) { orderWallet = String(values?.[2]); return { rows: [{ rid: 501 }], rowCount: 1 } }
    if (sql.startsWith('INSERT INTO t_platform_telegram_energy_balance_purchase')) {
      existingReceipt = { update_rid: 9102, outcome: 'purchased', response_text: values?.[9], response_markup: JSON.parse(String(values?.[10])) }
      return { rows: [existingReceipt], rowCount: 1 }
    }
    return { rows: [], rowCount: 1 }
  }, release: () => undefined }
  const pool = { query: async (sql: string, values?: unknown[]) => {
    poolQueries.push({ sql, values })
    if (sql.startsWith('SELECT context FROM t_platform_telegram_conversation_state')) return { rows: [{ context: { packageRid: 123, payment: 'trx' } }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token,bot_admin_username')) return { rows: [{ bot_token: '12345:' + 'a'.repeat(32), bot_admin_username: '@support_bot' }], rowCount: 1 }
    if (sql.startsWith('SELECT chat_id::text,response_text,response_markup')) return { rows: [{ chat_id: '55', response_text: existingReceipt.response_text, response_markup: existingReceipt.response_markup }], rowCount: 1 }
    if (sql.startsWith('SELECT bot_token FROM')) return { rows: [{ bot_token: '12345:' + 'a'.repeat(32) }], rowCount: 1 }
    throw new Error(`unexpected pool query: ${sql}`)
  }, connect: async () => client }
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
    return Response.json({ ok: true })
  }
  try {
    assert.equal(await handleEnergyBalancePurchaseCallback({ pool: pool as never, fetcher: fetcher as typeof fetch, botRid: 7, update: messageUpdate as never }), true)
    assert.equal(debitCount, 1)
    assert.equal(orderWallet, wallet)
    assert.ok(clientQueries.some(row => row.sql.startsWith('DELETE FROM t_platform_telegram_conversation_state')))
    assert.ok(clientQueries.some(row => row.sql === 'COMMIT'))
    assert.match(requests.at(-1)?.payload.text, new RegExp(wallet, 'u'))

    requests.length = 0
    assert.equal(await handleEnergyBalancePurchaseCallback({ pool: pool as never, fetcher: fetcher as typeof fetch, botRid: 7, update: messageUpdate as never }), true)
    assert.equal(debitCount, 1)
    assert.equal(requests.filter(row => row.method === 'sendMessage').length, 1)
  } finally {
    if (telegramEnv === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = telegramEnv
    if (energyEnv === undefined) delete process.env.PLATFORM_ENERGY_ORDER_ACTIONS
    else process.env.PLATFORM_ENERGY_ORDER_ACTIONS = energyEnv
  }
})

test('energy balance confirmation debits and creates one quick order transactionally, replay only resends receipt', async () => {
  const env = process.env.PLATFORM_TELEGRAM_ACTIONS
  const energyEnv = process.env.PLATFORM_ENERGY_ORDER_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_ENERGY_ORDER_ACTIONS = 'true'
  const clientQueries: Array<{ sql: string; values?: unknown[] }> = []
  const poolQueries: string[] = []
  const requests: Array<{ method: string; payload: any }> = []
  let existingReceipt: any = null
  let debitCount = 0
  let orderCount = 0
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      clientQueries.push({ sql, values })
      if (sql.startsWith('SELECT update_rid,outcome,response_text,response_markup FROM t_platform_telegram_energy_balance_purchase')) return { rows: existingReceipt ? [existingReceipt] : [], rowCount: existingReceipt ? 1 : 0 }
      if (sql.startsWith('SELECT rid,bind_trc_wallet_addr,cash_trx::text,cash_usdt::text')) return { rows: [{ rid: 77, bind_trc_wallet_addr: 'T'.padEnd(34, 'A'), cash_trx: '10.000000', cash_usdt: '3.500000' }], rowCount: 1 }
      if (sql.startsWith('SELECT p.rid,p.package_name')) return { rows: [{ rid: 123, package_name: '快速套餐', energy_amount: 65000, energy_day: 1, trx_price: '2.125000', usdt_price: '1.25' }], rowCount: 1 }
      if (sql.startsWith('UPDATE t_telegram_bot_user SET cash_trx=')) { debitCount++; return { rows: [{ cash_trx: '7.875000', cash_usdt: '3.500000' }], rowCount: 1 } }
      if (sql.startsWith('INSERT INTO t_energy_quick_order')) { orderCount++; return { rows: [{ rid: 500 }], rowCount: 1 } }
      if (sql.startsWith('INSERT INTO t_platform_telegram_energy_balance_purchase')) {
        existingReceipt = { update_rid: 9101, outcome: 'purchased', response_text: values?.[9], response_markup: JSON.parse(String(values?.[10])) }
        return { rows: [existingReceipt], rowCount: 1 }
      }
      return { rows: [], rowCount: 1 }
    },
    release: () => undefined,
  }
  const pool = {
    query: async (sql: string) => {
      poolQueries.push(sql)
      if (sql.startsWith('SELECT bot_token,bot_admin_username')) return { rows: [{ bot_token: '12345:' + 'a'.repeat(32), bot_admin_username: '@support_bot' }], rowCount: 1 }
      if (sql.startsWith('SELECT bot_token FROM')) return { rows: [{ bot_token: '12345:' + 'a'.repeat(32) }], rowCount: 1 }
      throw new Error(`unexpected pool query: ${sql}`)
    },
    connect: async () => client,
  }
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
    return Response.json({ ok: true, result: { message_id: 99 } })
  }
  const args = { pool: pool as never, fetcher: fetcher as typeof fetch, botRid: 7, update: update('balancebuyconftrx123', 'purchase-callback') }
  try {
    assert.equal(await handleEnergyBalancePurchaseCallback(args), true)
    assert.equal(debitCount, 1)
    assert.equal(orderCount, 1)
    assert.ok(clientQueries.some(row => row.sql === 'BEGIN'))
    assert.ok(clientQueries.some(row => row.sql === 'COMMIT'))
    assert.equal(requests[0].method, 'answerCallbackQuery')
    assert.equal(requests[1].method, 'sendMessage')
    assert.match(requests[1].payload.text, /7\.875000 TRX 3\.500000 USDT/u)
    assert.equal(requests[1].payload.reply_markup.inline_keyboard[0][0].callback_data, '/buyenergy')

    requests.length = 0
    await handleEnergyBalancePurchaseCallback({ ...args, update: update('balancebuyconftrx123', 'purchase-callback', 9102) })
    assert.equal(debitCount, 1)
    assert.equal(orderCount, 1)
    assert.equal(requests.filter(row => row.method === 'sendMessage').length, 1)
    assert.ok(poolQueries.length >= 2)
  } finally {
    if (env === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = env
    if (energyEnv === undefined) delete process.env.PLATFORM_ENERGY_ORDER_ACTIONS
    else process.env.PLATFORM_ENERGY_ORDER_ACTIONS = energyEnv
  }
})

test('energy balance confirmation does not debit unless energy order actions are explicitly enabled', async () => {
  const telegramEnv = process.env.PLATFORM_TELEGRAM_ACTIONS
  const energyEnv = process.env.PLATFORM_ENERGY_ORDER_ACTIONS
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'true'
  process.env.PLATFORM_ENERGY_ORDER_ACTIONS = 'false'
  const requests: Array<{ method: string; payload: any }> = []
  const pool = {
    query: async () => ({ rows: [{ bot_token: '12345:' + 'a'.repeat(32), bot_admin_username: '@support_bot' }], rowCount: 1 }),
    connect: async () => { throw new Error('disabled purchase must not connect to the database') },
  }
  try {
    await handleEnergyBalancePurchaseCallback({ pool: pool as never, fetcher: (async (input, init) => {
      requests.push({ method: String(input).split('/').pop()!, payload: JSON.parse(String(init?.body)) })
      return Response.json({ ok: true })
    }) as typeof fetch, botRid: 7, update: update('balancebuyconftrx123', 'disabled-callback') })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].method, 'answerCallbackQuery')
    assert.equal(requests[0].payload.show_alert, true)
    assert.equal(requests[0].payload.text, '余额购买功能当前未启用')
  } finally {
    if (telegramEnv === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = telegramEnv
    if (energyEnv === undefined) delete process.env.PLATFORM_ENERGY_ORDER_ACTIONS
    else process.env.PLATFORM_ENERGY_ORDER_ACTIONS = energyEnv
  }
})
