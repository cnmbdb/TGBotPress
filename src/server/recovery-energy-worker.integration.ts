import assert from 'node:assert/strict'
import { test } from 'node:test'
import pg from 'pg'

const raw = process.env.TG_JOB_PARITY_TEST_DB_URL
const url = raw ? new URL(raw) : null
if (!raw || !url || url.hostname !== 'postgres' ||
  !url.username.startsWith('tg_job_parity_test_') ||
  !url.pathname.slice(1).startsWith('tg_job_parity_test_')) {
  throw new Error('recovery energy integration requires a disposable tg_job_parity_test_ database and role')
}
process.env.APP_ENV = 'development'
process.env.TRON_SIGNER_URL = 'http://signer.test'
process.env.TRON_SIGNER_TOKEN = 'x'.repeat(40)
process.env.API_WEB_URL = 'https://api.example'
process.env.PLATFORM_ENERGY_ORDER_ACTIONS = 'true'
const setup = new pg.Pool({ connectionString: raw, options: '-c timezone=Asia/Shanghai', max: 3 })

try {
  await test('recoveryenergy persists the 70-second retry window and matches legacy delegated-energy reconciliation', async () => {
    const files = await import('node:fs/promises')
    const legacySchema = await files.readFile(new URL('../../legacy/000-legacy-schema.sql', import.meta.url), 'utf8')
    const empty = await setup.query<{ count: string }>("SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public'")
    if (empty.rows[0]?.count !== '0') throw new Error('recovery energy integration requires a fresh disposable database')
    await setup.query(legacySchema)
    const migrationsPath = new URL('../../migrations/', import.meta.url)
    const migrations = (await files.readdir(migrationsPath)).filter(file => file.endsWith('.sql')).sort()
    for (const migration of migrations) await setup.query(await files.readFile(new URL(migration, migrationsPath), 'utf8'))
    await setup.query(`INSERT INTO t_energy_platform(rid,poll_group,platform_name,status,platform_uid,permission_id,platform_apikey,create_time)
      VALUES(1,'A',3,1,'T-platform-address',5,'ciphertext-fixture',now())`)
    await setup.query(`INSERT INTO t_energy_platform_order(rid,energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,source_type,receive_address,platform_order_id,energy_amount,energy_day,energy_time,recovery_status)
      VALUES(101,1,1,3,'T-platform-address',1,'T-receiver-101','order-101',32000,0,now()-interval '31 minutes',2)`)

    const { recoverDueEnergy } = await import('./recovery-energy-worker.server')
    const signerBodies: Record<string, unknown>[] = []
    let signerResult = { code: 500, data: {} as { txid?: string } }
    let delegatedResult = 123.456789
    let delegatedCalls = 0
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const requestUrl = new URL(request.url)
      if (requestUrl.hostname === 'signer.test') {
        assert.equal(requestUrl.href, 'http://signer.test/api/internal/tron/sign')
        signerBodies.push(await request.json() as Record<string, unknown>)
        return Response.json(signerResult)
      }
      assert.equal(requestUrl.href, 'https://api.example/api/tron/getdelegatedaddress')
      const body = await request.json() as Record<string, unknown>
      assert.equal(body.fromaddress, 'T-platform-address')
      assert.match(String(body.toaddress), /^T-receiver-10[12]$/)
      delegatedCalls++
      return Response.json({ code: 200, data: { energydelegate: delegatedResult } })
    }

    const firstFailure = await recoverDueEnergy({ pool: setup, fetcher, logger: { error() {}, info() {} } })
    assert.deepEqual(firstFailure, { skipped: false, scanned: 1, recovered: 0, failed: 1 })
    assert.equal(delegatedCalls, 0)
    assert.deepEqual((await setup.query('SELECT count(*)::int AS count FROM t_platform_recovery_energy_retry WHERE energy_platform_order_rid=101')).rows,
      [{ count: 1 }])

    const secondFailure = await recoverDueEnergy({ pool: setup, fetcher, logger: { error() {}, info() {} } })
    assert.deepEqual(secondFailure, { skipped: false, scanned: 1, recovered: 0, failed: 1 })
    assert.equal(delegatedCalls, 1)
    assert.deepEqual((await setup.query('SELECT use_trx::text FROM t_energy_platform_order WHERE rid=101')).rows,
      [{ use_trx: '123.456789' }])

    signerResult = { code: 200, data: { txid: 'f'.repeat(64) } }
    const recovered = await recoverDueEnergy({ pool: setup, fetcher, logger: { error() {}, info() {} } })
    assert.deepEqual(recovered, { skipped: false, scanned: 1, recovered: 1, failed: 0 })
    assert.equal(signerBodies[2]?.amount, '123.456789')
    assert.equal(signerBodies[2]?.operation, 'undelegate_resource')
    assert.equal(signerBodies[2]?.resource_type, 'ENERGY')
    assert.equal(signerBodies[2]?.permission_id, 5)
    assert.equal(signerBodies[2]?.private_key_ciphertext, 'ciphertext-fixture')
    assert.equal('private_key' in signerBodies[2]!, false)
    assert.deepEqual((await setup.query('SELECT recovery_status FROM t_energy_platform_order WHERE rid=101')).rows,
      [{ recovery_status: 3 }])
    assert.deepEqual((await setup.query('SELECT count(*)::int AS count FROM t_platform_recovery_energy_retry WHERE energy_platform_order_rid=101')).rows,
      [{ count: 0 }])

    await setup.query(`INSERT INTO t_energy_platform_order(rid,energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,source_type,receive_address,platform_order_id,energy_amount,energy_day,energy_time,recovery_status)
      VALUES(102,1,1,3,'T-platform-address',1,'T-receiver-102','order-102',65000,1,now()-interval '25 hours',2)`)
    signerResult = { code: 500, data: {} }
    await recoverDueEnergy({ pool: setup, fetcher, logger: { error() {}, info() {} } })
    await setup.query("UPDATE t_platform_recovery_energy_retry SET window_started_at=now()-interval '71 seconds' WHERE energy_platform_order_rid=102")
    const afterExpiredWindow = await recoverDueEnergy({ pool: setup, fetcher, logger: { error() {}, info() {} } })
    assert.deepEqual(afterExpiredWindow, { skipped: false, scanned: 1, recovered: 0, failed: 1 })
    assert.equal(delegatedCalls, 1)
    assert.deepEqual((await setup.query("SELECT window_started_at>now()-interval '70 seconds' AS recent FROM t_platform_recovery_energy_retry WHERE energy_platform_order_rid=102")).rows,
      [{ recent: true }])
    delegatedResult = 0
    const zeroDelegated = await recoverDueEnergy({ pool: setup, fetcher, logger: { error() {}, info() {} } })
    assert.deepEqual(zeroDelegated, { skipped: false, scanned: 1, recovered: 1, failed: 1 })
    assert.equal(delegatedCalls, 2)
    assert.deepEqual((await setup.query('SELECT recovery_status FROM t_energy_platform_order WHERE rid=102')).rows,
      [{ recovery_status: 3 }])
  })
} finally {
  await setup.end()
}
