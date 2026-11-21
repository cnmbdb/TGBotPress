import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { db } from './db.server'

type Database = Pick<Pool, 'connect'>
type RateRow = { rid: number; is_realtime_rate: number; profit_rate: string }
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>
type Logger = Pick<Console, 'warn'>

import { calculateRealtimeExchangeRate, realtimeRateFromIndexPrice } from '@tgbotpress/plugin-transit/rates.js'
export { calculateRealtimeExchangeRate, realtimeRateFromIndexPrice } from '@tgbotpress/plugin-transit/rates.js'

function indexPriceFromPayload(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const response = payload as { code?: unknown; data?: unknown }
  if (response.code !== '0' || !Array.isArray(response.data) || response.data.length === 0) return null
  const ticker = response.data[0]
  if (!ticker || typeof ticker !== 'object') return null
  const value = (ticker as { idxPx?: unknown }).idxPx
  return typeof value === 'string' && realtimeRateFromIndexPrice(value) !== null ? value : null
}

async function fetchIndexPrice(request: Fetcher, logger: Logger) {
  try {
    const response = await request('https://www.okx.com/api/v5/market/index-tickers?instId=TRX-USDT&quoteCcy=USDT', {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      logger.warn('OKX realtime TRX rate request failed')
      return null
    }
    const price = indexPriceFromPayload(await response.json())
    if (!price) logger.warn('OKX realtime TRX rate response was invalid')
    return price
  } catch {
    logger.warn('OKX realtime TRX rate request failed')
    return null
  }
}

async function updateRows(client: PoolClient, indexRate: string, shouldContinue: () => boolean) {
  const rows = await client.query<RateRow>(
    "SELECT rid,is_realtime_rate,profit_rate::text AS profit_rate FROM t_transit_wallet_coin " +
    "WHERE in_coin_name='usdt' AND out_coin_name='trx' AND is_realtime_rate IN (1,3) ORDER BY rid FOR UPDATE"
  )
  let updated = 0
  for (const row of rows.rows) {
    if (!shouldContinue()) break
    const rate = calculateRealtimeExchangeRate(indexRate, row.profit_rate, Number(row.is_realtime_rate))
    if (rate === null) continue
    await client.query('UPDATE t_transit_wallet_coin SET exchange_rate=$2 WHERE rid=$1', [row.rid, rate])
    updated++
  }
  return updated
}

export async function refreshRealtimeTrxRates(
  pool: Database = db,
  request: Fetcher = fetch,
  logger: Logger = console,
  shouldContinue: () => boolean = () => true,
) {
  if (!shouldContinue()) return { updated: 0, reason: 'stopped' as const }
  const indexPrice = await fetchIndexPrice(request, logger)
  if (!shouldContinue()) return { updated: 0, reason: 'stopped' as const }
  if (!indexPrice) return { updated: 0, reason: 'market_unavailable' as const }

  const indexRate = realtimeRateFromIndexPrice(indexPrice)
  if (!indexRate) return { updated: 0, reason: 'invalid_market_data' as const }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (!shouldContinue()) {
      await client.query('ROLLBACK')
      return { updated: 0, reason: 'stopped' as const }
    }
    const updated = await updateRows(client, indexRate, shouldContinue)
    if (!shouldContinue()) {
      await client.query('ROLLBACK')
      return { updated: 0, reason: 'stopped' as const }
    }
    await client.query('COMMIT')
    return { updated, reason: null }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
