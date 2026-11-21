import type { Pool, PoolClient } from 'pg'
import { db } from './db.server'
import { placeOrder, type Platform } from './ai-energy-order-worker.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type QuickOrder = {
  rid: number; bot_rid: number; tg_uid: string; wallet_addr: string; energy_amount: number; energy_day: number
  package_rid: number | null; energy_platform_bot_rid: number; poll_group: string; bot_status: number
  agent_tg_uid: string | null; agent_per_price: string | null
}
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean; batchSize?: number; now?: () => number }
type PlatformRow = Platform & { comments?: string | null }
const allowedDay = (value: number) => value === 0 || value === 1 || value === 3

async function claim(pool: Database, keepGoing: () => boolean): Promise<QuickOrder | null> {
  if (!keepGoing()) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<QuickOrder>(
      "SELECT a.rid,a.bot_rid,a.tg_uid,a.wallet_addr,a.energy_amount,a.energy_day,a.package_rid,b.rid AS energy_platform_bot_rid,b.poll_group,b.status AS bot_status,b.agent_tg_uid::text,b.agent_per_price::text FROM t_energy_quick_order a JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid WHERE a.status=1 AND a.energy_amount>0 ORDER BY a.rid LIMIT 1 FOR UPDATE OF a SKIP LOCKED",
    )
    const row = result.rows[0]
    if (!row) { await client.query('ROLLBACK'); return null }
    await client.query("UPDATE t_energy_quick_order SET status=8,comments='下单中',update_time=now() WHERE rid=$1 AND status=1", [row.rid])
    await client.query('COMMIT')
    return row
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function status(pool: Database, rid: number, next: number, message: string) {
  await pool.query('UPDATE t_energy_quick_order SET status=$2,comments=$3,update_time=now() WHERE rid=$1 AND status=8', [rid, next, message.slice(0, 250)])
}

async function agentCharge(pool: Database, row: QuickOrder) {
  if (!row.agent_tg_uid) return { fee: null as string | null, error: null as string | null }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pkg = await client.query<{ agent_trx_price: string }>('SELECT agent_trx_price::text FROM t_energy_platform_package WHERE rid=$1 AND bot_rid=$2', [row.package_rid, row.bot_rid])
    const required = Number(pkg.rows[0]?.agent_trx_price)
    const fee = Number(row.agent_per_price)
    if (!pkg.rowCount || !Number.isFinite(required) || required <= 0 || !Number.isFinite(fee) || fee <= 0) {
      await client.query('ROLLBACK'); return { fee: null, error: '代理套餐价格配置无效' }
    }
    const user = await client.query<{ cash_trx: string }>('SELECT cash_trx::text FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 FOR UPDATE', [row.bot_rid, row.agent_tg_uid])
    const balance = Number(user.rows[0]?.cash_trx)
    if (!user.rowCount) { await client.query('ROLLBACK'); return { fee: null, error: '代理用户未关注该机器人' } }
    if (!Number.isFinite(balance) || balance < required || balance < fee) {
      await client.query('ROLLBACK'); return { fee: null, error: '代理地址对应用户TRX余额不足' }
    }
    await client.query('COMMIT')
    return { fee: String(row.agent_per_price), error: null }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function finish(pool: Database, row: QuickOrder, platform: PlatformRow, order: { orderId: string; useTrx: string }, fee: string | null) {
  const client = await pool.connect()
  let accountingIssue = false
  try {
    await client.query('BEGIN')
    const locked = await client.query('SELECT rid FROM t_energy_quick_order WHERE rid=$1 AND status=8 FOR UPDATE', [row.rid])
    if (!locked.rowCount) throw new Error('QUICK_ENERGY_CLAIM_CHANGED')
    await client.query(
      'INSERT INTO t_energy_platform_order(energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,receive_address,platform_order_id,energy_amount,energy_day,energy_time,source_type,recovery_status,use_trx) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),2,$9,$10::numeric)',
      [platform.rid, row.energy_platform_bot_rid, platform.platform_name, platform.platform_uid, row.wallet_addr, order.orderId, row.energy_amount, row.energy_day, Number(platform.platform_name) === 3 ? 2 : 1, order.useTrx],
    )
    if (fee && row.agent_tg_uid) {
      const charged = await client.query('UPDATE t_telegram_bot_user SET cash_trx=cash_trx-$3::numeric WHERE bot_rid=$1 AND tg_uid=$2 AND cash_trx >= $3::numeric RETURNING rid', [row.bot_rid, row.agent_tg_uid, fee])
      accountingIssue = !charged.rowCount
    }
    const message = accountingIssue ? 'SUCCESS；供应商已下单，代理余额扣款需人工核对' : 'SUCCESS'
    await client.query("UPDATE t_energy_quick_order SET status=9,comments=$2,is_notice='Y',update_time=now() WHERE rid=$1 AND status=8", [row.rid, message])
    await client.query('COMMIT')
    return accountingIssue
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function processOne(pool: Database, fetcher: typeof fetch, row: QuickOrder, keepGoing: () => boolean, logger: Logger, now: () => number) {
  if (row.bot_status === 1) { await status(pool, row.rid, 6, '能量钱包未启用'); return 'failed' as const }
  if (!Number.isSafeInteger(row.energy_amount) || row.energy_amount <= 0 || !allowedDay(row.energy_day)) { await status(pool, row.rid, 4, '能量数量或租用时长无效'); return 'failed' as const }
  const agent = await agentCharge(pool, row)
  if (agent.error) { await status(pool, row.rid, 5, agent.error); return 'failed' as const }
  const platforms = await pool.query<PlatformRow>(
    "SELECT rid,platform_name,platform_uid,platform_apikey,permission_id,platform_balance::text,seq_sn,comments FROM t_energy_platform WHERE poll_group=$1 AND status=0 AND platform_apikey IS NOT NULL AND ((platform_name=3 AND platform_balance >= $2) OR (platform_name IN (1,2,4,5,6,7) AND platform_balance>0)) ORDER BY seq_sn DESC,rid LIMIT 100",
    [row.poll_group, row.energy_amount],
  )
  if (!platforms.rows.length) { await status(pool, row.rid, 4, '机器人无可用能量平台，请质押或者充值平台'); return 'failed' as const }
  const errors: string[] = []
  for (const platform of platforms.rows) {
    if (!keepGoing()) { await status(pool, row.rid, 4, 'TanStack worker 停止；订单可安全重试'); return 'failed' as const }
    let result
    try {
      result = await placeOrder(fetcher, { energy_amount: row.energy_amount, energy_day: row.energy_day, wallet_addr: row.wallet_addr }, platform, now)
    } catch {
      logger.error('quick energy supplier result is uncertain; manual review required for order ' + row.rid)
      // Do not reset status=8: the supplier may already have charged or delegated energy.
      await pool.query("UPDATE t_energy_quick_order SET comments='供应商请求结果不确定，请人工核查；禁止自动重试',update_time=now() WHERE rid=$1 AND status=8", [row.rid])
      return 'manual' as const
    }
    if (result.kind === 'rejected') { errors.push('平台 ' + platform.rid + '：' + result.message); continue }
    try {
      const accountingIssue = await finish(pool, row, platform, result.value, agent.fee)
      if (accountingIssue) logger.error('quick energy supplier succeeded but agent debit needs manual reconciliation for order ' + row.rid)
      return 'succeeded' as const
    } catch {
      logger.error('quick energy supplier succeeded but local accounting needs manual reconciliation for order ' + row.rid)
      await pool.query("UPDATE t_energy_quick_order SET comments='供应商已下单但本地记账失败，请人工核查；禁止自动重试',update_time=now() WHERE rid=$1 AND status=8", [row.rid]).catch(() => undefined)
      return 'manual' as const
    }
  }
  await status(pool, row.rid, 4, errors.join('；') || '能量平台下单失败')
  return 'failed' as const
}

/** Migrates the legacy quick-energy purchase path. Supplier calls are opt-in only. */
export async function syncQuickEnergyOrders(options: Options = {}) {
  if (!(options.enabled ?? process.env.PLATFORM_ENERGY_ORDER_ACTIONS === 'true')) return { skipped: true, scanned: 0, succeeded: 0, failed: 0, manual: 0 }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch, logger = options.logger ?? console
  const keepGoing = options.shouldContinue ?? (() => true), now = options.now ?? Date.now
  const batchSize = Math.max(1, Math.min(20, Math.floor(options.batchSize ?? 5)))
  let scanned = 0, succeeded = 0, failed = 0, manual = 0
  for (let i = 0; i < batchSize && keepGoing(); i++) {
    let row: QuickOrder | null
    try { row = await claim(pool, keepGoing) } catch { logger.error('quick energy order claim failed'); failed++; break }
    if (!row) break
    scanned++
    try {
      const result = await processOne(pool, fetcher, row, keepGoing, logger, now)
      if (result === 'succeeded') succeeded++
      else if (result === 'manual') manual++
      else failed++
    } catch {
      logger.error('quick energy order processing failed for order ' + row.rid)
      await status(pool, row.rid, 4, '下单流程异常，订单已释放，可重试').catch(() => undefined)
      failed++
    }
  }
  return { skipped: false, scanned, succeeded, failed, manual }
}
