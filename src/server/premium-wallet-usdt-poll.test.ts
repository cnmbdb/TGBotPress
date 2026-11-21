import { test } from 'node:test'
import assert from 'node:assert/strict'
import { premiumWalletStartTimestamp, syncPremiumWalletUsdtTrades } from './premium-wallet-usdt-poll.server'

const address = 'T' + 'A'.repeat(33)
const hash = (char: string) => char.repeat(64)
const response = (body: unknown) => Response.json(body)

test('premium USDT poll is disabled by default without database or provider work', async () => {
  let queried = false, requested = false
  const result = await syncPremiumWalletUsdtTrades({
    pool: { query: async () => { queried = true; return { rows: [], rowCount: 0 } } } as never,
    request: async () => { requested = true; return response({}) },
  })
  assert.deepEqual(result, { wallets: 0, inserted: 0, skipped: true })
  assert.equal(queried, false)
  assert.equal(requested, false)
})

test('premium wallet polling resumes from the later transaction or wallet activation time', () => {
  assert.equal(premiumWalletStartTimestamp('1800000000000', '2026-10-29 08:00:00'), '1800000000000')
  assert.equal(premiumWalletStartTimestamp('0', '2026-10-29 08:00:00'), String(Date.parse('2026-10-29T08:00:00+08:00') - 10))
})

test('premium USDT poll paginates safely and imports exact, idempotent incoming transfers', async () => {
  const stored = new Set<string>()
  const inserted: Array<{ hash: string; from: string; to: string; amount: string; timestamp: string }> = []
  const urls: URL[] = []
  let page = 0
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM t_premium_platform w')) return { rows: [{
        rid: 9, receive_wallet: address, get_tx_time: null, latest_timestamp: '0',
      }], rowCount: 1 }
      if (sql.includes('FROM t_sys_config')) return { rows: [{ config_val: JSON.stringify({ keys: 'grid-a, grid-b' }) }], rowCount: 1 }
      throw new Error('unexpected pool SQL: ' + sql)
    },
    connect: async () => ({
      query: async (sql: string, values: unknown[] = []) => {
        if (sql.startsWith('SELECT 1 FROM t_premium_wallet_trade_list')) {
          return { rows: stored.has(String(values[0])) ? [{ '?column?': 1 }] : [], rowCount: Number(stored.has(String(values[0]))) }
        }
        if (sql.startsWith('INSERT INTO t_premium_wallet_trade_list')) {
          const [txHash, from, to, amount, timestamp] = values as [string, string, string, string, string, Date]
          stored.add(txHash); inserted.push({ hash: txHash, from, to, amount, timestamp })
          return { rows: [], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
      release() {},
    }),
  }
  const request = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input)); urls.push(url)
    assert.equal(url.hostname, 'api.trongrid.io')
    assert.equal(url.pathname, '/v1/accounts/' + address + '/transactions/trc20')
    assert.equal(url.searchParams.get('contract_address'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    assert.equal(url.searchParams.get('only_to'), 'true')
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.signal)
    assert.ok(['grid-a', 'grid-b'].includes(new Headers(init?.headers).get('TRON-PRO-API-KEY')!))
    if (page++ === 0) return response({
      data: [
        { transaction_id: hash('a'), type: 'Transfer', from: 'T' + 'B'.repeat(33), to: address, value: '120123456', block_timestamp: 1770000000100 },
        { transaction_id: 'bad', type: 'Approve', from: 'T' + 'B'.repeat(33), to: address, value: '7', block_timestamp: 1770000000100 },
        { transaction_id: hash('c'), type: 'Transfer', from: 'T' + 'B'.repeat(33), to: 'T' + 'C'.repeat(33), value: '5000000', block_timestamp: 1770000000100 },
      ],
      meta: { links: { next: url.origin + url.pathname + '?limit=50&only_to=true&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&fingerprint=next' } },
    })
    assert.equal(url.searchParams.get('fingerprint'), 'next')
    return response({ data: [
      { transaction_id: hash('b'), type: 'Transfer', from: 'T' + 'B'.repeat(33), to: address, value: '5000000', block_timestamp: 1770000000200 },
      { transaction_id: hash('a'), type: 'Transfer', from: 'T' + 'B'.repeat(33), to: address, value: '120123456', block_timestamp: 1770000000100 },
    ] })
  }
  const result = await syncPremiumWalletUsdtTrades({
    pool: pool as never, request, enabled: true, now: () => new Date('2026-10-29T00:00:00Z'),
    logger: { error(message) { throw new Error(message) } },
  })
  assert.deepEqual(result, { wallets: 1, inserted: 2, skipped: false })
  assert.equal(urls.length, 2)
  assert.deepEqual(inserted, [
    { hash: hash('a'), from: 'T' + 'B'.repeat(33), to: address, amount: '120.123456', timestamp: '1770000000100' },
    { hash: hash('b'), from: 'T' + 'B'.repeat(33), to: address, amount: '5', timestamp: '1770000000200' },
  ])
})

test('premium USDT poll rejects an untrusted pagination host before requesting it', async () => {
  let calls = 0
  const pool = {
    query: async (sql: string) => sql.includes('FROM t_premium_platform w')
      ? { rows: [{ rid: 1, receive_wallet: address, get_tx_time: null, latest_timestamp: '0' }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
    connect: async () => { throw new Error('no insert expected') },
  }
  const errors: string[] = []
  await syncPremiumWalletUsdtTrades({
    pool: pool as never,
    enabled: true,
    logger: { error: message => errors.push(message) },
    request: async input => {
      calls++
      const url = new URL(String(input))
      return response({ data: [], meta: { links: { next: 'https://evil.example' + url.pathname + '?only_to=true&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t' } } })
    },
  })
  assert.equal(calls, 1)
  assert.ok(errors.some(message => message.includes('invalid TronGrid pagination URL')))
})

