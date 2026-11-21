import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'
import { decodeTronAddress, syncMonitorWalletCurrentBlock, syncMonitorWalletMissedBlock } from './monitor-wallet-block.server'

const connectionString = process.env.TG_MONITOR_WALLET_BLOCK_TEST_DB_URL

test('monitor wallet worker persists current block notices, queues gaps and drains missed blocks in isolated PostgreSQL', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^monitor_wallet_block_test_/)
  assert.match(decodeURIComponent(url.username), /^monitor_wallet_block_test_/)
  assert.equal(url.hostname, 'postgres')
  const schema = 'monitor_wallet_' + randomUUID().replaceAll('-', '')
  const pool = new pg.Pool({ connectionString, options: '-c search_path=' + schema, max: 2 })
  const admin = new pg.Pool({ connectionString, max: 2 })
  const walletHex = '41' + '00'.repeat(20)
  const walletAddress = decodeTronAddress(walletHex)!
  const tx = 'ab'.repeat(32)
  const block = (number: number, letter: string, transactions: unknown[] = []) => ({
    blockID: letter.repeat(64), block_header: { raw_data: { number, timestamp: 1_798_000_000_000 + number } }, transactions,
  })
  const transfer = { txID: tx, ret: [{ contractRet: "SUCCESS" }], raw_data: { contract: [{ type: "TransferContract", parameter: { value: { owner_address: walletHex, to_address: "41" + "11".repeat(20), amount: "1500000" } } }] } }
  try {
    await admin.query('CREATE SCHEMA ' + schema)
    await pool.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key text,config_val text)')
    await pool.query('CREATE TABLE t_telegram_bot(rid bigint PRIMARY KEY,bot_token text)')
    await pool.query("CREATE TABLE t_monitor_wallet(rid bigint PRIMARY KEY,bot_rid bigint,monitor_wallet text,status int,chain_type text,tg_notice_obj text,comments text,monitor_trx_transaction text,monitor_approve_transaction text,monitor_multi_transaction text,monitor_pledge_transaction text,monitor_usdt_transaction text)")
    const migration = await readFile(new URL('../../migrations/008-platform-monitor-wallet-block.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    await pool.query("INSERT INTO t_telegram_bot VALUES(1,'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_fixture')")
    await pool.query("INSERT INTO t_monitor_wallet VALUES(1,1,$1,0,'trc','10001','fixture','YY','NN','NN','NN','NN')", [walletAddress])
    const requests: string[] = []
    const fetcher = async (input: string | URL) => {
      const target = String(input); requests.push(target)
      if (target.endsWith('/wallet/getnowblock')) return Response.json(block(100, 'a', [transfer]))
      if (target.endsWith('/wallet/getblockbynum')) return Response.json(block(101, 'b'))
      if (target.startsWith('https://apilist.tronscanapi.com/api/accountv2')) return Response.json({ withPriceTokens: [{ tokenId: '_', amount: 2 }, { tokenId: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', amount: 3 }] })
      throw new Error('unexpected provider request')
    }
    const first = await syncMonitorWalletCurrentBlock({ pool, request: fetcher, enabled: true, now: () => new Date('2026-10-30T00:00:00Z') })
    assert.deepEqual(first, { block: 100, queued: 1, missedQueued: 0, skipped: false })
    const duplicate = await syncMonitorWalletCurrentBlock({ pool, request: async () => Response.json(block(100, 'a')), enabled: true })
    assert.deepEqual(duplicate, { block: 100, queued: 0, skipped: true })
    const notifications = await pool.query('SELECT tx_hash,notification_type,chat_id,payload FROM t_platform_monitor_wallet_notification')
    assert.equal(notifications.rowCount, 1)
    assert.equal(notifications.rows[0].chat_id, '10001')
    assert.match(notifications.rows[0].payload, /-1\.5 TRX/)
    const gap = await syncMonitorWalletCurrentBlock({ pool, request: async input => {
      if (String(input).endsWith('/wallet/getnowblock')) return Response.json(block(102, 'c'))
      throw new Error('gap block should not be fetched during discovery')
    }, enabled: true })
    assert.deepEqual(gap, { block: 102, queued: 0, missedQueued: 1, skipped: false })
    const recovered = await syncMonitorWalletMissedBlock({ pool, request: fetcher, enabled: true })
    assert.deepEqual(recovered, { block: 101, queued: 0, skipped: false })
    assert.equal(Number((await pool.query('SELECT count(*)::int n FROM t_platform_monitor_wallet_missed_block')).rows[0].n), 0)
    assert.ok(requests.some(value => value.endsWith('/wallet/getblockbynum')))
  } finally {
    await pool.end()
    await admin.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE')
    await admin.end()
  }
})
