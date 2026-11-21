import type { Pool } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'connect' | 'query'>
type Logger = Pick<Console, 'error'>
type Notify = (token: string, chatId: string, wallet: string) => Promise<boolean>
type Keys = { trongrid: string[] }
type Candidate = { rid: number; bot_rid: number; wallet_addr: string; per_bishu_energy_quantity: number | string | null }
type Deactivation = Candidate & { tg_uid: string; bot_token: string }
type Json = Record<string, unknown>

function objectValue(raw: unknown): Json {
  try { if (typeof raw === 'string') raw = JSON.parse(raw); if (typeof raw === 'string') raw = JSON.parse(raw) }
  catch { return {} }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Json : {}
}
function keysFrom(raw: unknown) {
  const keys = objectValue(raw).keys
  return (Array.isArray(keys) ? keys : String(keys ?? '').split(',')).map(String).map(v => v.trim()).filter(Boolean)
}
async function loadKeys(pool: Database): Promise<Keys> {
  const result = await pool.query<{ config_key: string; config_val: unknown }>(
    "SELECT config_key,config_val FROM t_sys_config WHERE config_key='trongrid_api_keys' ORDER BY rid",
  )
  return { trongrid: result.rows.flatMap(row => keysFrom(row.config_val)) }
}
function availableEnergy(limit: unknown, used: unknown) {
  const max = Number(limit), current = Number(used)
  return Number.isFinite(max) && Number.isFinite(current) ? Math.max(0, max - current) : null
}
async function jsonResponse(response: Response): Promise<Json | null> {
  if (!response.ok) return null
  try { return await response.json() as Json } catch { return null }
}
export async function queryWalletEnergy(wallet: string, keys: Keys, fetcher: typeof fetch = fetch): Promise<number | null> {
  try {
    const response = await fetcher('https://apilist.tronscanapi.com/api/accountv2?address=' + encodeURIComponent(wallet), {
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    const payload = await jsonResponse(response)
    const energy = objectValue(objectValue(payload?.data).energy)
    const value = availableEnergy(energy.energy_limit, energy.energy_used)
    if (value !== null) return value
  } catch { /* try TronGrid when configured */ }
  if (!keys.trongrid.length) return null
  const key = keys.trongrid[Math.floor(Math.random() * keys.trongrid.length)]
  try {
    const response = await fetcher('https://api.trongrid.io/wallet/getaccountresource', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'TRON-PRO-API-KEY': key },
      body: JSON.stringify({ address: wallet, visible: true }), redirect: 'error', signal: AbortSignal.timeout(10_000),
    })
    const payload = await jsonResponse(response)
    if (!payload || !('EnergyLimit' in payload) || !('EnergyUsed' in payload)) return null
    return availableEnergy(payload.EnergyLimit, payload.EnergyUsed)
  } catch { return null }
}

async function activeCandidates(pool: Database, after: number) {
  return (await pool.query<Candidate>(
    "SELECT a.rid,a.bot_rid,a.wallet_addr,b.per_bishu_energy_quantity FROM t_energy_ai_bishu a " +
    "JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid JOIN t_telegram_bot c ON a.bot_rid=c.rid " +
    "WHERE a.rid>$1 AND a.is_active='Y' AND a.status=0 AND b.is_open_bishu='Y' AND b.status=0 " +
    "AND b.bishu_daili_type=4 AND b.per_bishu_energy_quantity>=65000 AND a.is_buy='N' AND a.max_buy_quantity>a.total_buy_quantity ORDER BY a.rid LIMIT 100",
    [after],
  )).rows
}
async function queueEnergy(pool: Database, candidate: Candidate, currentEnergy: number, shouldContinue: () => boolean) {
  if (!shouldContinue()) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query<Candidate>(
      "SELECT a.rid,a.bot_rid,a.wallet_addr,b.per_bishu_energy_quantity FROM t_energy_ai_bishu a " +
      "JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid WHERE a.rid=$1 AND a.is_active='Y' AND a.status=0 " +
      "AND b.is_open_bishu='Y' AND b.status=0 AND b.bishu_daili_type=4 AND b.per_bishu_energy_quantity>=65000 AND a.is_buy='N' " +
      "AND a.max_buy_quantity>a.total_buy_quantity FOR UPDATE OF a",
      [candidate.rid],
    )
    const address = locked.rows[0]
    if (!address || !shouldContinue()) { await client.query('ROLLBACK'); return false }
    const threshold = Number(address.per_bishu_energy_quantity) || 65_000
    if (currentEnergy >= threshold) { await client.query('ROLLBACK'); return false }
    const changed = await client.query(
      "UPDATE t_energy_ai_bishu SET is_buy='Y',last_energy_time=now()," +
      "comments=left('能量低于阈值，当前能量 ' || $2::text || '，阈值 ' || $3::text || '，等待能量任务处理：' || to_char(now(),'YYYY-MM-DD HH24:MI:SS'),2000) " +
      "WHERE rid=$1 AND is_active='Y' AND status=0 AND is_buy='N' AND max_buy_quantity>total_buy_quantity RETURNING rid",
      [address.rid, currentEnergy, threshold],
    )
    if (!changed.rowCount || !shouldContinue()) { await client.query('ROLLBACK'); return false }
    await client.query('COMMIT')
    return true
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}

async function inactiveCandidates(pool: Database, after: number) {
  return (await pool.query<Deactivation>(
    "SELECT a.rid,a.bot_rid,a.tg_uid,a.wallet_addr,b.per_bishu_energy_quantity,c.bot_token " +
    "FROM t_energy_ai_bishu a JOIN t_telegram_bot c ON a.bot_rid=c.rid " +
    "LEFT JOIN t_energy_platform_bot b ON a.bot_rid=b.bot_rid " +
    "WHERE a.rid>$1 AND a.is_active='Y' AND a.status=0 AND a.update_time IS NOT NULL " +
    "AND a.update_time<now()-interval '1 hour' ORDER BY a.rid LIMIT 100",
    [after],
  )).rows
}
async function deactivate(pool: Database, candidate: Deactivation, shouldContinue: () => boolean) {
  if (!shouldContinue()) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query(
      "SELECT rid FROM t_energy_ai_bishu WHERE rid=$1 AND is_active='Y' AND status=0 " +
      "AND update_time IS NOT NULL AND update_time<now()-interval '1 hour' FOR UPDATE",
      [candidate.rid],
    )
    if (!locked.rowCount || !shouldContinue()) { await client.query('ROLLBACK'); return false }
    const changed = await client.query(
      "UPDATE t_energy_ai_bishu SET is_active='N',update_time=now()," +
      "comments=left('能量已下发超过1小时但未使用，已自动停用：' || to_char(now(),'YYYY-MM-DD HH24:MI:SS'),2000) " +
      "WHERE rid=$1 AND is_active='Y' AND status=0 RETURNING rid",
      [candidate.rid],
    )
    if (!changed.rowCount || !shouldContinue()) { await client.query('ROLLBACK'); return false }
    await client.query('COMMIT')
    return true
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
function escapeHtml(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }
async function sendNotice(token: string, chatId: string, wallet: string) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return false
  const short = wallet.slice(0, 8) + '...' + wallet.slice(-6)
  const response = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: '⚠️ <b>能量未使用，已自动停用！</b>\n\n📍 钱包地址：<code>' + escapeHtml(short) +
        '</code>\n⏱️ 停用原因：能量已下发1小时但未被使用\n\n💡 如需继续使用，请再次点击该地址按钮激活。',
      parse_mode: 'HTML',
    }),
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  const result = await response.json().catch(() => null) as { ok?: boolean } | null
  if (!response.ok || result?.ok !== true) throw new Error('Telegram rejected the deactivation notice')
  return true
}

export async function autoActivateBishu(options: {
  pool?: Database; fetcher?: typeof fetch; notifier?: Notify; logger?: Logger; shouldContinue?: () => boolean
} = {}) {
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch
  const notifier = options.notifier ?? sendNotice, logger = options.logger ?? console
  const shouldContinue = options.shouldContinue ?? (() => true)
  const keys = await loadKeys(pool)
  let activeScanned = 0, dispatchRequested = 0, deactivationScanned = 0, deactivated = 0, noticesSent = 0
  let after = 0
  while (shouldContinue()) {
    const rows = await activeCandidates(pool, after)
    if (!rows.length) break
    for (const row of rows) {
      if (!shouldContinue()) break
      after = row.rid
      activeScanned++
      const energy = await queryWalletEnergy(row.wallet_addr, keys, fetcher)
      if (energy === null || !shouldContinue()) continue
      if (energy >= (Number(row.per_bishu_energy_quantity) || 65_000)) continue
      try { if (await queueEnergy(pool, row, energy, shouldContinue)) dispatchRequested++ }
      catch { logger.error('autoactivatebishu could not queue an energy dispatch') }
    }
  }
  after = 0
  while (shouldContinue()) {
    const rows = await inactiveCandidates(pool, after)
    if (!rows.length) break
    for (const row of rows) {
      if (!shouldContinue()) break
      after = row.rid
      deactivationScanned++
      const energy = await queryWalletEnergy(row.wallet_addr, keys, fetcher)
      if (energy === null || !shouldContinue()) continue
      if (energy < (Number(row.per_bishu_energy_quantity) || 65_000)) continue
      try {
        if (!await deactivate(pool, row, shouldContinue)) continue
        deactivated++
        for (const chatId of row.tg_uid.split(',').map(value => value.trim()).filter(Boolean)) {
          if (!shouldContinue()) break
          try { if (await notifier(row.bot_token, chatId, row.wallet_addr)) noticesSent++ }
          catch { logger.error('autoactivatebishu Telegram notice failed') }
        }
      } catch { logger.error('autoactivatebishu could not deactivate an unused energy address') }
    }
  }
  return { activeScanned, dispatchRequested, deactivationScanned, deactivated, noticesSent }
}
