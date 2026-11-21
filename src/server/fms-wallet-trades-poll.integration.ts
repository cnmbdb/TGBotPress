import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { syncFmsWalletTrades } from './fms-wallet-trades-poll.server'

const connectionString = process.env.TG_FMS_WALLET_POLL_TEST_DB_URL
const bytesFromHex = (body: string) => Buffer.from(body, 'hex')
function tronAddress(hex: string) {
  const body = bytesFromHex(hex)
  const checksum = createHash('sha256').update(createHash('sha256').update(body).digest()).digest().subarray(0, 4)
  const bytes = Buffer.concat([body, checksum])
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = BigInt('0x' + bytes.toString('hex')), result = ''
  while (n > 0n) { result = alphabet[Number(n % 58n)] + result; n /= 58n }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result }
  return result
}
const walletHex = '41' + '00'.repeat(20)
const senderHex = '41' + '11'.repeat(20)
const wallet = tronAddress(walletHex)
const sender = tronAddress(senderHex)
const hash = (char: string) => char.repeat(64)
const contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const now = new Date('2026-10-30T00:00:00Z')

test('FMS wallet polling persists confirmed TRX, TronScan TRX and paginated USDT exactly once', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(/^fms_wallet_poll_test_/.test(decodeURIComponent(url.pathname.slice(1))), 'database name must use the dedicated test prefix')
  assert.ok(/^fms_wallet_poll_test_/.test(decodeURIComponent(url.username)), 'database role must use the dedicated test prefix')
  assert.equal(url.hostname, 'fms-poll-pg', 'integration must use the dedicated isolated test network')
  assert.equal(wallet.length, 34)

  const schema = 'fms_poll_' + randomUUID().replaceAll('-', '')
  const pool = new Pool({ connectionString, max: 1 })
  const requests: URL[] = []
  const errors: string[] = []
  let usdtPage = 0
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}"`)
    await pool.query(`
      CREATE TABLE t_telegram_bot(
        rid serial PRIMARY KEY, recharge_wallet_addr varchar(100), get_tx_time timestamp
      );
      CREATE TABLE t_sys_config(
        rid serial PRIMARY KEY, config_key varchar(100) NOT NULL, config_val text
      );
      CREATE TABLE t_fms_wallet_trade_list(
        rid serial PRIMARY KEY, tx_hash varchar(100) NOT NULL UNIQUE,
        transferfrom_address varchar(200) NOT NULL, transferto_address varchar(200) NOT NULL,
        coin_name varchar(20) NOT NULL, amount varchar(100) NOT NULL, "timestamp" varchar(20) NOT NULL,
        process_status smallint NOT NULL, process_time timestamp, process_comments varchar(2000),
        get_time timestamp
      );
    `)
    await pool.query("INSERT INTO t_telegram_bot(recharge_wallet_addr,get_tx_time) VALUES($1,'2026-10-01 08:00:00')", [wallet])
    await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('trongrid_api_keys',$1),('tronscan_api_keys',$2)", [
      JSON.stringify({ keys: 'grid-fixture-key' }), JSON.stringify({ keys: 'scan-fixture-key' }),
    ])

    const request = async (input: string | URL, init?: RequestInit) => {
      const current = new URL(String(input))
      requests.push(current)
      assert.equal(init?.redirect, 'error')
      assert.ok(init?.signal)

      if (current.hostname === 'api.trongrid.io' && current.pathname.endsWith('/transactions/trc20')) {
        assert.equal(new Headers(init?.headers).get('TRON-PRO-API-KEY'), 'grid-fixture-key')
        assert.equal(current.searchParams.get('limit'), '50')
        assert.equal(current.searchParams.get('only_to'), 'true')
        assert.equal(current.searchParams.get('contract_address'), contract)
        if (usdtPage++ % 2 === 0) {
          return Response.json({
            data: [
              { transaction_id: hash('c'), type: 'Transfer', from: sender, to: wallet, value: '1234567', block_timestamp: 1793232000100 },
              { transaction_id: hash('e'), type: 'Approve', from: sender, to: wallet, value: '10', block_timestamp: 1793232000100 },
              { transaction_id: hash('f'), type: 'Transfer', from: sender, to: tronAddress('41' + '22'.repeat(20)), value: '10', block_timestamp: 1793232000100 },
            ],
            meta: { links: { next: `https://api.trongrid.io${current.pathname}?limit=50&only_to=true&min_timestamp=${current.searchParams.get('min_timestamp')}&contract_address=${contract}&fingerprint=next` } },
          })
        }
        assert.equal(current.searchParams.get('fingerprint'), 'next')
        return Response.json({ data: [
          { transaction_id: hash('d'), type: 'Transfer', from: sender, to: wallet, value: '500000', block_timestamp: 1793232000200 },
          { transaction_id: hash('c'), type: 'Transfer', from: sender, to: wallet, value: '1234567', block_timestamp: 1793232000100 },
        ] })
      }

      if (current.hostname === 'api.trongrid.io' && current.pathname.endsWith('/transactions')) {
        assert.equal(new Headers(init?.headers).get('TRON-PRO-API-KEY'), 'grid-fixture-key')
        assert.equal(current.searchParams.get('only_to'), 'true')
        assert.equal(current.searchParams.get('only_confirm'), 'true')
        assert.equal(current.searchParams.get('search_internal'), 'false')
        assert.equal(current.searchParams.get('limit'), '50')
        const timestamp = current.searchParams.get('min_timestamp')
        assert.ok(timestamp && /^\d+$/.test(timestamp))
        return Response.json({ data: [{
          txID: hash('a'),
          raw_data: { timestamp: 1793232000000, contract: [{
            type: 'TransferContract',
            parameter: { value: { owner_address: senderHex, to_address: walletHex, amount: '200000' } },
          }] },
        }] })
      }

      if (current.hostname === 'apilist.tronscanapi.com' && current.pathname === '/api/new/transfer') {
        assert.equal(new Headers(init?.headers).get('TRON-PRO-API-KEY'), 'scan-fixture-key')
        assert.equal(current.searchParams.get('address'), wallet)
        assert.equal(current.searchParams.get('toAddress'), wallet)
        assert.equal(current.searchParams.get('tokens'), '_')
        return Response.json({
          total: 1,
          data: [{
            transactionHash: hash('b'), transferFromAddress: sender, timestamp: 1793232000050,
            amount: '2000000', contractRet: 'SUCCESS', tokenInfo: { tokenId: '_', tokenAbbr: 'trx' },
          }],
        })
      }
      throw new Error('Unexpected provider URL: ' + current.hostname + current.pathname)
    }

    const options = { pool, request, enabled: true, now: () => now, logger: { error(message: string) { errors.push(message) } } }
    const firstRun = await syncFmsWalletTrades(options)
    assert.deepEqual(firstRun, { wallets: 1, inserted: 4, skipped: false }, JSON.stringify({ errors, requests: requests.map(url => url.href) }))
    assert.deepEqual(await syncFmsWalletTrades(options), { wallets: 1, inserted: 0, skipped: false })
    assert.equal(requests.length, 8)
    assert.deepEqual(errors, [])

    const rows = await pool.query('SELECT tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,process_comments FROM t_fms_wallet_trade_list ORDER BY coin_name,tx_hash')
    assert.deepEqual(rows.rows, [
      { tx_hash: hash('a'), transferfrom_address: sender, transferto_address: wallet, coin_name: 'trx', amount: '0.2', timestamp: '1793232000000', process_status: 1, process_comments: '待处理' },
      { tx_hash: hash('b'), transferfrom_address: sender, transferto_address: wallet, coin_name: 'trx', amount: '2', timestamp: '1793232000050', process_status: 1, process_comments: '待处理' },
      { tx_hash: hash('c'), transferfrom_address: sender, transferto_address: wallet, coin_name: 'usdt', amount: '1.234567', timestamp: '1793232000100', process_status: 1, process_comments: '待处理' },
      { tx_hash: hash('d'), transferfrom_address: sender, transferto_address: wallet, coin_name: 'usdt', amount: '0.5', timestamp: '1793232000200', process_status: 1, process_comments: '待处理' },
    ])
  } finally {
    await pool.end()
    const cleanup = new Pool({ connectionString, max: 1 })
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) } catch {} finally { await cleanup.end() }
  }
})
