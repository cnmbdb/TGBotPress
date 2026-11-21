import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncTransitWalletUsdtTrades, transitUsdtStartTimestamp } from './transit-wallet-usdt-poll.server'

function fixturePool(existing = false) {
  const inserted: unknown[][] = []
  const statements: string[] = []
  const pool = {
    async query(sql: string) {
      statements.push(sql)
      return { rows: [{ rid: 4, receive_wallet: 'T' + 'A'.repeat(33), get_tx_time: null, latest_timestamp: '1770000000000' }], rowCount: 1 }
    },
    async connect() {
      return {
        async query(sql: string, values: unknown[] = []) {
          statements.push(sql)
          if (sql.startsWith('SELECT 1 FROM t_transit_wallet_trade_list')) return { rows: existing ? [{ '?column?': 1 }] : [], rowCount: existing ? 1 : 0 }
          if (sql.startsWith('INSERT INTO t_transit_wallet_trade_list')) inserted.push(values)
          return { rows: [], rowCount: 1 }
        },
        release() {},
      }
    },
    inserted,
    statements,
  }
  return pool
}

test('does no database or provider work unless explicitly enabled', async () => {
  const pool = { async query() { throw new Error('database should not be queried') } } as never
  const result = await syncTransitWalletUsdtTrades({ pool, enabled: false, request: async () => { throw new Error('network should not be called') } })
  assert.deepEqual(result, { wallets: 0, inserted: 0, skipped: true })
})

test('uses the newest existing transaction time or the configured wallet lower bound', () => {
  assert.equal(transitUsdtStartTimestamp('1770000000050', '2026-02-02 00:00:00'), '1770000000050')
  assert.equal(transitUsdtStartTimestamp('1770000000000', '2026-02-02 00:00:00'), '1770000000000')
})

test('imports valid USDT TRC20 transfers and stores their exact amount', async () => {
  const pool = fixturePool()
  const requested: URL[] = []
  const hash = 'a'.repeat(64)
  const result = await syncTransitWalletUsdtTrades({
    pool: pool as never,
    enabled: true,
    logger: { info() {}, error() {} },
    now: () => new Date('2026-10-29T00:00:00Z'),
    request: async input => {
      requested.push(new URL(String(input)))
      return Response.json({ data: [{ transaction_id: hash, type: 'Transfer', from: 'T' + 'B'.repeat(33), value: '120123456', block_timestamp: 1770000000100 }] })
    },
  })
  assert.equal(result.wallets, 1)
  assert.equal(result.inserted, 1)
  assert.equal(requested[0]?.hostname, 'api.trongrid.io')
  assert.equal(requested[0]?.searchParams.get('only_to'), 'true')
  assert.equal(requested[0]?.searchParams.get('contract_address'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
  assert.equal(pool.inserted.length, 1)
  assert.equal(pool.inserted[0][0], hash)
  assert.equal(pool.inserted[0][3], '120.123456')
})

test('skips an already imported transaction hash', async () => {
  const pool = fixturePool(true)
  const result = await syncTransitWalletUsdtTrades({
    pool: pool as never,
    enabled: true,
    logger: { info() {}, error() {} },
    request: async () => Response.json({ data: [{ transaction_id: 'b'.repeat(64), type: 'Transfer', from: 'T' + 'B'.repeat(33), value: '5000000', block_timestamp: 1770000000100 }] }),
  })
  assert.equal(result.inserted, 0)
  assert.equal(pool.inserted.length, 0)
})
