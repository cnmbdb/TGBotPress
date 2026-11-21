import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { syncPremiumWalletUsdtTrades, premiumWalletStartTimestamp } from './premium-wallet-usdt-poll.server'

const connectionString = process.env.TG_PREMIUM_WALLET_POLL_TEST_DB_URL
const wallet = 'T' + 'A'.repeat(33)
const sender = 'T' + 'B'.repeat(33)
const hash = (char: string) => char.repeat(64)
const contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const pageUrl = `https://api.trongrid.io/v1/accounts/${wallet}/transactions/trc20`

test('premium wallet polling persists paginated incoming USDT transfers exactly once', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(/^premium_wallet_poll_test_/.test(decodeURIComponent(url.pathname.slice(1))), 'database name must use the dedicated test prefix')
  assert.ok(/^premium_wallet_poll_test_/.test(decodeURIComponent(url.username)), 'database role must use the dedicated test prefix')
  assert.equal(url.hostname, 'premium-poll-pg', 'integration must use the dedicated isolated test network')

  const schema = 'premium_poll_' + randomUUID().replaceAll('-', '')
  const pool = new Pool({ connectionString, max: 1 })
  const firstHash = hash('a'), secondHash = hash('b')
  const requests: URL[] = []
  let page = 0
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}"`)
    await pool.query(`
      CREATE TABLE t_premium_platform(
        rid serial PRIMARY KEY, receive_wallet varchar(100) NOT NULL,
        get_tx_time timestamp, status smallint NOT NULL
      );
      CREATE TABLE t_sys_config(
        rid serial PRIMARY KEY, config_key varchar(100) NOT NULL, config_val text
      );
      CREATE TABLE t_premium_wallet_trade_list(
        rid serial PRIMARY KEY, tx_hash varchar(100) NOT NULL UNIQUE,
        transferfrom_address varchar(200) NOT NULL, transferto_address varchar(200) NOT NULL,
        coin_name varchar(20) NOT NULL, amount varchar(100) NOT NULL, "timestamp" varchar(20) NOT NULL,
        process_status smallint NOT NULL, process_time timestamp, process_comments varchar(2000),
        get_time timestamp
      );
    `)
    await pool.query("INSERT INTO t_premium_platform(receive_wallet,get_tx_time,status) VALUES($1,'2026-10-01 08:00:00',0)", [wallet])
    await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('trongrid_api_keys',$1)", [JSON.stringify({ keys: 'integration-grid-key' })])

    const request = async (input: string | URL, init?: RequestInit) => {
      const current = new URL(String(input))
      requests.push(current)
      assert.equal(current.hostname, 'api.trongrid.io')
      assert.equal(current.pathname, `/v1/accounts/${wallet}/transactions/trc20`)
      assert.equal(current.searchParams.get('contract_address'), contract)
      assert.equal(current.searchParams.get('only_to'), 'true')
      assert.equal(new Headers(init?.headers).get('TRON-PRO-API-KEY'), 'integration-grid-key')
      assert.equal(init?.redirect, 'error')
      assert.ok(init?.signal)

      if (page++ % 2 === 0) {
        assert.equal(current.searchParams.get('min_timestamp'), premiumWalletStartTimestamp('0', '2026-10-01 08:00:00'))
        return Response.json({
          data: [
            { transaction_id: firstHash.toUpperCase(), type: 'Transfer', from: sender, to: wallet, value: '120123456', block_timestamp: 1770000000100 },
            { transaction_id: hash('c'), type: 'Approve', from: sender, to: wallet, value: '7', block_timestamp: 1770000000100 },
            { transaction_id: hash('d'), type: 'Transfer', from: sender, to: 'T' + 'C'.repeat(33), value: '5000000', block_timestamp: 1770000000100 },
          ],
          meta: { links: { next: `${pageUrl}?limit=50&only_to=true&contract_address=${contract}&fingerprint=next` } },
        })
      }

      assert.equal(current.searchParams.get('fingerprint'), 'next')
      return Response.json({
        data: [
          { transaction_id: secondHash, type: 'Transfer', from: sender, to: wallet, value: '5000000', block_timestamp: 1770000000200 },
          { transaction_id: firstHash, type: 'Transfer', from: sender, to: wallet, value: '120123456', block_timestamp: 1770000000100 },
        ],
      })
    }

    const options = { pool, request, enabled: true, now: () => new Date('2026-10-30T00:00:00Z'), logger: { error(message: string) { throw new Error(message) } } }
    assert.deepEqual(await syncPremiumWalletUsdtTrades(options), { wallets: 1, inserted: 2, skipped: false })
    assert.deepEqual(await syncPremiumWalletUsdtTrades(options), { wallets: 1, inserted: 0, skipped: false })
    assert.equal(requests.length, 4)

    const rows = await pool.query('SELECT tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,process_comments FROM t_premium_wallet_trade_list ORDER BY tx_hash')
    assert.deepEqual(rows.rows, [
      { tx_hash: firstHash, transferfrom_address: sender, transferto_address: wallet, coin_name: 'usdt', amount: '120.123456', timestamp: '1770000000100', process_status: 1, process_comments: '待开通' },
      { tx_hash: secondHash, transferfrom_address: sender, transferto_address: wallet, coin_name: 'usdt', amount: '5', timestamp: '1770000000200', process_status: 1, process_comments: '待开通' },
    ])
  } finally {
    await pool.end()
    const cleanup = new Pool({ connectionString, max: 1 })
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) } catch {} finally { await cleanup.end() }
  }
})
