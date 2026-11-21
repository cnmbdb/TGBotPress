import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { syncTransitWalletUsdtTrades } from './transit-wallet-usdt-poll.server'

const raw = process.env.TG_TRANSIT_USDT_POLL_TEST_DB_URL
const parsed = raw ? new URL(raw) : null
const octets = parsed?.hostname.split('.').map(Number)
const privateHost = parsed?.hostname === 'postgres' ||
  (process.env.TG_TRANSIT_USDT_POLL_TEST_ALLOW_PRIVATE_DB === '1' && octets?.length === 4 &&
    octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
if (raw && (!parsed || !privateHost ||
  !parsed.username.startsWith('transit_usdt_poll_test_') ||
  !parsed.pathname.slice(1).startsWith('transit_usdt_poll_test_'))) {
  throw new Error('Transit USDT integration requires an isolated transit_usdt_poll_test_ database and role')
}

test('imports paginated TronGrid USDT transfers into an isolated PostgreSQL schema idempotently', { skip: !raw }, async () => {
  const admin = new pg.Pool({ connectionString: raw, max: 2 })
  const schema = 'transit_usdt_poll_' + randomUUID().replaceAll('-', '')
  await admin.query('CREATE SCHEMA "' + schema + '"')
  const pool = new pg.Pool({ connectionString: raw, max: 2, options: '-c search_path=' + schema })
  const wallet = 'T' + 'A'.repeat(33), sender = 'T' + 'B'.repeat(33)
  const firstHash = 'a'.repeat(64), secondHash = 'b'.repeat(64)
  let page = 0
  const request = async (input: string | URL) => {
    const url = new URL(String(input))
    assert.equal(url.hostname, 'api.trongrid.io')
    assert.equal(url.pathname, '/v1/accounts/' + wallet + '/transactions/trc20')
    assert.equal(url.searchParams.get('contract_address'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    assert.equal(url.searchParams.get('only_to'), 'true')
    if (page++ === 0) {
      assert.equal(url.searchParams.get('min_timestamp'), '0')
      return Response.json({
        data: [
          { transaction_id: firstHash, type: 'Transfer', from: sender, value: '120123456', block_timestamp: 1770000000100 },
          { transaction_id: 'invalid', type: 'Approve', from: sender, value: '9', block_timestamp: 1770000000100 },
        ],
        meta: { links: { next: url.origin + url.pathname + '?limit=50&only_to=true&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&fingerprint=next-page' } },
      })
    }
    assert.equal(url.searchParams.get('fingerprint'), 'next-page')
    return Response.json({ data: [
      { transaction_id: secondHash, type: 'Transfer', from: sender, value: '5000000', block_timestamp: 1770000000200 },
      { transaction_id: firstHash, type: 'Transfer', from: sender, value: '120123456', block_timestamp: 1770000000100 },
    ] })
  }
  try {
    await pool.query([
      'CREATE TABLE t_transit_wallet(rid integer PRIMARY KEY,receive_wallet varchar(200),get_tx_time timestamp,status smallint)',
      'CREATE TABLE t_transit_wallet_trade_list(rid serial PRIMARY KEY,tx_hash varchar(100),transferfrom_address varchar(200),transferto_address varchar(200),coin_name varchar(20),amount varchar(100),"timestamp" varchar(20),process_status smallint,process_time timestamp,process_comments varchar(255),get_time timestamp,sendback_address varchar(200),sendback_amount varchar(100),sendback_coin_name varchar(20))',
      "INSERT INTO t_transit_wallet VALUES(1,'" + wallet + "',NULL,0),(2,'T" + 'C'.repeat(33) + "',NULL,1)",
    ].join(';'))
    const result = await syncTransitWalletUsdtTrades({
      pool,
      request,
      enabled: true,
      logger: { info() {}, error(message) { throw new Error(message) } },
      now: () => new Date('2026-10-29T00:00:00Z'),
    })
    assert.deepEqual(result, { wallets: 1, inserted: 2, skipped: false })
    const rows = await pool.query('SELECT tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,process_comments,sendback_address,sendback_coin_name FROM t_transit_wallet_trade_list ORDER BY tx_hash')
    assert.deepEqual(rows.rows, [
      { tx_hash: firstHash, transferfrom_address: sender, transferto_address: wallet, coin_name: 'usdt', amount: '120.123456', timestamp: '1770000000100', process_status: 1, process_comments: '待兑换', sendback_address: sender, sendback_coin_name: 'trx' },
      { tx_hash: secondHash, transferfrom_address: sender, transferto_address: wallet, coin_name: 'usdt', amount: '5', timestamp: '1770000000200', process_status: 1, process_comments: '待兑换', sendback_address: sender, sendback_coin_name: 'trx' },
    ])
    page = 0
    const repeated = await syncTransitWalletUsdtTrades({
      pool,
      request: async input => {
        const url = new URL(String(input))
        assert.equal(url.searchParams.get('min_timestamp'), '1770000000200')
        return Response.json({ data: [
          { transaction_id: secondHash, type: 'Transfer', from: sender, value: '5000000', block_timestamp: 1770000000200 },
        ] })
      },
      enabled: true,
      logger: { info() {}, error(message) { throw new Error(message) } },
    })
    assert.deepEqual(repeated, { wallets: 1, inserted: 0, skipped: false })
    assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM t_transit_wallet_trade_list')).rows[0].count), 2)
    const concurrentHash = 'c'.repeat(64)
    const concurrentRequest = async (input: string | URL) => {
      const url = new URL(String(input))
      assert.ok(['1770000000200', '1770000000300'].includes(url.searchParams.get('min_timestamp') ?? ''))
      return Response.json({ data: [
        { transaction_id: concurrentHash, type: 'Transfer', from: sender, value: '7500000', block_timestamp: 1770000000300 },
      ] })
    }
    const concurrent = await Promise.all([
      syncTransitWalletUsdtTrades({ pool, request: concurrentRequest, enabled: true, logger: { info() {}, error(message) { throw new Error(message) } } }),
      syncTransitWalletUsdtTrades({ pool, request: concurrentRequest, enabled: true, logger: { info() {}, error(message) { throw new Error(message) } } }),
    ])
    assert.equal(concurrent.reduce((total, result) => total + result.inserted, 0), 1)
    assert.equal(Number((await pool.query('SELECT count(*)::int AS count FROM t_transit_wallet_trade_list')).rows[0].count), 3)
  } finally {
    await pool.end()
    await admin.query('DROP SCHEMA "' + schema + '" CASCADE')
    await admin.end()
  }
})
