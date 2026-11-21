import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseConnection as Pool } from './database.types'
import { analyzeMessage } from './moderation-scan.server'
import { estimateTelegramAccountAgeSeconds } from './telegram-account-age.server'
import { db } from './db.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Chat = { id?: number | string }
type Member = { id?: number | string; is_bot?: boolean; first_name?: string; last_name?: string; username?: string; bio?: string }
type Update = {
  chat_join_request?: { chat?: Chat; from?: Member; user_chat_id?: number | string; bio?: string }
  chat_member?: { chat?: Chat; old_chat_member?: { status?: string }; new_chat_member?: { status?: string; user?: Member }; via_join_request?: boolean }
  message?: { chat?: Chat; from?: Member; text?: string; new_chat_member?: Member; new_chat_members?: Member[] }
}
type JoinEvent = { chatId: string; userId: string; displayName: string; username: string; member: Member; kind: 'join_request'|'join_member'; userChatId: string|null }
type Claim = { rid: number; bot_rid: number; update_body: Update }
type TelegramMethod = 'approveChatJoinRequest' | 'declineChatJoinRequest' | 'banChatMember' | 'restrictChatMember' | 'sendMessage' | 'sendPhoto'
type Logger = Pick<Console, 'error'>

function numericId(value: unknown): string | null {
  const text = String(value ?? '')
  return /^-?\d{1,20}$/.test(text) && text !== '0' ? text : null
}

function displayName(user: Member): string {
  return [user.first_name, user.last_name].filter((part): part is string => typeof part === 'string' && part.trim() !== '').join(' ').trim()
}

export function classifyTelegramJoinUpdate(update: Update): JoinEvent[] {
  const request = update.chat_join_request
  if (request) {
    const chatId = numericId(request.chat?.id)
    const userId = numericId(request.from?.id)
    if (!chatId || !userId || request.from?.is_bot === true) return []
    return [{ chatId, userId, displayName: displayName(request.from || {}), username: request.from?.username || '', member: { ...(request.from || {}), bio: request.bio }, kind: 'join_request', userChatId: numericId(request.user_chat_id) }]
  }

  const memberUpdate = update.chat_member
  if (memberUpdate && memberUpdate.via_join_request !== true && ['left', 'kicked'].includes(String(memberUpdate.old_chat_member?.status ?? '')) && ['member', 'restricted'].includes(String(memberUpdate.new_chat_member?.status ?? ''))) {
    const chatId = numericId(memberUpdate.chat?.id)
    const member = memberUpdate.new_chat_member?.user
    const userId = numericId(member?.id)
    if (!chatId || !userId || member?.is_bot === true) return []
    return [{ chatId, userId, displayName: displayName(member || {}), username: member?.username || '', member: member || {}, kind: 'join_member', userChatId: null }]
  }

  const message = update.message
  const chatId = numericId(message?.chat?.id)
  if (!message || !chatId) return []
  const members = [
    ...(message.new_chat_member ? [message.new_chat_member] : []),
    ...(Array.isArray(message.new_chat_members) ? message.new_chat_members : []),
  ]
  const seen = new Set<string>()
  const events: JoinEvent[] = []
  for (const member of members) {
    const userId = numericId(member.id)
    if (!userId || member.is_bot === true || seen.has(userId)) continue
    seen.add(userId)
    events.push({ chatId, userId, displayName: displayName(member), username: member.username || '', member, kind: 'join_member', userChatId: null })
  }
  return events
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function normalizeEmojiId(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const tagged = text.match(/emoji-id=["']?([0-9]+)/i)?.[1]
  return tagged || text.replace(/\D+/g, '') || null
}

export function multiplyRate(value: string, multiplier: bigint): string {
  if (value.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(value)) return ''
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  const digits = BigInt((whole + fraction).replace(/^0+(?=\d)/, '')) * multiplier
  const scale = fraction.length
  const cents = scale > 2 ? digits / (10n ** BigInt(scale - 2)) : digits * (10n ** BigInt(2 - scale))
  const major = cents / 100n
  const minor = String(cents % 100n).padStart(2, '0')
  const formatted = `${major}.${minor}`.replace(/\.?0+$/, '')
  return negative && cents !== 0n ? `-${formatted}` : formatted
}

function chunks<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size))
  return output
}

async function notificationMarkup(pool: Database, botRid: number, keyreplyRid: number): Promise<Record<string, unknown>> {
  const result = await pool.query<{ keyboard_name: string; keyboard_icon_custom_emoji_id: string | null; keyboard_type: number; inline_type: number; keyboard_value: string }>(`SELECT b.keyboard_name,b.keyboard_icon_custom_emoji_id,b.keyboard_type,b.inline_type,b.keyboard_value
    FROM t_telegram_bot_keyreply_keyboard AS a JOIN t_telegram_bot_keyboard AS b ON b.rid=a.keyboard_rid
    WHERE a.bot_rid=$1 AND a.keyreply_rid=$2 AND b.status=0 ORDER BY b.seq_sn DESC`, [botRid, keyreplyRid])
  const rows = result.rows
  if (!rows.length) return { force_reply: false, input_field_placeholder: '' }
  if (Number(rows[0].keyboard_type) === 1) {
    const buttons = rows.filter(row => Number(row.keyboard_type) === 1 && row.keyboard_name.trim()).map(row => {
      const emojiId = normalizeEmojiId(row.keyboard_icon_custom_emoji_id)
      return emojiId ? { text: row.keyboard_name, icon_custom_emoji_id: emojiId } : row.keyboard_name
    })
    return { keyboard: chunks(buttons, 3), resize_keyboard: true, one_time_keyboard: false, selective: true }
  }
  const buttons = rows.filter(row => Number(row.keyboard_type) === 2 && row.keyboard_name.trim() && row.keyboard_value.trim()).map(row => {
    const button: Record<string, string> = { text: row.keyboard_name }
    const emojiId = normalizeEmojiId(row.keyboard_icon_custom_emoji_id)
    if (emojiId) button.icon_custom_emoji_id = emojiId
    if (Number(row.inline_type) === 1) button.url = row.keyboard_value
    else button.callback_data = row.keyboard_value
    return button
  })
  return { inline_keyboard: chunks(buttons, 2) }
}

async function replyText(pool: Database, botRid: number, text: string, bot: { bot_admin_username: string | null; bot_username: string | null }): Promise<string> {
  if (!/\$\{(?:trxusdtrate|trxusdtwallet|tgbotadmin|trxusdtshownotes|tgbotname|trx10usdtrate|trx100usdtrate|trx1000usdtrate)\}/.test(text)) return text
  const wallet = await pool.query<{ exchange_rate: string | null; receive_wallet: string | null; show_notes: string | null }>(`SELECT a.exchange_rate::text AS exchange_rate,b.receive_wallet,b.show_notes
    FROM t_transit_wallet_coin AS a JOIN t_transit_wallet AS b ON a.transit_wallet_id=b.rid
    WHERE b.bot_rid=$1 AND a.in_coin_name='usdt' AND a.out_coin_name='trx' ORDER BY a.rid LIMIT 1`, [botRid])
  const rate = wallet.rows[0]?.exchange_rate || ''
  const withoutZeros = (value: string | null | undefined) => {
    const number = String(value || '')
    return number.includes('.') ? number.replace(/0+$/, '').replace(/\.$/, '') : number
  }
  const scaled = (multiplier: bigint) => rate ? multiplyRate(rate, multiplier) : ''
  const username = String(bot.bot_username || '').replace(/^@+/, '')
  const values: Record<string, string> = {
    '${trxusdtrate}': rate,
    '${trxusdtwallet}': wallet.rows[0]?.receive_wallet || '',
    '${tgbotadmin}': bot.bot_admin_username || '',
    '${trxusdtshownotes}': wallet.rows[0]?.show_notes || '',
    '${tgbotname}': username ? '@' + username : '',
    '${trx10usdtrate}': scaled(10n),
    '${trx100usdtrate}': scaled(100n),
    '${trx1000usdtrate}': scaled(1000n),
  }
  return text.replace(/\$\{(?:trxusdtrate|trxusdtwallet|tgbotadmin|trxusdtshownotes|tgbotname|trx10usdtrate|trx100usdtrate|trx1000usdtrate)\}/g, token => values[token] ?? '')
}

async function telegramCall(fetcher: typeof fetch, token: string, method: TelegramMethod, data: Record<string, unknown>) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error('invalid_bot_token')
  const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(10_000),
  })
  let result: { ok?: boolean }
  try { result = await response.json() as { ok?: boolean } } catch { throw new Error('invalid_telegram_response') }
  if (!response.ok || result.ok !== true) throw new Error('telegram_action_failed')
}

async function claim(pool: Database, owner: string, limit: number): Promise<Claim[]> {
  const result = await pool.query<Claim>(`WITH candidates AS (
    SELECT rid FROM t_platform_telegram_update
    WHERE ((update_body ? 'chat_join_request') OR (update_body ? 'chat_member') OR
      (update_body ? 'message' AND (update_body #> '{message,new_chat_member}' IS NOT NULL OR update_body #> '{message,new_chat_members}' IS NOT NULL)))
      AND attempts < 8
      AND ((status IN ('pending','failed') AND next_attempt_at <= CURRENT_TIMESTAMP) OR (status='processing' AND lease_until < CURRENT_TIMESTAMP))
    ORDER BY rid LIMIT $1 FOR UPDATE SKIP LOCKED
  )
  UPDATE t_platform_telegram_update AS u SET status='processing',attempts=u.attempts+1,lease_owner=$2,lease_until=CURRENT_TIMESTAMP+interval '30 seconds'
  FROM candidates c WHERE u.rid=c.rid RETURNING u.rid,u.bot_rid,u.update_body`, [limit, owner])
  return result.rows
}

async function createJoinVerification(pool: Database, event: JoinEvent, botRid: number, timeoutSeconds: number, userChatId: string): Promise<string> {
  const token = randomBytes(32).toString('hex'), tokenHash = createHash('sha256').update(token).digest('hex')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['join-verification:' + botRid + ':' + event.chatId + ':' + event.userId + ':' + event.kind])
    await client.query("UPDATE t_telegram_verification SET status='replaced',update_time=now() WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND verification_type=$4 AND status='pending'", [botRid,event.chatId,event.userId,event.kind])
    await client.query("INSERT INTO t_telegram_verification(token_hash,bot_rid,chat_id,user_id,user_chat_id,verification_type,status,expires_at,create_time,update_time) VALUES($1,$2,$3,$4,$5,$6,'pending',now()+($7::text||' seconds')::interval,now(),now())", [tokenHash,botRid,event.chatId,event.userId,userChatId,event.kind,Math.max(60,timeoutSeconds)])
    await client.query('COMMIT')
    return token
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

async function telegramRead(fetcher: typeof fetch, token: string, method: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error('invalid_bot_token')
  const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(10_000) })
  const result = await response.json() as { ok?: boolean; result?: Record<string, unknown> }
  if (!response.ok || result.ok !== true || !result.result) throw new Error('telegram_read_failed')
  return result.result
}

async function joinScreeningReasons(pool: Database, fetcher: typeof fetch, botToken: string, policy: { no_avatar_captcha_enabled: boolean; no_username_captcha_enabled: boolean; new_account_captcha_enabled: boolean; new_account_max_age_seconds: number | null }, event: JoinEvent): Promise<string[]> {
  const reasons: string[] = []
  if (policy.no_username_captcha_enabled && !String(event.member.username ?? '').trim()) reasons.push('用户无 Telegram 用户名')
  if (policy.no_avatar_captcha_enabled) {
    try {
      const photos = await telegramRead(fetcher, botToken, 'getUserProfilePhotos', { user_id: event.userId, offset: 0, limit: 1 })
      if (Number(photos.total_count) === 0) reasons.push('用户无头像')
    } catch { /* Match the legacy fail-open behavior when Telegram cannot inspect a profile. */ }
  }
  if (policy.new_account_captcha_enabled) {
    const threshold = Math.max(3600, Number(policy.new_account_max_age_seconds) || 86400)
    const estimatedAge = estimateTelegramAccountAgeSeconds(Number(event.userId))
    if (estimatedAge !== null && estimatedAge < threshold) reasons.push(`UID 估算账号年龄不足${thresholdLabel(threshold)}`)
  }
  return reasons
}

function thresholdLabel(seconds: number) {
  const labels: Record<number, string> = { 3600: '1小时', 86400: '24小时', 2592000: '1个月', 15552000: '6个月', 31536000: '12个月' }
  return labels[seconds] || `${Math.max(1, Math.ceil(seconds / 86400))}天`
}

async function sendJoinVerification(pool: Database, fetcher: typeof fetch, botRid: number, bot: { bot_token:string; bot_username:string|null }, event: JoinEvent, timeoutSeconds: number, reason = '') {
  const userChatId = event.userChatId || event.userId
  const token = await createJoinVerification(pool,event,botRid,timeoutSeconds,userChatId)
  const origin = process.env.PLATFORM_ORIGIN
  if(!origin) throw new Error('platform_origin_missing')
  const verifyUrl = new URL('/api/moderation?verify='+encodeURIComponent(token),new URL(origin).origin).toString()
  const challengeChat = event.kind==='join_request' ? userChatId : event.chatId
  if(event.kind==='join_member') {
    const permissions={can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false,can_react_to_messages:false,can_change_info:false,can_invite_users:false,can_pin_messages:false,can_manage_topics:false}
    await telegramCall(fetcher,bot.bot_token,'restrictChatMember',{chat_id:event.chatId,user_id:event.userId,permissions,use_independent_chat_permissions:true})
  }
  const button=event.kind==='join_request'
    ? {text:'打开验证',web_app:{url:verifyUrl}}
    : {text:'打开验证',url:verifyUrl}
  const safeName=escapeHtml(event.displayName||'新成员')
  const text=event.kind==='join_member'
    ? '<a href="tg://user?id='+event.userId+'">'+safeName+'</a>，'+(reason?escapeHtml(reason)+'，':'')+'请在 '+Math.max(1,Math.ceil(timeoutSeconds/60))+' 分钟内完成人机验证。'
    : safeName+'，'+(reason?escapeHtml(reason)+'，':'')+'请在 '+Math.max(1,Math.ceil(timeoutSeconds/60))+' 分钟内完成人机验证。'
  const response=await fetcher('https://api.telegram.org/bot'+bot.bot_token+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:challengeChat,text,parse_mode:'HTML',reply_markup:{inline_keyboard:[[button]]},protect_content:true}),signal:AbortSignal.timeout(10_000)})
  const payload=await response.json().catch(()=>null) as {ok?:boolean;result?:{message_id?:number}}|null
  if(!response.ok||payload?.ok!==true||!payload.result?.message_id) throw new Error('telegram_verification_prompt_failed')
  await pool.query("UPDATE t_telegram_verification SET verification_message_id=$2,update_time=now() WHERE token_hash=$1 AND status='pending'",[createHash('sha256').update(token).digest('hex'),payload.result.message_id])
}

type JoinWelcomeReply = { rid: number; reply_photo: string | null; reply_content: string }
async function welcome(pool: Database, fetcher: typeof fetch, botRid: number, token: string, bot: { bot_admin_username: string | null; bot_username: string | null }, chatId: string, user: { displayName: string; username: string }, selectedReply?: JoinWelcomeReply | null): Promise<boolean> {
  const keyreply = selectedReply === undefined
    ? (await pool.query<JoinWelcomeReply>(`SELECT rid,reply_photo,reply_content FROM t_telegram_bot_keyreply
        WHERE bot_rid=$1 AND key_type=2 AND status=0 ORDER BY CASE WHEN rid=1 THEN 0 ELSE 1 END,rid LIMIT 1`, [botRid])).rows[0]
    : selectedReply
  if (!keyreply) return false
  const content = await replyText(pool, botRid, String(keyreply.reply_content || ''), bot)
  const display = user.displayName.trim()
  const safeUsername = user.username.replace(/[^a-z0-9_]/gi, '')
  let prefix = display ? `欢迎 ${escapeHtml(display)} 加入群组！\n` : safeUsername ? '欢迎新成员加入群组！\n' : ''
  if (safeUsername) prefix += `用户：@${safeUsername}\n`
  const text = prefix + content
  const replyMarkup = await notificationMarkup(pool, botRid, keyreply.rid)
  const photo = String(keyreply.reply_photo || '').trim()
  if (photo) {
    await telegramCall(fetcher, token, 'sendPhoto', { chat_id: chatId, photo, caption: text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: replyMarkup })
  } else {
    await telegramCall(fetcher, token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', allow_sending_without_reply: true, reply_markup: replyMarkup })
  }
  return true
}

export async function sendVerifiedJoinNotification(options: {
  pool: Database
  fetcher: typeof fetch
  botRid: number
  token: string
  bot: { bot_admin_username: string | null; bot_username: string | null }
  chatId: string
  userId: string
}) {
  const selected = await options.pool.query<JoinWelcomeReply>(`SELECT rid,reply_photo,reply_content FROM t_telegram_bot_keyreply
    WHERE bot_rid=$1 AND key_type=2 AND status=0 ORDER BY CASE WHEN rid=1 THEN 0 ELSE 1 END,rid LIMIT 1`, [options.botRid])
  const reply = selected.rows[0]
  if (!reply) return false
  let user = { displayName: '', username: '' }
  try {
    const member = await telegramRead(options.fetcher, options.token, 'getChatMember', { chat_id: options.chatId, user_id: options.userId })
    const identity = member.user && typeof member.user === 'object' ? member.user as Member : {}
    user = { displayName: displayName(identity), username: String(identity.username || '') }
  } catch { /* Match the PHP welcome path: a failed identity lookup does not suppress the configured greeting. */ }
  return welcome(options.pool, options.fetcher, options.botRid, options.token, options.bot, options.chatId, user, reply)
}

export async function syncTelegramJoinUpdates(options: {
  pool?: Database
  fetcher?: typeof fetch
  enabled?: boolean
  shouldContinue?: () => boolean
  logger?: Logger
  batchSize?: number
} = {}) {
  const enabled = options.enabled ?? (process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === 'true' && process.env.PLATFORM_TELEGRAM_ACTIONS === 'true')
  if (!enabled) return { skipped: true, processed: 0, failed: 0 }
  const pool = options.pool ?? db, fetcher = options.fetcher ?? fetch
  const shouldContinue = options.shouldContinue ?? (() => true), logger = options.logger ?? console
  const owner = 'telegram-join-' + process.pid
  let processed = 0, failed = 0
  try {
    const updates = await claim(pool, owner, Math.min(Math.max(options.batchSize ?? 20, 1), 100))
    for (const update of updates) {
      if (!shouldContinue()) break
      try {
        const events = classifyTelegramJoinUpdate(update.update_body)
        if (!events.length && update.update_body.chat_member) {
          await pool.query("UPDATE t_platform_telegram_update SET status='ignored',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
          processed++
          continue
        }
        if (events.length) {
          const botResult = await pool.query<{ bot_token: string; bot_admin_username: string | null; bot_username: string | null; ad_score_threshold: number; moderation_ad_keywords: string | null }>('SELECT b.bot_token,b.bot_admin_username,b.bot_username,COALESCE(c.ad_score_threshold,4) AS ad_score_threshold,c.ad_keywords AS moderation_ad_keywords FROM t_telegram_bot b LEFT JOIN t_telegram_bot_moderation_config c ON c.bot_rid=b.rid WHERE b.rid=$1', [update.bot_rid])
          const bot = botResult.rows[0]
          if (bot?.bot_token) {
            for (const event of events) {
              if (!shouldContinue()) break
              const policy=await pool.query<{join_captcha_enabled:boolean;no_avatar_captcha_enabled:boolean;no_username_captcha_enabled:boolean;new_account_captcha_enabled:boolean;new_account_max_age_seconds:number;verification_timeout_seconds:number;ad_keywords:string|null}>('SELECT join_captcha_enabled,no_avatar_captcha_enabled,no_username_captcha_enabled,new_account_captcha_enabled,new_account_max_age_seconds,verification_timeout_seconds,ad_keywords FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2',[update.bot_rid,event.chatId])
              const settings=policy.rows[0]
              const screeningEnabled=!!settings&&(settings.join_captcha_enabled||settings.no_avatar_captcha_enabled||settings.no_username_captcha_enabled||settings.new_account_captcha_enabled)
              if (settings&&screeningEnabled) {
                const keywords=String(bot.moderation_ad_keywords||'').split(/[,，\r\n]+/u).map(word=>word.trim()).filter(Boolean)
                const profile=analyzeMessage({from:event.member,bio:event.member.bio},keywords,false,Number(bot.ad_score_threshold)||4)
                if(profile.isAd) {
                  if(event.kind==='join_request') await telegramCall(fetcher,bot.bot_token,'declineChatJoinRequest',{chat_id:event.chatId,user_id:event.userId})
                  else await telegramCall(fetcher,bot.bot_token,'banChatMember',{chat_id:event.chatId,user_id:event.userId})
                  await pool.query("INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,event_type,action,score,reasons,content_preview,create_time) VALUES($1,$2,$3,'join_profile_ad',$4,$5,$6,$7,now())",[update.bot_rid,event.chatId,event.userId,event.kind==='join_request'?'decline':'ban',profile.score,profile.reasons.join('、'),profile.preview])
                  continue
                }
                const reasons=await joinScreeningReasons(pool,fetcher,bot.bot_token,settings,event)
                if(settings.join_captcha_enabled||reasons.length) {
                  await sendJoinVerification(pool,fetcher,update.bot_rid,bot,event,Number(settings.verification_timeout_seconds)||180,reasons.join('、'))
                  await pool.query("INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,event_type,action,score,reasons,content_preview,create_time) VALUES($1,$2,$3,$4,'pending',0,$5,$6,now())",[update.bot_rid,event.chatId,event.userId,event.kind==='join_request'?'join_request_verification_started':'join_member_verification_started',reasons.join('、')||'群组已启用全部成员入群验证',`验证时限 ${Math.max(1,Math.ceil((Number(settings.verification_timeout_seconds)||180)/60))} 分钟`])
                  continue
                }
              }
              if (event.kind==='join_request') await telegramCall(fetcher, bot.bot_token, 'approveChatJoinRequest', { chat_id: event.chatId, user_id: event.userId })
              await welcome(pool, fetcher, update.bot_rid, bot.bot_token, bot, event.chatId, event)
            }
          }
        }
        await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
        processed++
      } catch {
        failed++
        await pool.query("UPDATE t_platform_telegram_update SET status='failed',next_attempt_at=CURRENT_TIMESTAMP+LEAST(interval '5 minutes',interval '2 seconds'*power(2,LEAST(attempts,7))),lease_owner=NULL,lease_until=NULL,last_error_code='telegram_join_action_failed' WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
        logger.error('Telegram join update failed')
      }
    }
    return { skipped: false, processed, failed }
  } catch {
    logger.error('Telegram join update batch failed')
    return { skipped: false, processed, failed, fatal: true }
  }
}
