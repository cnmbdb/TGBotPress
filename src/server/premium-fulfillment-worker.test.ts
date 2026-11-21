import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, publicEncrypt, constants, type KeyObject } from 'node:crypto'
import { syncPremiumFulfillment } from './premium-fulfillment-worker.server'

const order = { rid: 41, bot_rid: 7, premium_platform_rid: 18, recipient: 'alice', premium_package_month: 12 }
function encrypted(value: string, publicKey: KeyObject) {
  return 'v2:' + publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(value)).toString('base64')
}
function fixture(pay = async () => 'ton-transaction-hash') {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const before = process.env.TRON_RSA_PRIVATE_KEY
  process.env.TRON_RSA_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const statements: string[] = [], params: unknown[][] = [], sent: string[] = []
  const platform = { rid: 18, platform_hash: 'fragment-hash', platform_cookie: encrypted('fragment-cookie', pair.publicKey), platform_phrase: encrypted('word '.repeat(24).trim(), pair.publicKey) }
  const client = {
    async query(sql: string, values: unknown[] = []) {
      statements.push(sql); params.push(values)
      if (sql.includes('SELECT rid,bot_rid,premium_platform_rid,recipient,premium_package_month FROM t_premium_platform_order')) return { rows: [order], rowCount: 1 }
      if (sql.includes('INTERRUPTED_PAYMENT_REQUIRES_REVIEW')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT state FROM t_platform_premium_payment')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT rid,platform_hash,platform_cookie,platform_phrase FROM t_premium_platform')) return { rows: [platform], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    }, release() {},
  }
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      statements.push(sql); params.push(values)
      if (sql.includes('SELECT rid FROM t_premium_wallet_trade_list')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT rid,bot_rid,premium_platform_rid,recipient,premium_package_month FROM t_premium_platform_order WHERE status=1')) return { rows: [order], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    }, async connect() { return client },
  }
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); sent.push(url.href)
    assert.equal(url.hostname, 'fragment.com')
    assert.equal(new Headers(init?.headers).get('cookie'), 'fragment-cookie')
    if (url.searchParams.get('method') === 'initGiftPremiumRequest') return Response.json({ ok: true, req_id: 'request-1' })
    const payload = Buffer.from('Gift #ABC123456').toString('base64')
    return Response.json({ ok: true, transaction: { messages: [{ payload, amount: '1230000000' }] } })
  }
  return { pool: pool as never, pair, before, statements, params, sent, fetcher: fetcher as typeof fetch, restore() { if (before === undefined) delete process.env.TRON_RSA_PRIVATE_KEY; else process.env.TRON_RSA_PRIVATE_KEY = before }, pay }
}

test('premium fulfillment decrypts legacy platform secrets and invokes mocked Fragment and TON adapters once', async () => {
  const f = fixture(async () => 'ton-transaction-hash'), calls: unknown[][] = []
  try {
    const result = await syncPremiumFulfillment({ enabled: true, pool: f.pool, fetcher: f.fetcher, preflight: async mnemonic => { assert.equal(mnemonic, 'word '.repeat(23) + 'word'); return true }, runPayment: async (...args) => { calls.push(args); return 'ton-transaction-hash' }, logger: { info() {}, error() {} } })
    assert.deepEqual(result, { skipped: false, scanned: 1, matched: 0, succeeded: 1, failed: 0, manual: 0 })
    assert.equal(f.sent.length, 2)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].slice(0, 3), ['1.230000000', 'ABC123456', 12])
    assert.ok(f.statements.some(sql => sql.includes('INSERT INTO t_platform_premium_payment')))
    assert.ok(f.statements.some(sql => sql.includes("state='submitting'")))
    assert.ok(f.statements.some(sql => sql.includes("state='succeeded'")))
    assert.ok(f.statements.some(sql => sql.includes("tx_hash=$2")))
  } finally { f.restore() }
})

test('a signer error is marked for manual reconciliation and never automatically resent', async () => {
  const f = fixture(async () => { throw new Error('ambiguous signer response') })
  try {
    const result = await syncPremiumFulfillment({ enabled: true, pool: f.pool, fetcher: f.fetcher, preflight: async () => true, runPayment: f.pay, logger: { info() {}, error() {} } })
    assert.deepEqual(result, { skipped: false, scanned: 1, matched: 0, succeeded: 0, failed: 0, manual: 1 })
    assert.ok(f.statements.some(sql => sql.includes("state='manual'")))
    assert.ok(f.statements.some(sql => sql.includes("status=5")))
  } finally { f.restore() }
})
