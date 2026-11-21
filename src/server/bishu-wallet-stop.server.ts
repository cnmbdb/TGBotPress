import type { DatabaseConnection as Pool, DatabaseClient as PoolClient } from './database.types'
import { db } from './db.server'

type Database = Pick<Pool, 'connect'>
type Logger = Pick<Console, 'error'>
type Notify = (botToken: string, chatId: string, message: string) => Promise<boolean>
type Candidate = {
  rid: number
  bot_token: string
  tg_uid: string
  wallet_addr: string
  bishu_stop_day: number
}
type LockedBishu = Pick<Candidate, 'rid' | 'tg_uid' | 'wallet_addr' | 'bishu_stop_day'> & {
  status: number
  max_buy_quantity: number
  total_buy_quantity: number
}

async function sendTelegramNotice(botToken: string, chatId: string, message: string) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return false
  const response = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(12_000),
  })
  const result = await response.json().catch(() => null) as { ok?: boolean } | null
  if (!response.ok || result?.ok !== true) throw new Error('Telegram rejected the stop notice')
  return true
}

async function shouldPauseAddress(client: PoolClient, address: LockedBishu) {
  const result = await client.query<{ order_count: string; idle_count: string }>(
    'SELECT COUNT(*)::text AS order_count, ' +
    'COUNT(*) FILTER (WHERE recovery_time IS NOT NULL AND energy_time IS NOT NULL ' +
    'AND ABS(EXTRACT(EPOCH FROM (recovery_time-energy_time))) >= 86400)::text AS idle_count ' +
    'FROM (SELECT recovery_time,energy_time FROM t_energy_platform_order ' +
    'WHERE receive_address=$1 ORDER BY rid DESC OFFSET 1 LIMIT $2) recent_orders',
    [address.wallet_addr, address.bishu_stop_day],
  )
  const { order_count, idle_count } = result.rows[0]
  return Number(order_count) === address.bishu_stop_day && Number(idle_count) === address.bishu_stop_day
}

async function pauseAddress(client: PoolClient, address: LockedBishu) {
  const result = await client.query<{ rid: number }>(
    "UPDATE t_energy_ai_bishu SET status=1,back_comments='滞留' || $2::text || '天，自动暂停：' || to_char(now(),'YYYY-MM-DD HH24:MI:SS'),update_time=now() " +
    'WHERE rid=$1 AND status=0 AND bishu_stop_day=$2 AND max_buy_quantity>total_buy_quantity RETURNING rid',
    [address.rid, address.bishu_stop_day],
  )
  return result.rowCount === 1
}

async function pauseIfStale(pool: Database, candidate: Candidate, shouldContinue: () => boolean) {
  if (!shouldContinue()) return null
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query<LockedBishu>(
      'SELECT rid,status,tg_uid,wallet_addr,bishu_stop_day,max_buy_quantity,total_buy_quantity ' +
      'FROM t_energy_ai_bishu WHERE rid=$1 FOR UPDATE',
      [candidate.rid],
    )
    const address = locked.rows[0]
    if (!address || address.status !== 0 || address.bishu_stop_day <= 0 || address.max_buy_quantity <= address.total_buy_quantity) {
      await client.query('ROLLBACK')
      return null
    }
    if (!shouldContinue()) {
      await client.query('ROLLBACK')
      return null
    }
    if (!await shouldPauseAddress(client, address) || !shouldContinue()) {
      await client.query('ROLLBACK')
      return null
    }
    if (!await pauseAddress(client, address)) {
      await client.query('ROLLBACK')
      return null
    }
    if (!shouldContinue()) {
      await client.query('ROLLBACK')
      return null
    }
    await client.query('COMMIT')
    return { ...address, bot_token: candidate.bot_token }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function pauseStaleBishuWallets(
  pool: Database = db,
  notify: Notify = sendTelegramNotice,
  logger: Logger = console,
  shouldContinue: () => boolean = () => true,
) {
  const candidates = await pool.connect().then(async client => {
    try {
      const result = await client.query<Candidate>(
        "SELECT a.rid,a.tg_uid,a.wallet_addr,a.bishu_stop_day,b.bot_token FROM t_energy_ai_bishu a " +
        "JOIN t_telegram_bot b ON a.bot_rid=b.rid WHERE a.status=0 AND a.bishu_stop_day>0 " +
        "AND length(a.wallet_addr)=34 AND a.max_buy_quantity>a.total_buy_quantity ORDER BY a.rid",
      )
      return result.rows
    } finally {
      client.release()
    }
  })
  let paused = 0
  let notified = 0
  for (const candidate of candidates) {
    if (!shouldContinue()) break
    const address = await pauseIfStale(pool, candidate, shouldContinue)
    if (!address) continue
    paused++
    const message = '您的笔数地址 <code>' + address.wallet_addr + '</code> 超过 ' + address.bishu_stop_day + ' 天滞留未使用能量，自动暂停笔数！'
    for (const chatId of address.tg_uid.split(',').map(value => value.trim()).filter(Boolean)) {
      try {
        if (await notify(address.bot_token, chatId, message)) notified++
      } catch {
        logger.error('bishuwalletstop Telegram notice failed')
      }
    }
  }
  return { scanned: candidates.length, paused, notified }
}
