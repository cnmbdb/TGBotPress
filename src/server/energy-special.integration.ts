import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { Pool } from 'pg'
import { syncEnergySpecial } from './energy-special.server'

const raw = process.env.TG_ENERGY_SPECIAL_TEST_DB_URL
const url = raw ? new URL(raw) : null
if (!raw || !url || url.hostname !== 'postgres' ||
  !url.username.startsWith('tg_energy_special_test_') ||
  !url.pathname.slice(1).startsWith('tg_energy_special_test_')) {
  throw new Error('Energy special integration requires a disposable tg_energy_special_test_ database and role')
}

test('special energy delegation persists successful signing and fences ambiguous signer replays', async () => {
  const pool = new Pool({ connectionString: raw, max: 1 })
  const schema = 'energy_special_' + randomUUID().replaceAll('-', '')
  const previous = {
    signerUrl: process.env.TRON_SIGNER_URL,
    signerToken: process.env.TRON_SIGNER_TOKEN,
    appEnv: process.env.APP_ENV,
    telegram: process.env.PLATFORM_TELEGRAM_ACTIONS,
  }
  process.env.TRON_SIGNER_URL = 'https://signer.fixture'
  process.env.TRON_SIGNER_TOKEN = 'special-energy-integration-token-20261030-0123456789'
  process.env.APP_ENV = 'dev'
  process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
  const signerRequests: Array<{ operation: string; to_address: string; amount: string; private_key_ciphertext: string }> = []
  const energyByAddress = new Map([['TWalletSuccess', 5], ['TWalletManual', 5]])
  try {
    await pool.query('CREATE SCHEMA "' + schema + '"')
    await pool.query('SET search_path TO "' + schema + '"')
    await pool.query(`
      CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY, bot_token text NOT NULL);
      CREATE TABLE t_energy_special(
        rid integer PRIMARY KEY, bot_rid integer, tg_uid bigint, wallet_addr text NOT NULL,
        wallet_energy bigint NOT NULL DEFAULT 0, max_energy bigint NOT NULL DEFAULT 0,
        send_energy bigint NOT NULL DEFAULT 0, per_energy integer NOT NULL DEFAULT 0,
        less_than_energy integer NOT NULL DEFAULT 0, status smallint NOT NULL DEFAULT 1,
        seq_sn integer NOT NULL DEFAULT 0
      );
      CREATE TABLE t_energy_special_list(
        rid bigserial PRIMARY KEY, bot_rid integer, tg_uid bigint, send_wallet_addr text NOT NULL,
        wallet_addr text NOT NULL, before_energy bigint, daili_energy integer,
        daili_hash text, daili_trx numeric(18,6), status smallint NOT NULL DEFAULT 1,
        daili_time timestamp, huishou_time timestamp, huishou_hash text
      );
      CREATE TABLE t_energy_platform(
        rid integer PRIMARY KEY, platform_name smallint NOT NULL, status smallint NOT NULL DEFAULT 0,
        platform_uid text, permission_id integer NOT NULL DEFAULT 0, platform_balance numeric(28,6) NOT NULL DEFAULT 0,
        platform_apikey text, tg_notice_obj text, seq_sn integer NOT NULL DEFAULT 0
      );
    `)
    await pool.query(await (await import('node:fs/promises')).readFile(new URL('../../migrations/010-platform-energy-special.sql', import.meta.url), 'utf8'))
    await pool.query("INSERT INTO t_telegram_bot(rid,bot_token) VALUES(1,'12345:FixtureBotToken')")
    await pool.query("INSERT INTO t_energy_platform(rid,platform_name,status,platform_uid,permission_id,platform_balance,platform_apikey,seq_sn) VALUES(1,3,0,'TPlatformFixture',2,100000,'encrypted-ciphertext-fixture',1)")
    await pool.query(`
      INSERT INTO t_energy_special(rid,bot_rid,tg_uid,wallet_addr,max_energy,per_energy,less_than_energy,status,seq_sn)
      VALUES (1,1,101,'TWalletSuccess',32000,32000,10,1,2),
             (2,1,102,'TWalletManual',32000,32000,10,1,1)
    `)

    const requests: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const requestUrl = new URL(String(input))
      requests.push(requestUrl.hostname + requestUrl.pathname)
      if (requestUrl.hostname === 'apilist.tronscanapi.com') {
        const address = requestUrl.searchParams.get('address') || ''
        return Response.json({ activated: true, bandwidth: { energyRemaining: energyByAddress.get(address) ?? 0 } })
      }
      if (requestUrl.hostname === 'api.trongrid.io' && requestUrl.pathname === '/wallet/getaccountresource') {
        return Response.json({ TotalEnergyWeight: '2000000000', TotalEnergyLimit: '180000000000' })
      }
      if (requestUrl.hostname === 'api.trongrid.io' && requestUrl.pathname === '/wallet/getcandelegatedmaxsize') {
        return Response.json({ max_size: '100000000000' })
      }
      if (requestUrl.hostname === 'signer.fixture' && requestUrl.pathname === '/api/internal/tron/sign') {
        const payload = JSON.parse(String(init?.body || '{}'))
        signerRequests.push(payload)
        assert.equal(payload.private_key_ciphertext, 'encrypted-ciphertext-fixture')
        assert.equal(payload.resource_type, 'ENERGY')
        if (payload.to_address === 'TWalletManual') return Response.json({ code: 503 }, { status: 502 })
        return Response.json({ code: 200, data: { txid: 'fixture-delegate-' + payload.to_address } })
      }
      throw new Error('Unexpected energy-special integration request: ' + requestUrl.href)
    }

    const result = await syncEnergySpecial({ pool, fetcher, enabled: true, logger: { error() {} } })
    assert.deepEqual(result, { skipped: false, scanned: 2, delegated: 1, recovered: 0, failed: 0, noticesSent: 0 })
    assert.deepEqual(signerRequests.map(item => [item.operation, item.to_address, item.amount]), [
      ['delegate_resource', 'TWalletSuccess', '355.555556'],
      ['delegate_resource', 'TWalletManual', '355.555556'],
    ])

    const persisted = await pool.query(`
      SELECT s.rid,s.send_energy::text,l.daili_energy,l.daili_hash,l.daili_trx::text,a.state,a.error_code,a.attempts
      FROM t_energy_special s
      LEFT JOIN t_energy_special_list l ON l.wallet_addr=s.wallet_addr
      JOIN t_platform_energy_special_action a ON a.energy_special_rid=s.rid
      ORDER BY s.rid
    `)
    assert.deepEqual(persisted.rows, [
      { rid: 1, send_energy: '32000', daili_energy: 32000, daili_hash: 'fixture-delegate-TWalletSuccess', daili_trx: '355.555556', state: 'succeeded', error_code: null, attempts: 1 },
      { rid: 2, send_energy: '0', daili_energy: null, daili_hash: null, daili_trx: null, state: 'manual', error_code: 'signer_result_unknown', attempts: 1 },
    ])

    const repeated = await syncEnergySpecial({ pool, fetcher, enabled: true, logger: { error() {} } })
    assert.deepEqual(repeated, { skipped: false, scanned: 1, delegated: 0, recovered: 0, failed: 0, noticesSent: 0 })
    assert.equal(signerRequests.length, 2, 'ambiguous signer result must not be automatically submitted again')
    const manual = await pool.query("SELECT state,attempts FROM t_platform_energy_special_action WHERE energy_special_rid=2")
    assert.deepEqual(manual.rows, [{ state: 'manual', attempts: 1 }])
    assert.ok(requests.some(value => value === 'api.trongrid.io/wallet/getaccountresource'))
    assert.ok(requests.some(value => value === 'api.trongrid.io/wallet/getcandelegatedmaxsize'))
  } finally {
    await pool.end()
    const cleanup = new Pool({ connectionString: raw, max: 1 })
    try { await cleanup.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE') } finally { await cleanup.end() }
    if (previous.signerUrl === undefined) delete process.env.TRON_SIGNER_URL
    else process.env.TRON_SIGNER_URL = previous.signerUrl
    if (previous.signerToken === undefined) delete process.env.TRON_SIGNER_TOKEN
    else process.env.TRON_SIGNER_TOKEN = previous.signerToken
    if (previous.appEnv === undefined) delete process.env.APP_ENV
    else process.env.APP_ENV = previous.appEnv
    if (previous.telegram === undefined) delete process.env.PLATFORM_TELEGRAM_ACTIONS
    else process.env.PLATFORM_TELEGRAM_ACTIONS = previous.telegram
  }
})
