import type { Pool } from 'pg'
import { db } from './db.server'

type Queryable = Pick<Pool, 'query'>
type ResourceRow = { rid: number; wallet_addr: string }
type TronscanResponse = {
  activated?: unknown
  bandwidth?: { freeNetRemaining?: unknown; netRemaining?: unknown; energyRemaining?: unknown }
}
type Resource = { bandwidth: number; energy: number }
export type AiTrusteeshipResourceOptions = {
  pool?: Queryable
  fetcher?: typeof fetch
  logger?: Pick<Console, 'error'>
  shouldContinue?: () => boolean
  allowPurchaseTrigger?: boolean
  apiKey?: string
  delayMs?: number
  enabled?: boolean
}

function count(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function parseTronscanAccountResource(value: unknown): Resource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as TronscanResponse
  const active = body.activated === true || body.activated === 1 || body.activated === '1' || body.activated === 'true'
  if (!active || !body.bandwidth || typeof body.bandwidth !== 'object') return null
  const free = count(body.bandwidth.freeNetRemaining)
  const net = count(body.bandwidth.netRemaining)
  const energy = count(body.bandwidth.energyRemaining)
  if (free === null || net === null || energy === null || !Number.isSafeInteger(free + net)) return null
  return { bandwidth: free + net, energy }
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export async function refreshAiTrusteeshipResources(options: AiTrusteeshipResourceOptions = {}) {
  if (options.enabled !== true) return { checked: 0, updated: 0, failed: 0, skipped: 0 }
  const pool = options.pool ?? db
  const fetcher = options.fetcher ?? fetch
  const logger = options.logger ?? console
  const delayMs = options.delayMs ?? 1000
  const candidates = await pool.query<ResourceRow>(
    `SELECT a.rid,a.wallet_addr
       FROM t_energy_ai_trusteeship a
       JOIN t_telegram_bot b ON b.rid=a.bot_rid
       JOIN t_energy_platform_bot c ON c.bot_rid=a.bot_rid
      WHERE a.status=0 AND c.is_open_ai_trusteeship='Y' AND length(a.wallet_addr)=34
      ORDER BY a.rid`,
  )
  const rows = candidates.rows
  if (!rows.length) return { checked: 0, updated: 0, failed: 0, skipped: 0 }

  let next = 0
  let updated = 0
  let failed = 0
  let skipped = 0
  let stopped = false
  const workers = Array.from({ length: Math.min(5, rows.length) }, async () => {
    while (next < rows.length) {
      if (options.shouldContinue && !options.shouldContinue()) { stopped = true; return }
      const row = rows[next++]
      if (delayMs > 0) await pause(delayMs)
      if (options.shouldContinue && !options.shouldContinue()) { stopped = true; skipped++; return }
      try {
        const url = new URL('https://apilist.tronscanapi.com/api/accountv2')
        url.searchParams.set('address', row.wallet_addr)
        const headers = new Headers({ Accept: 'application/json' })
        if (options.apiKey) headers.set('TRON-PRO-API-KEY', options.apiKey)
        const response = await fetcher(url, { headers, signal: AbortSignal.timeout(10_000) })
        if (!response.ok) { failed++; continue }
        const resource = parseTronscanAccountResource(await response.json())
        if (!resource) { skipped++; continue }
        const result = await pool.query(
          `UPDATE t_energy_ai_trusteeship
              SET current_bandwidth_quantity=$2,
                  current_energy_quantity=$3,
                  is_buy=CASE WHEN $4::boolean AND is_buy='N' AND $3 < min_energy_quantity THEN 'Y' ELSE is_buy END
            WHERE rid=$1 AND status=0`,
          [row.rid, resource.bandwidth, resource.energy, options.allowPurchaseTrigger === true],
        )
        if (result.rowCount) updated++
        else skipped++
      } catch {
        failed++
        logger.error(`AI trusteeship resource refresh failed for record ${row.rid}`)
      }
    }
  })
  await Promise.all(workers)
  if (stopped) skipped += Math.max(0, rows.length - next)
  return { checked: rows.length, updated, failed, skipped }
}
