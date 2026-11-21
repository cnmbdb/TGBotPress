import type { Pool } from 'pg'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type MemberUpdate = {
  my_chat_member?: {
    from?: { is_bot?: boolean }
    chat?: { id?: number; type?: string; username?: string; title?: string; first_name?: string; last_name?: string }
    new_chat_member?: { status?: string }
  }
}
type MemberChange = {
  entity: 'user' | 'group'; botRid: number; telegramId: number; status: 'active' | 'inactive'
  chatType: 'private' | 'group' | 'supergroup'; username: string; nickname: string; isAdmin: 'Y' | 'N'
}
type Claim = { rid: number; bot_rid: number; update_body: MemberUpdate }

export function classifyTelegramMemberUpdate(botRid: number, update: MemberUpdate): MemberChange | 'ignored' | null {
  const event = update.my_chat_member
  if (!event) return null
  if (event.from?.is_bot === true) return 'ignored'
  const chat = event.chat
  const telegramId = Number(chat?.id)
  const type = chat?.type
  const status = event.new_chat_member?.status
  if (!Number.isSafeInteger(botRid) || botRid < 1) throw new Error('invalid bot id')
  if (!Number.isSafeInteger(telegramId) || telegramId === 0 || !chat) throw new Error('invalid membership chat')
  if (type !== 'private' && type !== 'group' && type !== 'supergroup') return null
  if (!status || !['member', 'administrator', 'kicked', 'left'].includes(status)) return null
  const active = status === 'member' || status === 'administrator'
  const entity = type === 'private' ? 'user' : 'group'
  const nickname = type === 'private' ? [chat.first_name, chat.last_name].filter(Boolean).join(' ') : (chat.title || '')
  return { entity, botRid, telegramId, status: active ? 'active' : 'inactive', chatType: type, username: chat.username || '', nickname, isAdmin: status === 'administrator' ? 'Y' : 'N' }
}

async function syncMember(pool: Database, change: MemberChange) {
  const table = change.entity === 'user' ? 't_telegram_bot_user' : 't_telegram_bot_group'
  const idColumn = change.entity === 'user' ? 'tg_uid' : 'tg_groupid'
  const usernameColumn = change.entity === 'user' ? 'tg_username' : 'tg_groupusername'
  const nicknameColumn = change.entity === 'user' ? 'tg_nickname' : 'tg_groupnickname'
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))', [change.botRid, String(change.telegramId)])
    const current = await client.query<{ rid: number }>('SELECT rid FROM ' + table + ' WHERE bot_rid=$1 AND ' + idColumn + '=$2 ORDER BY rid LIMIT 1 FOR UPDATE', [change.botRid, String(change.telegramId)])
    if (current.rowCount) {
      if (change.status === 'inactive') {
        await client.query('UPDATE ' + table + ' SET status=2, stop_time=CURRENT_TIMESTAMP WHERE rid=$1', [current.rows[0].rid])
      } else {
        const adminUpdate = change.entity === 'group' ? ', is_admin=$4' : ''
        const params = change.entity === 'group' ? [current.rows[0].rid, change.username, change.nickname, change.isAdmin] : [current.rows[0].rid, change.username, change.nickname]
        await client.query('UPDATE ' + table + ' SET status=1, ' + usernameColumn + '=$2, ' + nicknameColumn + '=$3, last_time=CURRENT_TIMESTAMP, stop_time=NULL' + adminUpdate + ' WHERE rid=$1', params)
      }
    } else if (change.status === 'active') {
      if (change.entity === 'user') {
        await client.query('INSERT INTO t_telegram_bot_user(bot_rid,tg_uid,tg_username,status,tg_nickname,first_time) VALUES($1,$2,$3,1,$4,CURRENT_TIMESTAMP)', [change.botRid, String(change.telegramId), change.username, change.nickname])
      } else {
        await client.query('INSERT INTO t_telegram_bot_group(bot_rid,group_type,tg_groupid,tg_groupusername,tg_groupnickname,status,first_time,is_admin) VALUES($1,$2,$3,$4,$5,1,CURRENT_TIMESTAMP,$6)', [change.botRid, change.chatType, String(change.telegramId), change.username, change.nickname, change.isAdmin])
      }
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error }
  finally { client.release() }
}

async function claimUpdates(pool: Database, owner: string, limit: number): Promise<Claim[]> {
  const result = await pool.query<Claim>(`WITH candidates AS (
    SELECT rid FROM t_platform_telegram_update
    WHERE update_body ? 'my_chat_member'
      AND update_body #>> '{my_chat_member,chat,type}' IN ('private','group','supergroup')
      AND (update_body #>> '{my_chat_member,from,is_bot}' = 'true' OR update_body #>> '{my_chat_member,new_chat_member,status}' IN ('member','administrator','kicked','left'))
      AND attempts < 8
      AND ((status IN ('pending','failed') AND next_attempt_at <= CURRENT_TIMESTAMP) OR (status='processing' AND lease_until < CURRENT_TIMESTAMP))
    ORDER BY rid LIMIT $1 FOR UPDATE SKIP LOCKED
  )
  UPDATE t_platform_telegram_update AS u SET status='processing', attempts=u.attempts+1, lease_owner=$2, lease_until=CURRENT_TIMESTAMP + interval '30 seconds'
  FROM candidates c WHERE u.rid=c.rid RETURNING u.rid,u.bot_rid,u.update_body`, [limit, owner])
  return result.rows
}

export async function syncTelegramMemberUpdates(options: { pool?: Database; enabled?: boolean; shouldContinue?: () => boolean; logger?: Pick<Console, 'error'>; batchSize?: number } = {}) {
  const enabled = options.enabled ?? process.env.PLATFORM_TELEGRAM_MEMBER_UPDATE_SYNC === 'true'
  if (!enabled) return { skipped: true, processed: 0 }
  const pool = options.pool ?? db
  const shouldContinue = options.shouldContinue ?? (() => true)
  const logger = options.logger ?? console
  const owner = 'member-sync-' + process.pid
  let processed = 0
  try {
    const claims = await claimUpdates(pool, owner, Math.min(Math.max(options.batchSize ?? 20, 1), 100))
    for (const claim of claims) {
      if (!shouldContinue()) break
      try {
        const change = classifyTelegramMemberUpdate(claim.bot_rid, claim.update_body)
        if (change && change !== 'ignored') await syncMember(pool, change)
        await pool.query("UPDATE t_platform_telegram_update SET status='processed', processed_at=CURRENT_TIMESTAMP, lease_owner=NULL, lease_until=NULL, last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [claim.rid, owner])
        processed++
      } catch {
        await pool.query("UPDATE t_platform_telegram_update SET status='failed', next_attempt_at=CURRENT_TIMESTAMP + LEAST(interval '5 minutes', interval '2 seconds' * power(2, LEAST(attempts, 7))), lease_owner=NULL, lease_until=NULL, last_error_code='member_sync_failed' WHERE rid=$1 AND status='processing' AND lease_owner=$2", [claim.rid, owner])
        logger.error('Telegram member update sync failed')
      }
    }
    return { skipped: false, processed }
  } catch { logger.error('Telegram member update batch failed'); return { skipped: false, processed, failed: true } }
}

