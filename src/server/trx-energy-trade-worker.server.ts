import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { placeOrder, type Platform } from './ai-energy-order-worker.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Trade = {
  rid: number
  transferfrom_address: string
  amount: string
  poll_group: string
  bot_status: number
  bot_rid: number
  energy_platform_bot_rid: number
  agent_tg_uid: string | null
}
type Package = { rid: number; energy_amount: number; energy_day: number; agent_trx_price: string | null }
type Agent = { rid: number; cash_trx: string; sufficient: boolean }
type PlatformRow = Platform
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number; now?: () => number }

async function setTrade(pool: Database, rid: number, status: number, comment: string) {
  await pool.query('UPDATE t_energy_wallet_trade_list SET process_status=$2,process_comments=$3,process_time=now() WHERE rid=$1 AND process_status=8', [rid, status, comment.slice(0, 240)])
}

async function claim(pool: Database, shouldContinue: () => boolean): Promise<Trade | null> {
  if (!shouldContinue()) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<Trade>(
      "SELECT a.rid,a.transferfrom_address,a.amount::text,b.poll_group,b.status AS bot_status,b.bot_rid,b.rid AS energy_platform_bot_rid,b.agent_tg_uid::text FROM t_energy_wallet_trade_list a JOIN t_energy_platform_bot b ON a.transferto_address=b.receive_wallet WHERE a.process_status=1 AND lower(a.coin_name)='trx' ORDER BY a.rid LIMIT 1 FOR UPDATE OF a SKIP LOCKED",
    )
    const row = result.rows[0]
    if (!row) { await client.query('ROLLBACK'); return null }
    await client.query("UPDATE t_energy_wallet_trade_list SET process_status=8,process_comments='下单中',process_time=now(),energy_platform_bot_rid=$2 WHERE rid=$1 AND process_status=1", [row.rid, row.energy_platform_bot_rid])
    await client.query('COMMIT')
    return row
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function getAgentCharge(pool: Database, row: Trade, pkg: Package) {
  if (!row.agent_tg_uid) return { fee: null as string | null, error: null as string | null }
  if (!pkg.agent_trx_price || !/^\d+(?:\.\d{1,6})?$/.test(pkg.agent_trx_price) || Number(pkg.agent_trx_price) <= 0) {
    return { fee: null, error: '套餐代理 TRX 价格无效，无法扣款' }
  }
  const result = await pool.query<Agent>(
    'SELECT rid,cash_trx::text,cash_trx >= $3::numeric AS sufficient FROM t_telegram_bot_user WHERE tg_uid=$1 AND bot_rid=$2 LIMIT 1',
    [row.agent_tg_uid, row.bot_rid, pkg.agent_trx_price],
  )
  const agent = result.rows[0]
  if (!agent) return { fee: null, error: '代理用户未关注该机器人，无法扣款' }
  if (!agent.sufficient) return { fee: null, error: '代理地址对应用户 TRX 余额不足' }
  return { fee: pkg.agent_trx_price, error: null }
}

async function finish(pool: Database, row: Trade, platform: PlatformRow, order: { orderId: string; useTrx: string }, pkg: Package, fee: string | null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT rid FROM t_energy_wallet_trade_list WHERE rid=$1 AND process_status=8 FOR UPDATE', [row.rid])
    if (!locked.rowCount) throw new Error('ENERGY_TRADE_CLAIM_CHANGED')
    await client.query(
      'INSERT INTO t_energy_platform_order(energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,receive_address,platform_order_id,energy_amount,energy_day,energy_time,source_type,recovery_status,use_trx) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),2,$9,$10::numeric)',
      [platform.rid, row.energy_platform_bot_rid, platform.platform_name, platform.platform_uid, row.transferfrom_address, order.orderId, pkg.energy_amount, pkg.energy_day, Number(platform.platform_name) === 3 ? 2 : 1, order.useTrx],
    )
    let debitIssue = false
    if (fee && row.agent_tg_uid) {
      const debit = await client.query('UPDATE t_telegram_bot_user SET cash_trx=cash_trx-$3::numeric WHERE bot_rid=$1 AND tg_uid=$2 AND cash_trx >= $3::numeric RETURNING rid', [row.bot_rid, row.agent_tg_uid, fee])
      debitIssue = !debit.rowCount
    }
    await client.query(
      "UPDATE t_energy_wallet_trade_list SET process_status=9,process_comments=$2,platform_order_rid=currval(pg_get_serial_sequence('t_energy_platform_order','rid')),process_time=now(),energy_platform_rid=$3,energy_package_rid=$4,energy_platform_bot_rid=$5,tg_notice_status_send='N' WHERE rid=$1 AND process_status=8",
      [row.rid, debitIssue ? 'SUCCESS；代理余额扣款需人工核对' : 'SUCCESS', platform.rid, pkg.rid, row.energy_platform_bot_rid],
    )
    await client.query('COMMIT')
    return debitIssue
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function processOne(pool: Database, fetcher: typeof fetch, row: Trade, shouldContinue: () => boolean, logger: Logger, now: () => number) {
  if (row.bot_status === 1) { await setTrade(pool, row.rid, 6, '能量钱包未启用'); return 'failed' as const }
  const pkgResult = await pool.query<Package>(
    'SELECT rid,energy_amount,energy_day,agent_trx_price::text FROM t_energy_platform_package WHERE bot_rid=$1 AND trx_price=$2::numeric ORDER BY rid LIMIT 1',
    [row.bot_rid, row.amount],
  )
  const pkg = pkgResult.rows[0]
  if (!pkg) { await setTrade(pool, row.rid, 7, '金额无对应套餐'); return 'failed' as const }
  const agent = await getAgentCharge(pool, row, pkg)
  if (agent.error) { await setTrade(pool, row.rid, 4, agent.error); return 'failed' as const }
  const platforms = await pool.query<PlatformRow>(
    "SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn,comments FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_apikey IS NOT NULL AND ((platform_name=3 AND platform_balance >= $2) OR (platform_name IN (1,2,4,5,6,7) AND platform_balance>0)) ORDER BY seq_sn DESC,rid LIMIT 100",
    [row.poll_group, pkg.energy_amount],
  )
  if (!platforms.rows.length) { await setTrade(pool, row.rid, 4, '机器人无可用能量平台，请质押或者充值平台'); return 'failed' as const }
  const errors: number[] = []
  for (const platform of platforms.rows) {
    if (!shouldContinue()) { await setTrade(pool, row.rid, 1, 'TanStack worker 停止；订单可安全重试'); return 'failed' as const }
    let result
    try {
      result = await placeOrder(fetcher, { energy_amount: pkg.energy_amount, energy_day: pkg.energy_day, wallet_addr: row.transferfrom_address }, platform, now)
    } catch {
      logger.error('energy trade supplier result is uncertain; manual review required for trade ' + row.rid)
      await pool.query("UPDATE t_energy_wallet_trade_list SET process_comments='供应商请求结果不确定，请人工核查；禁止自动重试' WHERE rid=$1 AND process_status=8", [row.rid])
      return 'manual' as const
    }
    if (result.kind === 'rejected') { errors.push(platform.rid); continue }
    try {
      const debitIssue = await finish(pool, row, platform, result.value, pkg, agent.fee)
      if (debitIssue) logger.error('energy trade provider succeeded but agent debit needs manual reconciliation for trade ' + row.rid)
      return 'succeeded' as const
    } catch {
      logger.error('energy trade provider succeeded but local accounting needs manual reconciliation for trade ' + row.rid)
      await pool.query("UPDATE t_energy_wallet_trade_list SET process_comments='供应商已下单但本地记账失败，请人工核查；禁止自动重试' WHERE rid=$1 AND process_status=8", [row.rid]).catch(() => undefined)
      return 'manual' as const
    }
  }
  await setTrade(pool, row.rid, 4, '能量平台下单失败：' + errors.join(', '))
  return 'failed' as const
}

/** Migrates the TRX-paid rental path from the PHP energyOrder task. */
export async function syncTrxEnergyTrades(options: Options = {}) {
  if (!(options.enabled ?? process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true')) return { skipped: true, scanned: 0, succeeded: 0, failed: 0, manual: 0 }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console
  const shouldContinue = options.shouldContinue ?? (() => true), now = options.now ?? Date.now
  const batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize ?? 20)))
  let scanned = 0, succeeded = 0, failed = 0, manual = 0
  for (let i = 0; i < batchSize && shouldContinue(); i++) {
    let row: Trade | null
    try { row = await claim(pool, shouldContinue) } catch { logger.error('energy TRX trade claim failed'); failed++; break }
    if (!row) break
    scanned++
    try {
      const result = await processOne(pool, fetcher, row, shouldContinue, logger, now)
      if (result === 'succeeded') succeeded++
      else if (result === 'manual') manual++
      else failed++
    } catch {
      logger.error('energy TRX trade processing failed for trade ' + row.rid)
      await setTrade(pool, row.rid, 4, '下单流程异常；请先核对订单状态再重试').catch(() => undefined)
      failed++
    }
  }
  return { skipped: false, scanned, succeeded, failed, manual }
}
