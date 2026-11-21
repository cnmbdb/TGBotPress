import assert from 'node:assert/strict'
import { test } from 'node:test'
import { syncShanduiBonus } from './shandui-bonus.server'
import { platformScheduledTasks } from './platform-worker.server'

test('shandui bonus is scheduled every two seconds and disabled by default', async () => {
  const pool = { query: async () => { throw new Error('database must remain untouched') }, connect: async () => { throw new Error('database must remain untouched') } } as never
  const task = platformScheduledTasks(pool).find(item => item.name === 'shanduiBonus')
  assert.ok(task)
  assert.equal(task.intervalMs, 2_000)
  const previous = process.env.PLATFORM_TRANSIT_BONUS_ACTIONS
  process.env.PLATFORM_TRANSIT_BONUS_ACTIONS = 'false'
  try {
    assert.deepEqual(await task.run(() => true), { skipped: true, processed: 0, succeeded: 0, failed: 0 })
    assert.deepEqual(await syncShanduiBonus({ pool }), { skipped: true, processed: 0, succeeded: 0, failed: 0 })
  } finally {
    if (previous == null) delete process.env.PLATFORM_TRANSIT_BONUS_ACTIONS
    else process.env.PLATFORM_TRANSIT_BONUS_ACTIONS = previous
  }
})

test('claims one eligible trade, signs only ciphertext and atomically records a successful TRX return', async () => {
  const previous = {
    env: process.env.APP_ENV, url: process.env.TRON_SIGNER_URL, token: process.env.TRON_SIGNER_TOKEN,
    enabled: process.env.PLATFORM_TRANSIT_BONUS_ACTIONS,
  }
  Object.assign(process.env, { APP_ENV: 'development', TRON_SIGNER_URL: 'http://signer.test', TRON_SIGNER_TOKEN: 'test-token-012345678901234567890123456789', PLATFORM_TRANSIT_BONUS_ACTIONS: 'true' })
  const statements: string[] = []
  const candidate = {
    rid: 81, amount: '4.25', sendback_address: 'T-recipient', transit_wallet_id: 5,
    send_wallet: 'T-source', send_wallet_privatekey: 'ciphertext-fixture', out_coin_name: 'trx',
    exchange_rate: '2.00', kou_out_amount: '0.50', min_transit_amount: '1', max_transit_amount: '10', black_wallet: false,
  }
  let claimed = false
  const client = {
    query: async (sql: string) => {
      statements.push(sql)
      if (sql.startsWith('SELECT rid,total_transit_usdt')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('UPDATE t_transit_wallet_trade_list SET process_status=9')) return { rows: [], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    release() {},
  }
  const pool = {
    query: async (sql: string) => {
      statements.push(sql)
      if (sql.startsWith('WITH candidate')) {
        if (claimed) return { rows: [], rowCount: 0 }
        claimed = true
        return { rows: [candidate], rowCount: 1 }
      }
      if (sql.startsWith('SELECT need_feedback_sxf')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => client,
  } as never
  let requestBody: Record<string, unknown> | undefined
  try {
    const result = await syncShanduiBonus({ pool, batchSize: 1, fetcher: async (input, init) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.trongrid.io' && url.pathname === '/wallet/getaccount') return Response.json({ balance: 100000000 })
      assert.equal(url.href, 'http://signer.test/api/internal/tron/sign')
      requestBody = JSON.parse(String(init?.body || '{}'))
      return Response.json({ code: 200, data: { txid: 'fixture-txid' } })
    }, logger: { error() {} } })
    assert.deepEqual(result, { skipped: false, processed: 1, succeeded: 1, failed: 0 })
    assert.equal(requestBody?.operation, 'transfer_trx')
    assert.equal(requestBody?.amount, '8.00')
    assert.equal(requestBody?.private_key_ciphertext, 'ciphertext-fixture')
    assert.equal('private_key' in (requestBody || {}), false)
    assert.ok(statements.includes('COMMIT'))
    assert.ok(statements.some(sql => sql.startsWith('INSERT INTO t_transit_user_wallet')))
  } finally {
    for (const [key, value] of Object.entries({ APP_ENV: previous.env, TRON_SIGNER_URL: previous.url, TRON_SIGNER_TOKEN: previous.token, PLATFORM_TRANSIT_BONUS_ACTIONS: previous.enabled })) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
})



test('zero or failed TronGrid balances retry three times before the legacy TronScan fallback', async () => {
  const previous = {
    env: process.env.APP_ENV, url: process.env.TRON_SIGNER_URL, token: process.env.TRON_SIGNER_TOKEN,
    enabled: process.env.PLATFORM_TRANSIT_BONUS_ACTIONS,
  }
  Object.assign(process.env, { APP_ENV: 'development', TRON_SIGNER_URL: 'http://signer.test', TRON_SIGNER_TOKEN: 'test-token-012345678901234567890123456789', PLATFORM_TRANSIT_BONUS_ACTIONS: 'true' })
  const candidate = {
    rid: 82, amount: '4.25', sendback_address: 'T-recipient', transit_wallet_id: 5,
    send_wallet: 'T-source', send_wallet_privatekey: 'ciphertext-fixture', out_coin_name: 'trx',
    exchange_rate: '2.00', kou_out_amount: '0.50', min_transit_amount: '1', max_transit_amount: '10', black_wallet: false,
  }
  const statements: string[] = [], calls: string[] = [], delays: number[] = []
  let claimed = false
  const client = {
    query: async (sql: string) => {
      statements.push(sql)
      if (sql.startsWith('SELECT rid,total_transit_usdt')) return { rows: [], rowCount: 0 }
      if (sql.startsWith('UPDATE t_transit_wallet_trade_list SET process_status=9')) return { rows: [], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    },
    release() {},
  }
  const pool = {
    query: async (sql: string) => {
      statements.push(sql)
      if (sql.startsWith('WITH candidate')) {
        if (claimed) return { rows: [], rowCount: 0 }
        claimed = true
        return { rows: [candidate], rowCount: 1 }
      }
      if (sql.startsWith('SELECT need_feedback_sxf')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 1 }
    },
    connect: async () => client,
  } as never
  let signerPayload: Record<string, unknown> | undefined
  try {
    const result = await syncShanduiBonus({
      pool, batchSize: 1, sleep: async milliseconds => { delays.push(milliseconds) }, logger: { error() {} },
      fetcher: async (input, init) => {
        const url = new URL(String(input))
        calls.push(url.hostname + url.pathname)
        if (url.hostname === 'api.trongrid.io') {
          if (calls.filter(call => call === 'api.trongrid.io/wallet/getaccount').length === 1) throw new Error('transient provider failure')
          return Response.json({ balance: 0 })
        }
        if (url.hostname === 'apilist.tronscanapi.com') return Response.json({ balance: 100_000_000 })
        assert.equal(url.hostname, 'signer.test')
        signerPayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return Response.json({ code: 200, data: { txid: 'fallback-fixture-txid' } })
      },
    })
    assert.deepEqual(result, { skipped: false, processed: 1, succeeded: 1, failed: 0 })
    assert.equal(calls.filter(call => call === 'api.trongrid.io/wallet/getaccount').length, 3)
    assert.equal(calls[3], 'apilist.tronscanapi.com/api/accountv2')
    assert.deepEqual(delays, [1_000, 1_000, 1_000])
    assert.equal(signerPayload?.amount, '8.00')
    assert.ok(statements.includes('COMMIT'))
  } finally {
    for (const [key, value] of Object.entries({ APP_ENV: previous.env, TRON_SIGNER_URL: previous.url, TRON_SIGNER_TOKEN: previous.token, PLATFORM_TRANSIT_BONUS_ACTIONS: previous.enabled })) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
  }
})
