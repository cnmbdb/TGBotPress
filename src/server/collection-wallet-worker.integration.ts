import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { test } from 'node:test'
import { collectionWalletAddressIsValid, syncCollectionWallets } from './collection-wallet-worker.server'

const connectionString = process.env.PLATFORM_INTEGRATION_DATABASE_URL
function tronAddress(seed: number) {
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.alloc(19), Buffer.from([seed])])
  const checksum = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest().subarray(0,4)
  const bytes = Buffer.concat([payload, checksum])
  let value = BigInt('0x' + bytes.toString('hex')), encoded = ''
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n }
  for (const byte of bytes) { if (byte !== 0) break; encoded = '1' + encoded }
  return encoded
}

test('collection worker records a fake USDT sweep and will not replay the same stale balance', { skip: !connectionString }, async () => {
  const schema = 'collection_test_' + randomUUID().replaceAll('-', '')
  const admin = new Pool({ connectionString })
  let pool: Pool | undefined
  const keys = ['PLATFORM_COLLECTION_WALLET_ACTIONS','PLATFORM_TELEGRAM_ACTIONS','TRON_SIGNER_TOKEN','TRON_SIGNER_URL','APP_ENV'] as const
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]))
  try {
    await admin.query('CREATE SCHEMA "' + schema + '"')
    pool = new Pool({ connectionString, options: '-c search_path=' + schema, max: 5 })
    await pool.query(`
      CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY, bot_token text);
      CREATE TABLE t_transit_wallet(rid serial PRIMARY KEY,bot_rid integer,send_wallet varchar(200),send_wallet_privatekey varchar(2000));
      CREATE TABLE t_collection_wallet(
        rid serial PRIMARY KEY,bot_rid integer NOT NULL,status smallint NOT NULL,wallet_addr varchar(200) NOT NULL,
        wallet_addr_privatekey varchar(2000),trx_collection_amount numeric(16,6) NOT NULL DEFAULT 0,
        usdt_collection_amount numeric(16,6) NOT NULL DEFAULT 0,trx_reserve_amount numeric(16,6) NOT NULL DEFAULT 0,
        usdt_reserve_amount numeric(16,6) NOT NULL DEFAULT 0,collection_wallet_addr varchar(200),
        permission_id integer NOT NULL DEFAULT 0,tg_notice_obj varchar(500),trx_balance numeric(16,6),
        usdt_balance numeric(16,6),update_time timestamp
      );
      CREATE TABLE t_collection_wallet_list(
        rid serial PRIMARY KEY,wallet_addr varchar(200) NOT NULL,collection_wallet_addr varchar(200) NOT NULL,
        coin_name varchar(20) NOT NULL,collection_amount numeric(16,6) NOT NULL DEFAULT 0,
        collection_time timestamp,collection_hash varchar(200),create_time timestamp
      );
    `)
    await pool.query(await readFile(new URL('../../migrations/002-platform-jobs.sql', import.meta.url), 'utf8'))
    const migration = await readFile(new URL('../../migrations/012-platform-collection-wallet-sweeps.sql', import.meta.url), 'utf8')
    await pool.query(migration)
    await pool.query(migration)

    const source = tronAddress(1), destination = tronAddress(2)
    const lowResourceSource = tronAddress(3), lowResourceDestination = tronAddress(4)
    const ambiguousSource = tronAddress(5), ambiguousDestination = tronAddress(6)
    const fallbackSource = tronAddress(7), fallbackDestination = tronAddress(8)
    for (const address of [source,destination,lowResourceSource,lowResourceDestination,ambiguousSource,ambiguousDestination,fallbackSource,fallbackDestination]) {
      assert.equal(address.length, 34)
      assert.equal(collectionWalletAddressIsValid(address), true)
    }
    await pool.query("INSERT INTO t_telegram_bot VALUES(1,'isolated-test-token')")
    const addWallet = (walletSource: string, walletDestination: string) => pool!.query(
      "INSERT INTO t_collection_wallet(bot_rid,status,wallet_addr,wallet_addr_privatekey,trx_collection_amount,usdt_collection_amount,trx_reserve_amount,usdt_reserve_amount,collection_wallet_addr,tg_notice_obj) VALUES(1,0,$1,'ciphertext-fixture',20,20,0,18,$2,NULL)",
      [walletSource, walletDestination],
    )
    await addWallet(source, destination)

    process.env.PLATFORM_COLLECTION_WALLET_ACTIONS = 'true'
    process.env.PLATFORM_TELEGRAM_ACTIONS = 'false'
    process.env.TRON_SIGNER_TOKEN = 'x'.repeat(40)
    process.env.TRON_SIGNER_URL = 'https://signer.example.test'
    process.env.APP_ENV = 'test'
    const txid = 'a'.repeat(64), signerCalls: Record<string, unknown>[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      const contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
      if (url.hostname === 'apilist.tronscanapi.com') {
        const address = url.searchParams.get('address')
        if (address === fallbackSource) return Response.json({ error: 'temporary outage' }, { status: 503 })
        const trx = address === lowResourceSource ? '1.000000' : '5.000000'
        return Response.json({ withPriceTokens: [
          { tokenId: '_', amount: trx },
          { tokenId: contract, balance: '20000000', tokenDecimal: 6 },
        ] })
      }
      if (url.hostname === 'api.trongrid.io' && url.pathname.startsWith('/v1/accounts/')) {
        assert.equal(decodeURIComponent(url.pathname.split('/').at(-1) ?? ''), fallbackSource)
        return Response.json({ success: true, data: [{ balance: '1000000', trc20: [{ [contract]: '1000000' }] }] })
      }
      if (url.hostname === 'api.trongrid.io' && url.pathname === '/wallet/getaccountresource') {
        const body = JSON.parse(String(init?.body)) as { address?: string }
        return Response.json(body.address === lowResourceSource
          ? { EnergyLimit: 0, EnergyUsed: 0, freeNetLimit: 0, NetLimit: 0, NetUsed: 0 }
          : { EnergyLimit: 40000, EnergyUsed: 0, freeNetLimit: 500, NetLimit: 0, NetUsed: 0 })
      }
      if (url.hostname === 'signer.example.test') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        signerCalls.push(body)
        if (body.to_address === ambiguousDestination) return Response.json({ code: 500, data: {} })
        return Response.json({ code: 200, data: { txid } })
      }
      throw new Error("unexpected_provider_request:" + url.href)
    }
    const logger = { error() {}, info() {} }
    const first = await syncCollectionWallets({ pool, fetcher, enabled: true, logger })
    assert.deepEqual(first, { skipped: false, scanned: 1, transferred: 1, failed: 0, noticesSent: 0 })
    assert.equal(signerCalls.length, 1)
    assert.equal(signerCalls[0].operation, 'transfer_trc20')
    assert.equal(signerCalls[0].private_key_ciphertext, 'ciphertext-fixture')
    assert.equal(signerCalls[0].amount, '2.000000')
    assert.equal(signerCalls[0].to_address, destination)
    assert.equal(signerCalls[0].permission_id, 0)
    assert.deepEqual((await pool.query('SELECT coin_name,collection_amount::text,collection_hash FROM t_collection_wallet_list')).rows, [
      { coin_name: 'usdt', collection_amount: '2.000000', collection_hash: txid },
    ])
    assert.equal((await pool.query("SELECT state FROM t_platform_collection_wallet_action WHERE coin_name='usdt'")).rows[0].state, 'succeeded')
    assert.ok((await pool.query('SELECT last_collection_time FROM t_collection_wallet')).rows[0].last_collection_time)

    const retry = await syncCollectionWallets({ pool, fetcher, enabled: true, logger })
    assert.equal(retry.transferred, 0)
    assert.equal(signerCalls.length, 1)
    assert.equal(Number((await pool.query('SELECT count(*)::int n FROM t_collection_wallet_list')).rows[0].n), 1)

    await addWallet(lowResourceSource, lowResourceDestination)
    await addWallet(ambiguousSource, ambiguousDestination)
    await addWallet(fallbackSource, fallbackDestination)
    const edgeCases = await syncCollectionWallets({ pool, fetcher, enabled: true, logger })
    assert.equal(edgeCases.scanned, 4)
    assert.equal(edgeCases.transferred, 0)
    assert.equal(edgeCases.failed, 0)
    assert.equal(signerCalls.length, 2)
    assert.equal(signerCalls.at(-1)?.to_address, ambiguousDestination)
    assert.deepEqual((await pool.query(
      "SELECT w.trx_balance::text,w.usdt_balance::text FROM t_collection_wallet w WHERE w.wallet_addr=$1",
      [fallbackSource],
    )).rows, [{ trx_balance: '1.000000', usdt_balance: '1.000000' }])
    assert.deepEqual((await pool.query(
      "SELECT count(*)::int AS count FROM t_platform_collection_wallet_action a JOIN t_collection_wallet w ON w.rid=a.wallet_rid WHERE w.wallet_addr=$1",
      [lowResourceSource],
    )).rows, [{ count: 0 }])
    assert.deepEqual((await pool.query(
      "SELECT a.state,a.error_code FROM t_platform_collection_wallet_action a JOIN t_collection_wallet w ON w.rid=a.wallet_rid WHERE w.wallet_addr=$1 AND a.coin_name='usdt'",
      [ambiguousSource],
    )).rows, [{ state: 'manual', error_code: 'signer_result_unknown' }])

    const ambiguousReplay = await syncCollectionWallets({ pool, fetcher, enabled: true, logger })
    assert.equal(ambiguousReplay.transferred, 0)
    assert.equal(signerCalls.length, 2)
    assert.equal(Number((await pool.query('SELECT count(*)::int n FROM t_collection_wallet_list')).rows[0].n), 1)
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key]
      else process.env[key] = old[key]
    }
    await pool?.end()
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE').catch(() => undefined)
    await admin.end()
  }
})
