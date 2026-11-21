import { test } from 'node:test'
import assert from 'node:assert/strict'
import { energyWalletStartTimestamp, syncEnergyWalletTrades } from './energy-wallet-trades-poll.server'

const wallet = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'
const walletHex = '41' + '00'.repeat(20)
const hash = (digit: string) => digit.repeat(64)
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

test('energy wallet poll is disabled by default without touching database or providers', async () => {
  let queried = false, requested = false
  const result = await syncEnergyWalletTrades({
    pool: { query: async () => { queried = true; return { rows: [], rowCount: 0 } } } as never,
    request: async () => { requested = true; return response({}) },
  })
  assert.deepEqual(result, { wallets: 0, inserted: 0, skipped: true })
  assert.equal(queried, false)
  assert.equal(requested, false)
})

test('energy wallet start keeps the later per-coin trade timestamp and wallet activation minus ten ms', () => {
  assert.equal(energyWalletStartTimestamp('1800000000000', '2026-10-29 08:00:00'), '1800000000000')
  assert.equal(energyWalletStartTimestamp('0', '2026-10-29 08:00:00'), String(Date.parse('2026-10-29T08:00:00+08:00') - 10))
})

test('energy wallet polls all three legacy feeds and inserts exact, idempotent TRX and USDT trades', async () => {
  const rows: Array<{ hash: string; coin: string; amount: string; from: string; to: string }> = []
  const queries: string[] = [], urls: URL[] = []
  const stored = new Set<string>()
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      queries.push(sql)
      if (sql.includes('FROM t_energy_platform_bot w')) return { rows: [{
        rid: 7, receive_wallet: wallet, get_tx_time: null,
        latest_trx_timestamp: '0', latest_usdt_timestamp: '0',
      }], rowCount: 1 }
      if (sql.includes('FROM t_sys_config')) {
        return { rows: [{ config_val: JSON.stringify({ keys: values[0] === 'trongrid_api_keys' ? 'grid-key' : 'scan-key' }) }], rowCount: 1 }
      }
      if (sql.startsWith('INSERT INTO t_energy_wallet_trade_list')) {
        const [txHash, from, to, coin, amount] = values as string[]
        if (stored.has(txHash)) return { rows: [], rowCount: 0 }
        stored.add(txHash); rows.push({ hash: txHash, from, to, coin, amount }); return { rows: [], rowCount: 1 }
      }
      throw new Error('unexpected SQL: ' + sql)
    },
  }
  const request = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input)); urls.push(url)
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.signal)
    if (url.hostname === 'apilist.tronscanapi.com') {
      assert.equal(url.pathname, '/api/new/transfer')
      assert.equal(url.searchParams.get('toAddress'), wallet)
      assert.equal(url.searchParams.get('tokens'), '_')
      return response({ total: 1, data: [{
        transactionHash: hash('a'), transferFromAddress: wallet, timestamp: 1_798_000_000_000,
        amount: '2500000', contractRet: 'SUCCESS', tokenInfo: { tokenId: '_', tokenAbbr: 'trx' },
      }] })
    }
    if (url.pathname.endsWith('/transactions/trc20')) {
      assert.equal(url.searchParams.get('contract_address'), 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
      if (url.searchParams.has('fingerprint')) return response({ data: [{
        transaction_id: hash('d'), from: wallet, to: wallet, value: '1234567',
        block_timestamp: 1_798_000_000_003, type: 'Transfer',
      }] })
      return response({ data: [{
        transaction_id: hash('c'), from: wallet, to: wallet, value: '2000000',
        block_timestamp: 1_798_000_000_002, type: 'Transfer',
      }], meta: { links: { next: url.origin + url.pathname + '?' + url.searchParams.toString() + '&fingerprint=next' } } })
    }
    assert.equal(url.pathname.endsWith('/transactions'), true)
    assert.equal(url.searchParams.get('only_confirmed'), 'true')
    return response({ data: [{
      txID: hash('a'), raw_data: { timestamp: 1_798_000_000_001, contract: [{
        type: 'TransferContract', parameter: { value: { owner_address: walletHex, to_address: walletHex, amount: '150000' } },
      }] },
    }, {
      txID: hash('b'), raw_data: { timestamp: 1_798_000_000_001, contract: [{
        type: 'TransferContract', parameter: { value: { owner_address: walletHex, to_address: walletHex, amount: '150000' } },
      }] },
    }] })
  }
  const result = await syncEnergyWalletTrades({
    pool: pool as never, request, enabled: true, now: () => new Date(1_798_000_000_100),
  })
  assert.deepEqual(result, { wallets: 1, inserted: 4, skipped: false })
  assert.equal(urls.length, 4)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map(row => [row.coin, row.amount]).sort(), [['trx', '0.15'], ['trx', '2.5'], ['usdt', '1.234567'], ['usdt', '2']])
  assert.ok(rows.every(row => row.to === wallet))
  assert.equal(rows.find(row => row.hash === hash('a'))?.coin, 'trx')
  assert.ok(queries.some(sql => sql.includes("ON CONFLICT (tx_hash) DO NOTHING")))
})

test('energy wallet TRX poll rejects an untrusted TronGrid pagination host without requesting it', async () => {
  const calls: string[] = []
  const testWallet = wallet
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      if (sql.includes('FROM t_energy_platform_bot w')) return { rows: [{
        rid: 8, receive_wallet: testWallet, get_tx_time: null, latest_trx_timestamp: '0', latest_usdt_timestamp: '0',
      }], rowCount: 1 }
      if (sql.includes('FROM t_sys_config')) return { rows: [{ config_val: JSON.stringify({ keys: values[0] === 'trongrid_api_keys' ? 'key' : '' }) }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  }
  const request = async (input: string | URL) => {
    const url = new URL(String(input)); calls.push(url.hostname + url.pathname)
    if (url.pathname.endsWith('/transactions')) return response({ data: [], meta: { links: { next: 'https://evil.example/v1/accounts/' + testWallet + '/transactions?only_to=true&only_confirm=true&search_internal=false' } } })
    return response({ data: [] })
  }
  const errors: string[] = []
  await syncEnergyWalletTrades({ pool: pool as never, request, enabled: true, logger: { error: message => errors.push(message) } })
  assert.equal(calls.includes('evil.example/v1/accounts/' + wallet + '/transactions'), false)
  assert.ok(errors.some(message => message.includes('invalid TronGrid pagination URL')))
})

