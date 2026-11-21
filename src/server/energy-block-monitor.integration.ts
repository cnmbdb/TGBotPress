import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { syncEnergyCurrentBlock, syncEnergyMissedBlock } from './energy-block-monitor.server'

const connectionString = process.env.TG_ENERGY_BLOCK_TEST_DB_URL
const wallet = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const zeroHex = '41' + '00'.repeat(20)
const blockId = (n: string) => n.repeat(64)
function trx(txID: string, timestamp: number) {
  return { txID, ret: [{ contractRet: 'SUCCESS' }], raw_data: {
    contract: [{ type: 'TransferContract', parameter: { value: {
      owner_address: zeroHex, to_address: zeroHex, amount: '1000000',
    } } }],
  } }
}
function usdt(txID: string) {
  const amount = BigInt(2_500_000).toString(16).padStart(64, '0')
  return { txID, ret: [{ contractRet: 'SUCCESS' }], raw_data: {
    contract: [{ type: 'TriggerSmartContract', parameter: { value: {
      owner_address: zeroHex, contract_address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
      data: 'a9059cbb' + '0'.repeat(64) + amount,
    } } }],
  } }
}
function block(number: number, letter: string, transactions?: unknown[]) {
  return {
    blockID: blockId(letter), block_header: { raw_data: { number, timestamp: 1_798_000_000_000 + number } },
    ...(transactions === undefined ? {} : { transactions }),
  }
}

test('energy block monitor imports transfers, queues gaps and retries missed heights in isolated PostgreSQL', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(/^energy_block_monitor_test_/.test(decodeURIComponent(url.pathname.slice(1))))
  assert.ok(/^energy_block_monitor_test_/.test(decodeURIComponent(url.username)))
  const privateBridgeIp = /^172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
  assert.ok(url.hostname === 'energy-block-pg' || (process.env.TG_ENERGY_BLOCK_TEST_ALLOW_PRIVATE_DB === '1' && privateBridgeIp))
  const schema = 'energy_block_' + randomUUID().replaceAll('-', '')
  const pool = new Pool({ connectionString, max: 1 })
  let head = block(100, 'a', [trx('a'.repeat(64), 100), usdt('b'.repeat(64))])
  const fetches: string[] = []
  const request = async (input: string | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    fetches.push(path)
    const body = init?.body ? JSON.parse(String(init.body)) as { num?: number } : {}
    if (path === '/wallet/getnowblock') return new Response(JSON.stringify(head))
    if (path === '/wallet/getblockbynum' && body.num === 101) return new Response(JSON.stringify(block(101, 'c', [trx('c'.repeat(64), 101)])))
    if (path === '/wallet/getblockbynum' && body.num === 102) return new Response(JSON.stringify(block(102, 'd')))
    throw new Error('Unexpected TronGrid URL: ' + path)
  }
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}"`)
    await pool.query('CREATE TABLE t_energy_platform_bot(rid serial PRIMARY KEY,bot_rid int NOT NULL,status smallint NOT NULL,receive_wallet varchar(100),is_open_bishu char(1) NOT NULL DEFAULT \'Y\')')
    await pool.query('CREATE TABLE t_telegram_bot(rid serial PRIMARY KEY)')
    await pool.query("CREATE TABLE t_energy_ai_bishu(rid serial PRIMARY KEY,bot_rid int NOT NULL,wallet_addr varchar(100) NOT NULL,status smallint NOT NULL,max_buy_quantity int NOT NULL,total_buy_quantity int NOT NULL,is_buy char(1) NOT NULL DEFAULT 'N')")
    await pool.query('CREATE TABLE t_sys_config(rid serial PRIMARY KEY,config_key varchar(100),config_val text)')
    await pool.query("CREATE TABLE t_energy_wallet_trade_list(rid serial PRIMARY KEY,tx_hash varchar(100) UNIQUE NOT NULL,transferfrom_address varchar(200) NOT NULL,transferto_address varchar(200) NOT NULL,coin_name varchar(20) NOT NULL,amount varchar(100) NOT NULL,\"timestamp\" varchar(20) NOT NULL,process_status smallint NOT NULL,process_time timestamp,process_comments varchar(2000),get_time timestamp)")
    const migration = await readFile(new URL('../../migrations/007-platform-energy-block-monitor.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    await pool.query('INSERT INTO t_energy_platform_bot(bot_rid,status,receive_wallet) VALUES(1,0,$1)', [wallet])
    await pool.query('INSERT INTO t_telegram_bot(rid) VALUES(1)')
    await pool.query("INSERT INTO t_energy_ai_bishu(bot_rid,wallet_addr,status,max_buy_quantity,total_buy_quantity,is_buy) VALUES(1,$1,0,10,0,'N')", [wallet])
    await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES($1,$2)", ['trongrid_api_keys', JSON.stringify({ keys: 'test-key' })])

    const options = { pool, request, enabled: true, allowPurchaseTrigger: true, now: () => new Date(1_798_000_100_000) }
    assert.deepEqual(await syncEnergyCurrentBlock(options), {
      block: 100, inserted: 2, markedForPurchase: 1, missedQueued: 0, skipped: false,
    })
    assert.equal((await syncEnergyCurrentBlock(options)).skipped, true)

    head = block(103, 'e')
    assert.deepEqual(await syncEnergyCurrentBlock(options), {
      block: 103, inserted: 0, markedForPurchase: 0, missedQueued: 2, skipped: false,
    })
    assert.equal((await syncEnergyMissedBlock(options)).block, 101)
    assert.equal((await syncEnergyMissedBlock(options)).block, 102)
    assert.equal((await syncEnergyMissedBlock(options)).skipped, true)

    const trades = await pool.query('SELECT tx_hash,coin_name,amount,process_status,process_comments FROM t_energy_wallet_trade_list ORDER BY tx_hash')
    assert.deepEqual(trades.rows, [
      { tx_hash: 'a'.repeat(64), coin_name: 'trx', amount: '1', process_status: 1, process_comments: '待处理' },
      { tx_hash: 'b'.repeat(64), coin_name: 'usdt', amount: '2.5', process_status: 1, process_comments: '待处理' },
      { tx_hash: 'c'.repeat(64), coin_name: 'trx', amount: '1', process_status: 1, process_comments: '待处理' },
    ])
    assert.equal((await pool.query('SELECT is_buy FROM t_energy_ai_bishu')).rows[0].is_buy, 'Y')
    assert.equal(Number((await pool.query("SELECT latest_block FROM t_platform_energy_block_cursor WHERE cursor_key='energy-wallet'")).rows[0].latest_block), 103)
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM t_platform_energy_missed_block')).rows[0].total, 0)
    assert.deepEqual(fetches, ['/wallet/getnowblock', '/wallet/getnowblock', '/wallet/getnowblock', '/wallet/getblockbynum', '/wallet/getblockbynum'])
  } finally {
    await pool.end()
    const cleanup = new Pool({ connectionString, max: 1 })
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) } catch {} finally { await cleanup.end() }
  }
})

