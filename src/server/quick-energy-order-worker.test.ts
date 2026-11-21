import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { test } from 'node:test'
import { placeOrder } from './ai-energy-order-worker.server'
import { syncQuickEnergyOrders } from './quick-energy-order-worker.server'

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const ciphertext = publicEncrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from('supplier-secret')).toString('base64')
const platform = (name: number, comments: string | null = null) => ({ rid: 4, platform_name: name, platform_uid: 'supplier-user', platform_apikey: ciphertext, permission_id: 0, platform_balance: '100', seq_sn: 1, comments })
const row = { energy_amount: 65000, energy_day: 0, wallet_addr: 'Trecipient' }

function env(keys: string[]) { return Object.fromEntries(keys.map(key => [key, process.env[key]])) }
function restore(values: Record<string, string | undefined>) { for (const [key, value] of Object.entries(values)) value == null ? delete process.env[key] : process.env[key] = value }

 test('supplier adapters preserve the legacy developer, Sohu and NL-API request and response contracts', async () => {
  const keys = ['TRON_RSA_PRIVATE_KEY', 'THIRD_URL', 'NL_API_BASE_URL', 'APP_ENV']
  const before = env(keys)
  Object.assign(process.env, { TRON_RSA_PRIVATE_KEY: privatePem, THIRD_URL: 'https://developer.example', NL_API_BASE_URL: 'https://nl.example', APP_ENV: 'production' })
  const requests: { url: string; body: Record<string, unknown> }[] = []
  const responses = [
    { code: 200, data: { orderId: 'dev-1', orderMoney: 0.2 } },
    { code: 1, data: { order_sn: 'sohu-1', amount: 0.3 } },
    { success: true, tx_hash: 'nl-1', cost_trx: 0.4 },
  ]
  try {
    for (const [index, name] of [5, 6, 7].entries()) {
      const result = await placeOrder(async (input, init) => {
        requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
        return Response.json(responses[index])
      }, row, platform(name), () => 1_800_000_000_000)
      assert.equal(result.kind, 'success')
    }
    assert.equal(requests[0].url, 'https://developer.example/api/thirdpart/shanzuorder')
    assert.deepEqual(requests[0].body, { tg_uid: 'supplier-user', payNums: 65000, rentTime: 1, receiveAddress: 'Trecipient' })
    assert.equal(requests[1].url, 'https://admin.weidubot.cc/api/trc_api/frozen_energy')
    assert.deepEqual(requests[1].body, { token: 'supplier-secret', type: 'energy', count: 65000, period: '1h', trx_amount: 0, address: 'Trecipient' })
    assert.equal(requests[2].url, 'https://nl.example/v1/delegate_tran')
    assert.deepEqual(requests[2].body, { username: 'supplier-user', password: 'supplier-secret', energy: 65000, day: 0, receiver_address: 'Trecipient' })
  } finally { restore(before) }
})

test('quick energy order is gated, claims one row, persists supplier order and notice atomically', async () => {
  const before = env(['TRON_RSA_PRIVATE_KEY'])
  process.env.TRON_RSA_PRIVATE_KEY = privatePem
  const statements: string[] = []
  let claimed = false
  const order: Record<string, unknown> = { rid: 30, bot_rid: 7, tg_uid: '100', wallet_addr: 'Trecipient', energy_amount: 65000, energy_day: 1, package_rid: 8, energy_platform_bot_rid: 42, poll_group: 'A', bot_status: 0, agent_tg_uid: null, agent_per_price: null }
  const client = { query: async (sql: string) => {
    statements.push(sql)
    if (sql.startsWith('SELECT a.rid')) { if (claimed) return { rows: [], rowCount: 0 }; claimed = true; return { rows: [order], rowCount: 1 } }
    if (sql.startsWith('SELECT rid FROM t_energy_quick_order')) return { rows: [{ rid: 30 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }, release() {} }
  const pool = { query: async (sql: string) => { statements.push(sql); if (sql.startsWith('SELECT rid,platform_name')) return { rows: [platform(1)], rowCount: 1 }; return { rows: [], rowCount: 1 } }, connect: async () => client }
  try {
    const result = await syncQuickEnergyOrders({ enabled: true, batchSize: 1, pool: pool as never, logger: { error() {} }, fetcher: async () => Response.json({ status: 200, data: { order_no: 'neee-1' } }) })
    assert.deepEqual(result, { skipped: false, scanned: 1, succeeded: 1, failed: 0, manual: 0 })
    assert.ok(statements.some(sql => sql.includes('FOR UPDATE OF a SKIP LOCKED')))
    assert.ok(statements.some(sql => sql.startsWith('INSERT INTO t_energy_platform_order')))
    assert.ok(statements.some(sql => sql.includes("status=9,comments=$2,is_notice='Y'")))
    const disabled = await syncQuickEnergyOrders({ enabled: false, pool: { query: async () => { throw new Error('disabled query') }, connect: async () => { throw new Error('disabled connection') } } as never })
    assert.deepEqual(disabled, { skipped: true, scanned: 0, succeeded: 0, failed: 0, manual: 0 })
  } finally { restore(before) }
})

test('ambiguous supplier responses stay in manual review state and are never retried automatically', async () => {
  const before = env(['TRON_RSA_PRIVATE_KEY'])
  process.env.TRON_RSA_PRIVATE_KEY = privatePem
  const updates: string[] = []
  let claimed = false
  const order = { rid: 31, bot_rid: 7, tg_uid: '100', wallet_addr: 'Trecipient', energy_amount: 65000, energy_day: 1, package_rid: 8, energy_platform_bot_rid: 42, poll_group: 'A', bot_status: 0, agent_tg_uid: null, agent_per_price: null }
  const client = { query: async (sql: string) => { if (sql.startsWith('SELECT a.rid')) { if (claimed) return { rows: [], rowCount: 0 }; claimed = true; return { rows: [order], rowCount: 1 } } return { rows: [], rowCount: 1 } }, release() {} }
  const pool = { connect: async () => client, query: async (sql: string) => { updates.push(sql); if (sql.startsWith('SELECT rid,platform_name')) return { rows: [platform(1)], rowCount: 1 }; return { rows: [], rowCount: 1 } } }
  try {
    const result = await syncQuickEnergyOrders({ enabled: true, batchSize: 1, pool: pool as never, logger: { error() {} }, fetcher: async () => { throw new Error('network timeout') } })
    assert.deepEqual(result, { skipped: false, scanned: 1, succeeded: 0, failed: 0, manual: 1 })
    assert.ok(updates.some(sql => sql.includes('供应商请求结果不确定')))
    assert.equal(updates.some(sql => sql.includes('status=4')), false)
  } finally { restore(before) }
})
