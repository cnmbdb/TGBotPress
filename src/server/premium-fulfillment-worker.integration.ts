import assert from 'node:assert/strict'
import { constants, generateKeyPairSync, publicEncrypt } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'
import { syncPremiumFulfillment } from './premium-fulfillment-worker.server'

const connectionString = process.env.TG_PREMIUM_FULFILLMENT_TEST_DB_URL
const databaseUrl = connectionString ? new URL(connectionString) : null
if (!connectionString || !databaseUrl || databaseUrl.hostname !== 'postgres' ||
  !databaseUrl.username.startsWith('tg_premium_fulfillment_test_') ||
  !databaseUrl.pathname.slice(1).startsWith('tg_premium_fulfillment_test_')) {
  throw new Error('Premium fulfillment integration requires a disposable tg_premium_fulfillment_test_ database and role')
}

const pool = new pg.Pool({ connectionString, options: '-c timezone=Asia/Shanghai', max: 5 })
const previousPrivateKey = process.env.TRON_RSA_PRIVATE_KEY
const previousPrivateKeyPath = process.env.TRON_RSA_PRIVATE_KEY_PATH

try {
  const empty = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public'")
  if (empty.rows[0]?.count !== '0') throw new Error('Premium fulfillment integration requires a fresh disposable database')
  await pool.query(await readFile(new URL('../../legacy/000-legacy-schema.sql', import.meta.url), 'utf8'))
  const migrationsPath = new URL('../../migrations/', import.meta.url)
  const migrations = (await readdir(migrationsPath)).filter(file => file.endsWith('.sql')).sort()
  for (const migration of migrations) await pool.query(await readFile(new URL(migration, migrationsPath), 'utf8'))

  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKey = pair.publicKey
  const encrypt = (value: string) => 'v2:' + publicEncrypt({
    key: publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha1',
  }, Buffer.from(value)).toString('base64')
  process.env.TRON_RSA_PRIVATE_KEY = privateKey
  delete process.env.TRON_RSA_PRIVATE_KEY_PATH

  await pool.query(`
    INSERT INTO t_premium_platform(rid,bot_rid,platform_name,platform_hash,platform_cookie,platform_phrase,status,receive_wallet,create_time)
    VALUES (18,7,1,'fragment-fixture-hash',$1,$2,0,'T-premium-receiver',now())
  `, [encrypt('fragment-fixture-cookie'), encrypt('fixture mnemonic phrase')])

  const calls: Array<{ url: string; cookie: string | null }> = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.hostname, 'fragment.com')
    assert.equal(init?.redirect, 'error')
    const cookie = new Headers(init?.headers).get('cookie')
    assert.equal(cookie, 'fragment-fixture-cookie')
    calls.push({ url: url.href, cookie })
    if (url.searchParams.get('method') === 'initGiftPremiumRequest') {
      return Response.json({ ok: true, req_id: 'fixture-request' })
    }
    assert.equal(url.searchParams.get('method'), 'getGiftPremiumLink')
    return Response.json({
      ok: true,
      transaction: { messages: [{ payload: Buffer.from('Gift #ABC123456').toString('base64'), amount: '1230000000' }] },
    })
  }
  const payCalls: Array<{ amount: string; ref: string; months: number; mnemonic: string }> = []
  const preflight = async (mnemonic: string) => {
    assert.equal(mnemonic, 'fixture mnemonic phrase')
    return true
  }
  const insertOrder = async (rid: number, recipient: string, months: number, amount: string) => {
    await pool.query(`
      INSERT INTO t_premium_platform_order(rid,bot_rid,premium_platform_rid,buy_tg_uid,premium_tg_username,need_pay_usdt,status,premium_platform_package_rid,premium_package_month,create_time,expire_time,recipient)
      VALUES($1,7,18,$2,$2,$3,0,91,$4,now(),now()+interval '1 hour',$2)
    `, [rid, recipient, amount, months])
    await pool.query(`
      INSERT INTO t_premium_wallet_trade_list(rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status)
      VALUES($1,$2,'T-sender','T-premium-receiver','usdt',$3,'1800000000',1)
    `, [rid + 1000, 'fixture-payment-' + rid, amount])
  }

  await test('premium fulfillment settles once and fences ambiguous TON results in PostgreSQL', async () => {
    await insertOrder(41, 'alice', 12, '10.0000')
    const success = await syncPremiumFulfillment({
      enabled: true,
      pool,
      fetcher,
      preflight,
      runPayment: async (amount, ref, months, mnemonic) => {
        payCalls.push({ amount, ref, months, mnemonic })
        return 'ton-transaction-success'
      },
      logger: { info() {}, error() {} },
    })
    assert.deepEqual(success, { skipped: false, scanned: 2, matched: 1, succeeded: 1, failed: 0, manual: 0 })
    assert.deepEqual(payCalls[0], { amount: '1.230000000', ref: 'ABC123456', months: 12, mnemonic: 'fixture mnemonic phrase' })
    assert.equal(calls.length, 2)
    assert.deepEqual((await pool.query('SELECT status,tx_hash,tg_notice_user,tg_notice_admin FROM t_premium_platform_order WHERE rid=41')).rows[0], {
      status: 2, tx_hash: 'ton-transaction-success', tg_notice_user: 'Y', tg_notice_admin: 'Y',
    })
    assert.deepEqual((await pool.query('SELECT state,tx_hash FROM t_platform_premium_payment WHERE order_rid=41')).rows[0], {
      state: 'succeeded', tx_hash: 'ton-transaction-success',
    })
    assert.deepEqual((await pool.query('SELECT process_status,platform_order_rid,premium_platform_rid FROM t_premium_wallet_trade_list WHERE rid=1041')).rows[0], {
      process_status: 9, platform_order_rid: 41, premium_platform_rid: 18,
    })

    await insertOrder(42, 'bob', 6, '5.0000')
    const ambiguous = await syncPremiumFulfillment({
      enabled: true,
      pool,
      fetcher,
      preflight,
      runPayment: async (amount, ref, months, mnemonic) => {
        payCalls.push({ amount, ref, months, mnemonic })
        throw new Error('mock ambiguous TON response')
      },
      logger: { info() {}, error() {} },
    })
    assert.deepEqual(ambiguous, { skipped: false, scanned: 2, matched: 1, succeeded: 0, failed: 0, manual: 1 })
    assert.deepEqual((await pool.query('SELECT status,comments,tg_notice_admin FROM t_premium_platform_order WHERE rid=42')).rows[0], {
      status: 5, comments: 'TON 付款结果不确定，需人工核查', tg_notice_admin: 'Y',
    })
    assert.deepEqual((await pool.query('SELECT state,error_code FROM t_platform_premium_payment WHERE order_rid=42')).rows[0], {
      state: 'manual', error_code: 'TON_RESULT_UNCONFIRMED',
    })

    const callsBeforeRetry = payCalls.length
    const retry = await syncPremiumFulfillment({ enabled: true, pool, fetcher, preflight, runPayment: async () => {
      throw new Error('ambiguous payment must not be resent')
    }, logger: { info() {}, error() {} } })
    assert.deepEqual(retry, { skipped: false, scanned: 0, matched: 0, succeeded: 0, failed: 0, manual: 0 })
    assert.equal(payCalls.length, callsBeforeRetry)
  })
} finally {
  await pool.end()
  if (previousPrivateKey === undefined) delete process.env.TRON_RSA_PRIVATE_KEY
  else process.env.TRON_RSA_PRIVATE_KEY = previousPrivateKey
  if (previousPrivateKeyPath === undefined) delete process.env.TRON_RSA_PRIVATE_KEY_PATH
  else process.env.TRON_RSA_PRIVATE_KEY_PATH = previousPrivateKeyPath
}
