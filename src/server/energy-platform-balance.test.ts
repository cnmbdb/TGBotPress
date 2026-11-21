import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { refreshEnergyPlatformBalances } from './energy-platform-balance.server'

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
process.env.TRON_RSA_PRIVATE_KEY = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const encrypted = 'v2:' + publicEncrypt({ key: pair.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from('provider-secret')).toString('base64')
process.env.THIRD_URL = 'https://third.test'
process.env.NL_API_BASE_URL = 'https://nl.test'
process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'

function fixture(rid: number, platform_name: number, platform_uid: string | null, platform_apikey: string | null = null) {
  return { rid, platform_name, platform_uid, platform_apikey, platform_balance: '0', alert_platform_balance: '100', last_alert_time: null, tg_notice_obj: '-1001', bot_token: 'must-not-be-used', comments: null }
}
test('refreshes all seven energy providers and accepts a valid zero balance without sending Telegram', async () => {
  const rows = [
    fixture(1, 1, 'uid-one', encrypted),
    fixture(2, 2, 'uid-two', encrypted),
    fixture(3, 3, 'T' + 'a'.repeat(33)),
    fixture(4, 4, 'uid-four'),
    fixture(5, 5, 'uid-five'),
    fixture(6, 6, 'uid-six', encrypted),
    fixture(7, 7, 'uid-seven', encrypted),
  ]
  const updates: unknown[][] = [], calls: string[] = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    if (sql.includes('SELECT config_val FROM t_sys_config')) return { rows: [{ config_val: { keys: 'fixture-grid-key' } }], rowCount: 1 }
    if (sql.includes('SELECT p.rid,p.platform_name')) return { rows, rowCount: rows.length }
    if (sql.startsWith('UPDATE t_energy_platform')) { updates.push(values ?? []); return { rows: [], rowCount: 1 } }
    throw new Error('unexpected query')
  } } as never
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push(url)
    if (url.includes('tronqq.com')) return Response.json({ status: 200, data: { balance: 6.5 } })
    if (url.includes('wallet.buzz')) return new Response('4.25')
    if (url.includes('trongrid.io')) {
      assert.equal(new Headers(init?.headers).get('TRON-PRO-API-KEY'), 'fixture-grid-key')
      return Response.json({ EnergyLimit: 1000, EnergyUsed: 250 })
    }
    if (url.includes('trongas.io')) return Response.json({ code: 10000, data: { balance: 12 } })
    if (url.includes('third.test')) return Response.json({ code: 200, data: { trx_balance: 8 } })
    if (url.includes('weidubot.cc')) return Response.json({ code: 1, data: { balance: 2 } })
    if (url.includes('nl.test')) return Response.json({ balance: 0 })
    throw new Error('unexpected external request')
  }
  const result = await refreshEnergyPlatformBalances({ pool, fetcher: fetcher as typeof fetch, now: () => Date.UTC(2026, 0, 1), logger: { info() {}, error() {} } })
  assert.deepEqual(result, { scanned: 7, updated: 7, alertsDue: 6, notified: 0, failed: 0 })
  assert.deepEqual(updates.map(row => row[1]), [6.5, 4.25, 750, 12, 8, 2, 0])
  assert.deepEqual(updates.map(row => row[2]), [true, true, false, true, true, true, true])
  assert.equal(calls.length, 7)
  assert.ok(!calls.some(url => url.includes('api.telegram.org')))
})
test('leaves stored balances unchanged when a provider response is missing or malformed', async () => {
  const rows = [fixture(1, 4, 'uid-invalid')]
  const updates: unknown[][] = []
  const pool = { query: async (sql: string, values?: unknown[]) => {
    if (sql.includes('SELECT config_val FROM t_sys_config')) return { rows: [], rowCount: 0 }
    if (sql.includes('SELECT p.rid,p.platform_name')) return { rows, rowCount: 1 }
    if (sql.startsWith('UPDATE t_energy_platform')) { updates.push(values ?? []); return { rows: [], rowCount: 1 } }
    throw new Error('unexpected query')
  } } as never
  const result = await refreshEnergyPlatformBalances({
    pool, fetcher: async () => Response.json({ code: 500, data: { balance: 999 } }),
    logger: { info() {}, error() {} },
  })
  assert.deepEqual(result, { scanned: 1, updated: 0, alertsDue: 0, notified: 0, failed: 1 })
  assert.equal(updates.length, 0)
})

