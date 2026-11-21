import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { acquireTaskLease, releaseTaskLease } from './task-lease.server'
import { registeredCloneProxy as cloneProxyPlugin } from '../plugins/registry.server'
const { handleToken: handleCloneProxyTokenUpdate } = cloneProxyPlugin.telegram
import { classifyTelegramMemberUpdate } from './telegram-member-updates.server'
import { classifyTelegramJoinUpdate } from './telegram-join-updates.server'
import { groupMessage } from './moderation-group-updates.server'
import { telegramSupportUpdateClaimable } from './telegram-support-updates.server'
import { enqueueGroupManagementUpdate, isGroupManagementUpdate } from '../plugins/groups/tasks.server'

type PollingDatabase = Pick<Pool, 'query' | 'connect'>
type TelegramBot = { rid: number; bot_token: string; last_update_id: number | string | null }
type TelegramUpdate = { update_id?: unknown; [key: string]: unknown }
type TelegramResult = { ok?: boolean; result?: unknown }

const allowedUpdates = ['message', 'edited_message', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request']
const acceptedUpdateFields = new Set(allowedUpdates)
const flagEnabled = (value: string | undefined) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())

async function telegram(fetcher: typeof fetch, token: string, method: string, body?: Record<string, unknown>) {
  const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) return null
  const data = await response.json() as TelegramResult
  return data.ok === true ? data : null
}

function validUpdateId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isNativeMemberUpdate(botRid: number, update: TelegramUpdate) {
  try { return classifyTelegramMemberUpdate(botRid, update as never) !== null }
  catch { return false }
}

function isNativeJoinUpdate(update: TelegramUpdate) {
  if (update.chat_member != null) return true
  try { return classifyTelegramJoinUpdate(update as never).length > 0 }
  catch { return false }
}

function isNativeGroupUpdate(update: TelegramUpdate) {
  const message = groupMessage(update as never)
  if (!message) return false
  const updateMessage = update.message
  const containsJoinMembers = updateMessage !== null && typeof updateMessage === 'object' &&
    ('new_chat_member' in updateMessage || 'new_chat_members' in updateMessage)
  return !containsJoinMembers
}

function isPrivateTelegramMessageUpdate(update: TelegramUpdate) {
  const callbackQuery = update.callback_query
  let callbackMessage: unknown = null
  if (callbackQuery && typeof callbackQuery === 'object' && 'message' in callbackQuery) {
    callbackMessage = (callbackQuery as { message?: unknown }).message ?? null
  }
  const message = update.message ?? update.edited_message ?? callbackMessage
  return message !== null && typeof message === 'object' &&
    'chat' in message && message.chat !== null && typeof message.chat === 'object' &&
    'type' in message.chat && message.chat.type === 'private'
}

async function queueNativeTelegramUpdate(pool: PollingDatabase, botRid: number, update: TelegramUpdate) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query<{ last_update_id: number | string | null }>('SELECT last_update_id FROM t_telegram_bot WHERE rid=$1 FOR UPDATE', [botRid])
    if (!current.rowCount) throw new Error('telegram_bot_missing')
    const lastUpdateId = current.rows[0].last_update_id
    if (lastUpdateId !== null && Number(lastUpdateId) >= Number(update.update_id)) {
      await client.query('COMMIT')
      return 'duplicate' as const
    }
    const payload = JSON.stringify(update)
    const inserted = await client.query<{rid:number}>(
      'INSERT INTO t_platform_telegram_update(bot_rid,update_id,update_body) VALUES($1,$2,$3::jsonb) ON CONFLICT(bot_rid,update_id) DO NOTHING RETURNING rid',
      [botRid, String(update.update_id), payload],
    )
    let inboxRid = Number(inserted.rows[0]?.rid)
    if (!inserted.rowCount) {
      const existing = await client.query<{ rid:number; same_payload: boolean }>(
        'SELECT rid,update_body=$3::jsonb AS same_payload FROM t_platform_telegram_update WHERE bot_rid=$1 AND update_id=$2',
        [botRid, String(update.update_id), payload],
      )
      if (!existing.rowCount || !existing.rows[0].same_payload) {
        await client.query('ROLLBACK')
        return 'conflict' as const
      }
      inboxRid = Number(existing.rows[0].rid)
    }
    if (isGroupManagementUpdate(update as Record<string, any>)) await enqueueGroupManagementUpdate(client,inboxRid,botRid,update as Record<string, any>)
    await client.query('UPDATE t_telegram_bot SET last_update_id=$2 WHERE rid=$1', [botRid, Number(update.update_id)])
    await client.query('COMMIT')
    return inserted.rowCount ? 'queued' as const : 'duplicate' as const
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally { client.release() }
}

async function advanceTelegramUpdateCursor(pool: PollingDatabase, botRid: number, updateId: number) {
  await pool.query(
    'UPDATE t_telegram_bot SET last_update_id=GREATEST(COALESCE(last_update_id,0),$2::bigint) WHERE rid=$1',
    [botRid, updateId],
  )
}

export async function pollNextTelegramBot(options: {
  pool: PollingDatabase
  afterBotRid: number
  fetcher?: typeof fetch
  shouldContinue?: () => boolean
  telegramEnabled?: boolean
  pollingEnabled?: boolean
  deleteWebhook?: boolean
  pollingToken?: string
  memberUpdateSyncEnabled?: boolean
  joinUpdateSyncEnabled?: boolean
  groupMessageSyncEnabled?: boolean
  supportUpdateSyncEnabled?: boolean
  legacyOrigin?: string
  appUrl?: string
}) {
  const {
    pool,
    fetcher = fetch,
    shouldContinue = () => true,
    telegramEnabled = process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
    pollingEnabled = flagEnabled(process.env.PLATFORM_TELEGRAM_POLLING_ENABLED),
    pollingToken = process.env.TELEGRAM_POLLING_TOKEN?.trim() ?? '',
    memberUpdateSyncEnabled = process.env.PLATFORM_TELEGRAM_MEMBER_UPDATE_SYNC === 'true',
    joinUpdateSyncEnabled = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === 'true' && process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
    groupMessageSyncEnabled = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === 'true',
    supportUpdateSyncEnabled = process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === 'true' && process.env.PLATFORM_TELEGRAM_ACTIONS === 'true',
    legacyOrigin = process.env.LEGACY_ORIGIN || 'http://admin',
    appUrl = process.env.APP_URL || legacyOrigin,
  } = options
  const deleteWebhook = options.deleteWebhook ?? flagEnabled(process.env.TELEGRAM_POLLING_DELETE_WEBHOOK)
  if (!pollingEnabled || !telegramEnabled || pollingToken.length < 32 || !shouldContinue()) {
    return { skipped: true, nextAfterBotRid: 0, botRid: null }
  }

  const result = await pool.query<TelegramBot>(
    'SELECT rid,bot_token,last_update_id FROM t_telegram_bot WHERE COALESCE(bot_token,\'\')<>\'\' AND rid>$1 ORDER BY rid LIMIT 1',
    [options.afterBotRid],
  )
  const bot = result.rows[0]
  if (!bot) return { skipped: false, nextAfterBotRid: 0, botRid: null }

  const owner = randomUUID()
  const leaseName = `telegram-polling-bot-${bot.rid}`
  const acquired = await acquireTaskLease(pool as Pick<Pool, 'query'>, leaseName, owner, 60)
  if (!acquired) return { skipped: false, nextAfterBotRid: bot.rid, botRid: bot.rid, locked: true }

  try {
    if (!shouldContinue()) return { skipped: true, nextAfterBotRid: bot.rid, botRid: bot.rid }
    if (deleteWebhook) {
      const deleted = await telegram(fetcher, bot.bot_token, 'deleteWebhook')
      if (!deleted) return { skipped: false, nextAfterBotRid: bot.rid, botRid: bot.rid, failed: 'delete_webhook' }
    }

    const offset = Number(bot.last_update_id || 0) + 1
    const updatesUrl = new URL(`bot${bot.bot_token}/getUpdates`, 'https://api.telegram.org/')
    updatesUrl.searchParams.set('offset', String(offset))
    updatesUrl.searchParams.set('timeout', '0')
    updatesUrl.searchParams.set('limit', '100')
    updatesUrl.searchParams.set('allowed_updates', JSON.stringify(allowedUpdates))
    const updatesResponse = await fetcher(updatesUrl, { signal: AbortSignal.timeout(10_000) })
    if (!updatesResponse.ok) return { skipped: false, nextAfterBotRid: bot.rid, botRid: bot.rid, failed: 'get_updates' }
    const updatesData = await updatesResponse.json() as TelegramResult
    if (updatesData.ok !== true || !Array.isArray(updatesData.result)) {
      return { skipped: false, nextAfterBotRid: bot.rid, botRid: bot.rid, failed: 'get_updates' }
    }

    const origin = new URL(legacyOrigin)
    const internalUrl = new URL('/api/telegram/getdata', origin)
    internalUrl.searchParams.set('rid', String(bot.rid))
    const host = new URL(appUrl).host
    let accepted = 0
    for (const candidate of updatesData.result as TelegramUpdate[]) {
      if (!shouldContinue()) break
      if (!validUpdateId(candidate?.update_id)) continue
      const cloneProxy = await handleCloneProxyTokenUpdate({
        pool,
        masterBotRid: bot.rid,
        update: candidate,
        fetcher,
        shouldContinue,
      })
      if (cloneProxy.handled) {
        accepted++
        continue
      }
      const nativeMemberUpdate = memberUpdateSyncEnabled && isNativeMemberUpdate(bot.rid, candidate)
      const nativeJoinUpdate = joinUpdateSyncEnabled && isNativeJoinUpdate(candidate)
      const nativeGroupUpdate = groupMessageSyncEnabled && isNativeGroupUpdate(candidate)
      const nativeSupportUpdate = supportUpdateSyncEnabled && isPrivateTelegramMessageUpdate(candidate) &&
        await telegramSupportUpdateClaimable(pool, bot.rid, candidate)
      if (nativeMemberUpdate || nativeJoinUpdate || nativeGroupUpdate || nativeSupportUpdate) {
        const queued = await queueNativeTelegramUpdate(pool, bot.rid, candidate)
        if (queued === 'conflict') return { skipped: false, nextAfterBotRid: bot.rid, botRid: bot.rid, accepted, failed: 'update_conflict' }
        accepted++
        continue
      }
      const body: Record<string, unknown> = { rid: bot.rid, update_id: candidate.update_id }
      for (const field of acceptedUpdateFields) {
        if (field in candidate) body[field] = candidate[field]
      }
      const response = await fetcher(internalUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host,
          'x-internal-telegram-token': pollingToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4_000),
      })
      if (response.status !== 200) break
      await advanceTelegramUpdateCursor(pool, bot.rid, candidate.update_id)
      accepted++
    }
    return { skipped: false, nextAfterBotRid: bot.rid, botRid: bot.rid, accepted }
  } catch {
    return { skipped: false, nextAfterBotRid: bot.rid, botRid: bot.rid, failed: 'polling_request' }
  } finally {
    try { await releaseTaskLease(pool, leaseName, owner) } catch { /* lease expires if PostgreSQL is unavailable */ }
  }
}
