import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'

type Database = Pick<Pool, 'query'>
type Logger = Pick<Console, 'error' | 'info'>
type RecoveryRow = { rid: number; platform_uid: string; platform_apikey: string | null; energy_amount: number | string; use_trx: string | null; receive_address: string; permission_id: number }
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; now?: () => number }
const DUE_SQL = `
SELECT a.rid,a.platform_uid,b.platform_apikey,a.energy_amount,a.use_trx,a.receive_address,b.permission_id
FROM t_energy_platform_order a
JOIN t_energy_platform b ON b.rid=a.energy_platform_rid
WHERE a.recovery_status=2 AND a.platform_name=3 AND (
 (a.energy_day=0 AND a.energy_time <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai') - interval '30 minutes') OR
 (a.energy_day=1 AND a.energy_time <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai') - interval '1 day') OR
 (a.energy_day=3 AND a.energy_time <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai') - interval '3 days') OR
 (a.energy_day=30 AND a.energy_time <= ($1::timestamptz AT TIME ZONE 'Asia/Shanghai') - interval '30 days')
)
ORDER BY a.rid LIMIT 50`

function signerConfiguration() {
  const token = process.env.TRON_SIGNER_TOKEN?.trim(), base = process.env.TRON_SIGNER_URL?.trim()
  if (!token || token.length < 32 || !base) throw new Error('TRON signer is not configured')
  let url: URL
  try { url = new URL(base) } catch { throw new Error('TRON signer URL is invalid') }
  const appEnv = (process.env.APP_ENV || 'production').toLowerCase()
  if (url.protocol !== 'https:' && !['local', 'dev', 'development'].includes(appEnv)) throw new Error('TRON signer must use HTTPS')
  return { token, url }
}

async function requestRecovery(row: RecoveryRow, amount: string, fetcher: typeof fetch) {
  if (!row.platform_apikey) throw new Error('TRON signer key is missing')
  const { token, url } = signerConfiguration()
  const response = await fetcher(new URL('/api/internal/tron/sign', url), {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ operation: 'undelegate_resource', private_key_ciphertext: row.platform_apikey, from_address: row.platform_uid, to_address: row.receive_address, amount, resource_type: 'ENERGY', permission_id: row.permission_id }),
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json().catch(() => null) as { code?: number; data?: { txid?: string } } | null
  if (!response.ok || result?.code !== 200 || !result.data?.txid) throw new Error('TRON energy recovery was rejected')
}

async function beginRecoveryRetryWindow(pool: Database, orderRid: number) {
  const inserted = await pool.query(
    `INSERT INTO t_platform_recovery_energy_retry(energy_platform_order_rid,window_started_at)
     VALUES($1,now()) ON CONFLICT(energy_platform_order_rid) DO NOTHING RETURNING energy_platform_order_rid`,
    [orderRid],
  )
  if (inserted.rowCount) return false
  const reset = await pool.query(
    `UPDATE t_platform_recovery_energy_retry SET window_started_at=now()
     WHERE energy_platform_order_rid=$1 AND window_started_at<=now()-interval '70 seconds'
     RETURNING energy_platform_order_rid`,
    [orderRid],
  )
  // PHP's Redis marker is created after the first failure. The next failed run
  // inside its 70-second TTL confirms delegated energy; after expiry a new
  // window starts and confirmation waits for the following failed run.
  return !reset.rowCount
}

async function readDelegatedEnergy(row: RecoveryRow, fetcher: typeof fetch) {
  const configured = process.env.API_WEB_URL?.trim()
  if (!configured) throw new Error('API web URL is not configured')
  let url: URL
  try { url = new URL('/api/tron/getdelegatedaddress', configured) } catch { throw new Error('API web URL is invalid') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API web URL protocol is invalid')
  const response = await fetcher(url, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ fromaddress: row.platform_uid, toaddress: row.receive_address }), redirect: 'error', signal: AbortSignal.timeout(12_000) })
  const result = await response.json().catch(() => null) as { code?: number; data?: { energydelegate?: number | string } } | null
  if (!response.ok || result?.code !== 200 || result.data?.energydelegate == null) throw new Error('Unable to confirm delegated energy')
  const amount = Number(result.data.energydelegate)
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Delegated energy response is invalid')
  return amount
}

/** Mirrors the legacy RecoveryEnergy task. External chain actions are opt-in. */
export async function recoverDueEnergy(options: Options = {}) {
  if (process.env.PLATFORM_ENERGY_ORDER_ACTIONS !== 'true') return { skipped: true, scanned: 0, recovered: 0, failed: 0 }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console
  const shouldContinue = options.shouldContinue ?? (() => true), now = options.now ?? Date.now
  if (!shouldContinue()) return { skipped: true, scanned: 0, recovered: 0, failed: 0 }
  const dueAt = new Date(now()).toISOString()
  const due = await pool.query<RecoveryRow>(DUE_SQL, [dueAt])
  let recovered = 0, failed = 0
  for (const row of due.rows) {
    if (!shouldContinue()) break
    const amount = String(row.use_trx || row.energy_amount)
    try {
      await requestRecovery(row, amount, fetcher)
      const result = await pool.query("UPDATE t_energy_platform_order SET recovery_status=3,recovery_time=now() WHERE rid=$1 AND recovery_status=2", [row.rid])
      if (result.rowCount) recovered++
      await pool.query('DELETE FROM t_platform_recovery_energy_retry WHERE energy_platform_order_rid=$1', [row.rid])
    } catch {
      failed++
      let shouldConfirm: boolean
      try { shouldConfirm = await beginRecoveryRetryWindow(pool, row.rid) }
      catch { logger.error('recoveryenergy retry window failed for order ' + row.rid); continue }
      if (!shouldConfirm) continue
      try {
        const delegated = await readDelegatedEnergy(row, fetcher)
        if (delegated === 0) {
          const result = await pool.query("UPDATE t_energy_platform_order SET recovery_status=3,recovery_time=now() WHERE rid=$1 AND recovery_status=2", [row.rid])
          if (result.rowCount) recovered++
          await pool.query('DELETE FROM t_platform_recovery_energy_retry WHERE energy_platform_order_rid=$1', [row.rid])
        } else {
          await pool.query('UPDATE t_energy_platform_order SET use_trx=$2 WHERE rid=$1 AND recovery_status=2', [row.rid, String(delegated)])
        }
      } catch { logger.error('recoveryenergy confirmation failed for order ' + row.rid) }
    }
  }
  return { skipped: false, scanned: due.rows.length, recovered, failed }
}
