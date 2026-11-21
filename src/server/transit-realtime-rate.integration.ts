import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { refreshRealtimeTrxRates } from './transit-realtime-rate.server'

const connectionString = process.env.TG_TEST_DB_URL
if (!connectionString || new URL(connectionString).hostname !== 'tg-native-test-pg') throw new Error('Integration tests require disposable tg-native-test-pg')
const schema = 'realtime_rate_' + randomUUID().replaceAll('-', '')
const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema, max: 3 })
await pool.query('CREATE SCHEMA ' + schema)
await pool.query('CREATE TABLE t_transit_wallet_coin(rid int PRIMARY KEY,in_coin_name text NOT NULL,out_coin_name text NOT NULL,is_realtime_rate smallint NOT NULL,profit_rate numeric(12,2) NOT NULL,exchange_rate numeric(12,2) NOT NULL)')
await pool.query("INSERT INTO t_transit_wallet_coin(rid,in_coin_name,out_coin_name,is_realtime_rate,profit_rate,exchange_rate) VALUES(1,'usdt','trx',1,0.10,1.00),(2,'usdt','trx',3,0.15,1.00),(3,'usdt','trx',2,0.00,2.50),(4,'trx','usdt',1,0.10,9.00),(5,'usdt','trx',1,2.00,1.00)")

try {
  await test('refresh updates only matching realtime pairs with legacy rounding and minimum rate', async () => {
    const request = async () => new Response(JSON.stringify({ code: '0', data: [{ idxPx: '0.80' }] }), { status: 200 })
    const result = await refreshRealtimeTrxRates(pool, request, { warn() {} })
    assert.deepEqual(result, { updated: 3, reason: null })
    const rows = await pool.query('SELECT rid,exchange_rate::text AS exchange_rate FROM t_transit_wallet_coin ORDER BY rid')
    assert.deepEqual(rows.rows.map(row => [Number(row.rid), row.exchange_rate]), [
      [1, '1.15'], [2, '1.06'], [3, '2.50'], [4, '9.00'], [5, '1.00'],
    ])
  })

  await test('bad market data leaves stored exchange rates unchanged', async () => {
    const before = await pool.query('SELECT rid,exchange_rate::text AS exchange_rate FROM t_transit_wallet_coin ORDER BY rid')
    const request = async () => new Response(JSON.stringify({ code: '51000', data: [] }), { status: 200 })
    const result = await refreshRealtimeTrxRates(pool, request, { warn() {} })
    assert.deepEqual(result, { updated: 0, reason: 'market_unavailable' })
    const after = await pool.query('SELECT rid,exchange_rate::text AS exchange_rate FROM t_transit_wallet_coin ORDER BY rid')
    assert.deepEqual(after.rows, before.rows)
  })
} finally {
  await pool.query('DROP SCHEMA ' + schema + ' CASCADE')
  await pool.end()
}
