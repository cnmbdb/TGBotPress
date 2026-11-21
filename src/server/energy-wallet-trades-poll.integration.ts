import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { syncEnergyWalletTrades } from './energy-wallet-trades-poll.server'

const connectionString = process.env.TG_ENERGY_WALLET_POLL_TEST_DB_URL
test('energy wallet polling writes idempotent records to an isolated PostgreSQL schema', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!)
  assert.ok(/^energy_wallet_poll_test_/.test(decodeURIComponent(url.pathname.slice(1))), 'database name must use the dedicated test prefix')
  assert.ok(/^energy_wallet_poll_test_/.test(decodeURIComponent(url.username)), 'database role must use the dedicated test prefix')
  const dockerBridgeIp = /^172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
  assert.ok(url.hostname === 'energy-poll-pg' || (process.env.TG_ENERGY_WALLET_POLL_TEST_ALLOW_PRIVATE_DB === '1' && dockerBridgeIp),
    'integration may only connect to energy-poll-pg or its explicitly allowed private Docker bridge IP')
  const schema = 'energy_poll_' + randomUUID().replaceAll('-', '')
  const pool = new Pool({ connectionString, max: 1 })
  const wallet = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
  const txHash = 'e'.repeat(64), usdtHash = 'f'.repeat(64)
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}"`)
    await pool.query('CREATE TABLE t_energy_platform_bot(rid serial PRIMARY KEY,receive_wallet varchar(100) NOT NULL,status smallint NOT NULL,get_tx_time timestamp)')
    await pool.query('CREATE TABLE t_sys_config(rid serial PRIMARY KEY,config_key varchar(100) NOT NULL,config_val text)')
    await pool.query("CREATE TABLE t_energy_wallet_trade_list(rid serial PRIMARY KEY,tx_hash varchar(100) NOT NULL UNIQUE,transferfrom_address varchar(200) NOT NULL,transferto_address varchar(200) NOT NULL,coin_name varchar(20) NOT NULL,amount varchar(100) NOT NULL,\"timestamp\" varchar(20) NOT NULL,process_status smallint DEFAULT 0 NOT NULL,process_time timestamp,process_comments varchar(2000),get_time timestamp,energy_platform_rid int,energy_platform_bot_rid int,platform_order_rid int,energy_package_rid int,tg_notice_status_receive char(1) DEFAULT 'N' NOT NULL,tg_notice_status_send char(1) DEFAULT 'N' NOT NULL)")
    await pool.query('INSERT INTO t_energy_platform_bot(receive_wallet,status,get_tx_time) VALUES($1,0,NULL)', [wallet])
    await pool.query('INSERT INTO t_sys_config(config_key,config_val) VALUES($1,$2),($3,$4)', [
      'trongrid_api_keys', JSON.stringify({ keys: 'test-grid-key' }),
      'tronscan_api_keys', JSON.stringify({ keys: 'test-scan-key' }),
    ])
    const request = async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.hostname === 'apilist.tronscanapi.com') return new Response(JSON.stringify({
        total: 1, data: [{
          transactionHash: txHash, transferFromAddress: wallet, timestamp: 1_798_000_000_000,
          amount: '2500000', contractRet: 'SUCCESS', tokenInfo: { tokenId: '_', tokenAbbr: 'trx' },
        }],
      }))
      if (url.pathname.endsWith('/transactions/trc20')) return new Response(JSON.stringify({
        data: [{
          transaction_id: usdtHash, from: wallet, to: wallet, value: '1234567',
          block_timestamp: 1_798_000_000_010, type: 'Transfer',
        }],
      }))
      if (url.pathname.endsWith('/transactions')) return new Response(JSON.stringify({
        data: [{
          txID: txHash, raw_data: { timestamp: 1_798_000_000_001, contract: [{
            type: 'TransferContract', parameter: { value: {
              owner_address: '41' + '00'.repeat(20), to_address: '41' + '00'.repeat(20), amount: '150000',
            } },
          }] },
        }],
      }))
      throw new Error('Unexpected provider URL')
    }
    const options = { pool, request, enabled: true, now: () => new Date(1_798_000_000_100) }
    assert.deepEqual(await syncEnergyWalletTrades(options), { wallets: 1, inserted: 2, skipped: false })
    assert.deepEqual(await syncEnergyWalletTrades(options), { wallets: 1, inserted: 0, skipped: false })
    const rows = await pool.query('SELECT tx_hash,coin_name,amount,process_status,process_comments FROM t_energy_wallet_trade_list ORDER BY coin_name')
    assert.deepEqual(rows.rows, [
      { tx_hash: txHash, coin_name: 'trx', amount: '2.5', process_status: 1, process_comments: '待处理' },
      { tx_hash: usdtHash, coin_name: 'usdt', amount: '1.234567', process_status: 1, process_comments: '待处理' },
    ])
  } finally {
    await pool.end()
    const cleanup = new Pool({ connectionString, max: 1 })
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) } catch {} finally { await cleanup.end() }
  }
})

