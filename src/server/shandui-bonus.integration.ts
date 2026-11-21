import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'

const raw = process.env.TG_JOB_PARITY_TEST_DB_URL
const url = raw ? new URL(raw) : null
if (!raw || !url || url.hostname !== 'postgres' ||
  !url.username.startsWith('tg_job_parity_test_') ||
  !url.pathname.slice(1).startsWith('tg_job_parity_test_')) {
  throw new Error('shandui bonus integration requires a disposable tg_job_parity_test_ database and role')
}
process.env.APP_ENV = 'development'
process.env.TRON_SIGNER_URL = 'http://signer.test'
process.env.TRON_SIGNER_TOKEN = 'x'.repeat(40)
process.env.PLATFORM_TRANSIT_BONUS_ACTIONS = 'true'
const setup = new pg.Pool({ connectionString: raw, options: '-c timezone=Asia/Shanghai', max: 3 })

try {
  await test('shanduiBonus retries zero/error provider balances, uses TronScan, and commits payout readback safely', async () => {
    const files = await import('node:fs/promises')
    const legacySchema = await files.readFile(new URL('../../legacy/000-legacy-schema.sql', import.meta.url), 'utf8')
    const empty = await setup.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public'")
    if (empty.rows[0]?.count !== '0') throw new Error('shandui bonus integration requires a fresh disposable database')
    await setup.query(legacySchema)
    const migrationsPath = new URL('../../migrations/', import.meta.url)
    const migrations = (await files.readdir(migrationsPath)).filter(file => file.endsWith('.sql')).sort()
    for (const migration of migrations) await setup.query(await files.readFile(new URL(migration, migrationsPath), 'utf8'))

    await setup.query(`INSERT INTO t_transit_wallet(rid,chain_type,receive_wallet,send_wallet,send_wallet_privatekey,status)
      VALUES(1,'trc','T-transit','T-source','ciphertext-fixture',0)`)
    await setup.query(`INSERT INTO t_transit_wallet_coin(rid,transit_wallet_id,in_coin_name,out_coin_name,exchange_rate,kou_out_amount,min_transit_amount,max_transit_amount)
      VALUES(1,1,'usdt','trx',2.00,0.50,1,10)`)
    await setup.query(`INSERT INTO t_transit_user_wallet(rid,chain_type,wallet_addr,total_transit_usdt,total_transit_sxf,total_yuzhi_sxf,need_feedback_sxf,send_feedback_sxf)
      VALUES(1,'trc','T-recipient','2.00','0.00','0.00','1.00','0.00')`)
    await setup.query(`INSERT INTO t_transit_wallet_trade_list(rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,sendback_address)
      VALUES(81,'incoming-hash-81','T-sender','T-transit','usdt','4.25','1800000000',1,'T-recipient')`)

    const { syncShanduiBonus } = await import('./shandui-bonus.server')
    const calls: string[] = []
    const signerPayloads: Record<string, unknown>[] = []
    const successfulFetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const requestUrl = new URL(request.url)
      calls.push(requestUrl.hostname + requestUrl.pathname)
      if (requestUrl.hostname === 'api.trongrid.io') {
        if (calls.filter(call => call === 'api.trongrid.io/wallet/getaccount').length === 1) throw new Error('temporary TronGrid outage')
        return Response.json({ balance: 0 })
      }
      if (requestUrl.hostname === 'apilist.tronscanapi.com') return Response.json({ balance: 100_000_000 })
      assert.equal(requestUrl.href, 'http://signer.test/api/internal/tron/sign')
      signerPayloads.push(await request.json() as Record<string, unknown>)
      return Response.json({ code: 200, data: { txid: 'c'.repeat(64) } })
    }
    const success = await syncShanduiBonus({ pool: setup, enabled: true, batchSize: 1, fetcher: successfulFetcher, sleep: async () => {}, logger: { error() {} } })
    assert.deepEqual(success, { skipped: false, processed: 1, succeeded: 1, failed: 0 })
    assert.deepEqual(calls, [
      'api.trongrid.io/wallet/getaccount', 'api.trongrid.io/wallet/getaccount', 'api.trongrid.io/wallet/getaccount',
      'apilist.tronscanapi.com/api/accountv2', 'signer.test/api/internal/tron/sign',
    ])
    assert.equal(signerPayloads[0]?.amount, '7.00')
    assert.equal(signerPayloads[0]?.private_key_ciphertext, 'ciphertext-fixture')
    assert.equal('private_key' in signerPayloads[0]!, false)
    assert.deepEqual((await setup.query('SELECT process_status,sendback_coin_name,sendback_amount,sendback_tx_hash FROM t_transit_wallet_trade_list WHERE rid=81')).rows,
      [{ process_status: 9, sendback_coin_name: 'trx', sendback_amount: '7.00', sendback_tx_hash: 'c'.repeat(64) }])
    assert.deepEqual((await setup.query('SELECT total_transit_usdt,need_feedback_sxf,send_feedback_sxf FROM t_transit_user_wallet WHERE rid=1')).rows,
      [{ total_transit_usdt: '6.25', need_feedback_sxf: '0.00', send_feedback_sxf: '1.00' }])

    const noDuplicate = await syncShanduiBonus({ pool: setup, enabled: true, batchSize: 1, fetcher: async () => { throw new Error('no duplicate transfer expected') }, sleep: async () => {}, logger: { error() {} } })
    assert.deepEqual(noDuplicate, { skipped: false, processed: 0, succeeded: 0, failed: 0 })
    assert.equal(signerPayloads.length, 1)

    await setup.query(`INSERT INTO t_transit_wallet_trade_list(rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,sendback_address)
      VALUES(82,'incoming-hash-82','T-sender','T-transit','usdt','1.00','1800000001',1,'T-failed')`)
    let failedProviderCalls = 0, failedSignerCalls = 0
    const failed = await syncShanduiBonus({
      pool: setup, enabled: true, batchSize: 1, sleep: async () => {}, logger: { error() {} },
      fetcher: async input => {
        const requestUrl = new URL(String(input))
        if (requestUrl.hostname === 'api.trongrid.io') { failedProviderCalls++; return Response.json({ balance: 0 }) }
        if (requestUrl.hostname === 'apilist.tronscanapi.com') return new Response('', { status: 503 })
        failedSignerCalls++
        return Response.json({ code: 200, data: { txid: 'd'.repeat(64) } })
      },
    })
    assert.deepEqual(failed, { skipped: false, processed: 1, succeeded: 0, failed: 1 })
    assert.equal(failedProviderCalls, 3)
    assert.equal(failedSignerCalls, 0)
    assert.deepEqual((await setup.query('SELECT process_status,process_comments FROM t_transit_wallet_trade_list WHERE rid=82')).rows,
      [{ process_status: 10, process_comments: '自动转账失败，待人工核对' }])
  })
} finally {
  await setup.end()
}
