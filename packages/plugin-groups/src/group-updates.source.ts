import type { Pool } from 'pg'
export type GroupMessage = { chat: { id: number | string; type: string; username?: string }; message_id: number | string; date?: number; from?: { id?: number | string; is_bot?: boolean }; text?: string; caption?: string; new_chat_title?: string; reply_to_message?: GroupMessage }
export type GroupUpdatesHost = { db: Pick<Pool, 'query' | 'connect'>; scanRecentGroupMessages: (...args: any[]) => Promise<any>; telegramCalculatorReply: (...args: any[]) => any; handleTelegramKeywordReply: (...args: any[]) => Promise<any>; handleTelegramExchangeRate: (...args: any[]) => Promise<any>; lookupTronApprovals: (...args: any[]) => Promise<any>; lookupTronAddress: (...args: any[]) => Promise<any>; DISABLED_SECRET_COMMAND_REPLY: string; isDisabledSensitiveTelegramCommand: (...args: any[]) => boolean }
export function createGroupUpdates(host: GroupUpdatesHost) {
const { db, scanRecentGroupMessages, telegramCalculatorReply, handleTelegramKeywordReply, handleTelegramExchangeRate, lookupTronApprovals, lookupTronAddress, DISABLED_SECRET_COMMAND_REPLY, isDisabledSensitiveTelegramCommand } = host
type Database = Pick<Pool, 'query' | 'connect'>

type Update = { message?: GroupMessage; edited_message?: GroupMessage }
type Claim = { rid: number; bot_rid: number; update_body: Update }
type Logger = Pick<Console, 'error'>

function groupMessage(update: Update): GroupMessage | null {
  const message = update.message ?? update.edited_message
  if (!message || typeof message !== 'object' || Array.isArray(message) || !message.chat || typeof message.chat !== 'object' || !['group', 'supergroup'].includes(message.chat.type)) return null
  if (!/^-?\d{1,20}$/.test(String(message.chat.id)) || !/^\d{1,20}$/.test(String(message.message_id))) return null
  return message
}

async function claim(pool: Database, owner: string, batchSize: number) {
  const result = await pool.query<Claim>(`WITH candidates AS (
    SELECT rid FROM t_platform_telegram_update
    WHERE ((update_body ? 'message' AND update_body #>> '{message,chat,type}' IN ('group','supergroup'))
       OR (update_body ? 'edited_message' AND update_body #>> '{edited_message,chat,type}' IN ('group','supergroup')))
      AND NOT (update_body ? 'message' AND (update_body #> '{message,new_chat_member}' IS NOT NULL OR update_body #> '{message,new_chat_members}' IS NOT NULL))
      AND attempts < 8
      AND ((status IN ('pending','failed') AND next_attempt_at <= CURRENT_TIMESTAMP) OR (status='processing' AND lease_until < CURRENT_TIMESTAMP))
    ORDER BY rid LIMIT $1 FOR UPDATE SKIP LOCKED
  )
  UPDATE t_platform_telegram_update AS u SET status='processing',attempts=u.attempts+1,lease_owner=$2,lease_until=CURRENT_TIMESTAMP+interval '30 seconds'
  FROM candidates c WHERE u.rid=c.rid RETURNING u.rid,u.bot_rid,u.update_body`, [batchSize, owner])
  return result.rows
}

async function recordMessage(pool: Database, botRid: number, message: GroupMessage) {
  const text = [message.text, message.caption].filter((value): value is string => typeof value === 'string').join('\n')
  await pool.query(`INSERT INTO t_telegram_group_message_history(bot_rid,chat_id,message_id,user_id,message_date,message_text,message_json,create_time)
    VALUES($1,$2,$3,$4,COALESCE(to_timestamp($5)::timestamp,now()),$6,$7::jsonb,now())
    ON CONFLICT(bot_rid,chat_id,message_id) DO UPDATE SET user_id=EXCLUDED.user_id,message_date=EXCLUDED.message_date,message_text=EXCLUDED.message_text,message_json=EXCLUDED.message_json,create_time=EXCLUDED.create_time`,
  [botRid, String(message.chat.id), String(message.message_id), message.from?.id == null ? null : String(message.from.id), Number.isSafeInteger(message.date) && Number(message.date) > 0 ? message.date : null, text, JSON.stringify(message)])
}

async function syncGroupTitle(pool: Database, botRid: number, message: GroupMessage) {
  const title = message.new_chat_title
  if (typeof title !== 'string' || title.length === 0 || message.from?.is_bot === true) return
  const chatId = String(message.chat.id)
  const group = await pool.query<{ rid: number }>(
    'SELECT rid FROM t_telegram_bot_group WHERE bot_rid=$1 AND tg_groupid=$2 ORDER BY rid LIMIT 1',
    [botRid, chatId],
  )
  const username = message.chat.username ?? ''
  if (group.rows[0]) {
    await pool.query(`UPDATE t_telegram_bot_group SET status=1,tg_groupusername=$2,tg_groupnickname=$3,last_time=CURRENT_TIMESTAMP,stop_time=NULL WHERE rid=$1`, [group.rows[0].rid, username, title])
    return
  }
  await pool.query(`INSERT INTO t_telegram_bot_group(bot_rid,group_type,tg_groupid,tg_groupusername,tg_groupnickname,status,first_time)
    VALUES($1,$2,$3,$4,$5,1,CURRENT_TIMESTAMP)`, [botRid, message.chat.type, chatId, username, title])
}


async function telegramRequest(fetcher: typeof fetch, token: string, method: string, payload: Record<string, unknown>) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, result: undefined as any }
  try {
    const response = await fetcher('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(12_000) })
    return await response.json() as { ok?: boolean; result?: { status?: string } }
  } catch { return { ok: false, result: undefined } }
}

async function handleGroupTronApprovalCommand(pool: Database, fetcher: typeof fetch, botRid: number, message: GroupMessage) {
  const text = String(message.text ?? '').trim()
  if (!text.startsWith('查授权')) return false

  const tokenResult = await pool.query<{ bot_token: string }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [botRid])
  const token = tokenResult.rows[0]?.bot_token ?? ''
  const address = text.slice('查授权'.length).trim().split(/\s+/u)[0] ?? ''
  let messages: string[]
  let replyMarkup: Record<string, unknown> | undefined
  if (!/^T.{33}$/u.test(address)) {
    messages = ['输入格式错误，请输入格式：查授权xxxxxxx  xxxxxxx为波场钱包地址。\n\n比如  查授权TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS']
  } else {
    try {
      const result = await lookupTronApprovals({ pool, fetcher, address })
      messages = result.messages
      replyMarkup = result.replyMarkup
    } catch {
      const safeAddress = address.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
      messages = ['查询地址：<code>' + safeAddress + '</code>\n查询失败，请稍后重试。']
      replyMarkup = { inline_keyboard: [[{ text: '波场链上查询', url: 'https://tronscan.org/#/address/' + encodeURIComponent(address) }]] }
    }
  }

  for (const [index, text] of messages.entries()) {
    const payload: Record<string, unknown> = {
      chat_id: String(message.chat.id),
      text,
      parse_mode: 'HTML',
      allow_sending_without_reply: true,
    }
    if (index === 0) payload.reply_to_message_id = message.message_id
    if (index === messages.length - 1 && replyMarkup) payload.reply_markup = replyMarkup
    const sent = await telegramRequest(fetcher, token, 'sendMessage', payload)
    if (!sent.ok) throw new Error('telegram_group_tron_approval_reply_failed')
  }
  return true
}

async function handleGroupTronAddress(pool: Database, fetcher: typeof fetch, botRid: number, message: GroupMessage) {
  const address = String(message.text ?? '').trim()
  if (!/^T.{33}$/u.test(address)) return false

  const botResult = await pool.query<{ bot_token: string; bot_username: string | null }>(
    'SELECT bot_token,bot_username FROM t_telegram_bot WHERE rid=$1', [botRid],
  )
  const bot = botResult.rows[0]
  if (!bot?.bot_token) throw new Error('telegram_group_address_bot_missing')

  let reply: { text: string; replyMarkup: Record<string, unknown> }
  try {
    reply = await lookupTronAddress({ pool, fetcher, address, botUsername: bot.bot_username })
  } catch {
    const safeAddress = address.replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
    reply = { text: '查询地址：<code>' + safeAddress + '</code>\\n查询失败，请检查地址格式或稍后重试。', replyMarkup: { inline_keyboard: [] } }
  }
  const sent = await telegramRequest(fetcher, bot.bot_token, 'sendMessage', {
    chat_id: String(message.chat.id),
    text: reply.text.slice(0, 3900),
    parse_mode: 'HTML',
    allow_sending_without_reply: true,
    reply_to_message_id: message.message_id,
    reply_markup: reply.replyMarkup,
  })
  if (!sent.ok) throw new Error('telegram_group_tron_address_reply_failed')
  return true
}

async function captureGroupKeyword(pool: Database, fetcher: typeof fetch, botRid: number, message: GroupMessage) {
  const command = String(message.text ?? '').trim().match(/^\/jgjc(?:@([a-z0-9_]+))?\s*$/iu)
  if (!command || !message.from?.id || message.from.is_bot) return false
  const botResult = await pool.query<{ bot_token: string; bot_username: string | null }>('SELECT bot_token,bot_username FROM t_telegram_bot WHERE rid=$1', [botRid])
  const bot = botResult.rows[0]
  if (!bot?.bot_token) return false
  const mentioned = String(command[1] ?? '')
  const username = String(bot.bot_username ?? '').replace(/^@/, '')
  if (mentioned && (!username || mentioned.toLowerCase() !== username.toLowerCase())) return false
  const policy = await pool.query<{ group_moderation_enabled: boolean; ad_keywords: string | null }>('SELECT group_moderation_enabled,ad_keywords FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2', [botRid, String(message.chat.id)])
  if (!policy.rows[0]?.group_moderation_enabled) return false
  const member = await telegramRequest(fetcher, bot.bot_token, 'getChatMember', { chat_id: String(message.chat.id), user_id: String(message.from.id) })
  if (!member.ok || !['creator', 'administrator'].includes(String(member.result?.status ?? ''))) return false
  await telegramRequest(fetcher, bot.bot_token, 'deleteMessage', { chat_id: String(message.chat.id), message_id: String(message.message_id) })

  const target = message.reply_to_message
  const content = target ? [target.text, target.caption].filter((value): value is string => typeof value === 'string').join('\n').trim() : ''
  let outcome = 'ignored'
  let detail = '管理员关键词命令缺少可保存的回复消息'
  if (target && content) {
    const targetWithChat = { ...target, chat: target.chat ?? message.chat }
    await recordMessage(pool, botRid, targetWithChat)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const current = await client.query<{ ad_keywords: string | null }>('SELECT ad_keywords FROM t_telegram_bot_group_policy WHERE bot_rid=$1 AND tg_groupid=$2 FOR UPDATE', [botRid, String(message.chat.id)])
      if (!current.rows[0]) throw new Error('group_policy_missing')
      const words = String(current.rows[0].ad_keywords ?? '').split(/[,，\r\n]+/u).map(value => value.trim()).filter(Boolean)
      const duplicate = words.some(value => value.toLocaleLowerCase('und') === content.toLocaleLowerCase('und'))
      const merged = duplicate ? words.join('\n') : [...words, content].join('\n')
      if (!duplicate && Array.from(merged).length <= 5000) {
        await client.query('UPDATE t_telegram_bot_group_policy SET ad_keywords=$3,update_time=now() WHERE bot_rid=$1 AND tg_groupid=$2', [botRid, String(message.chat.id), merged])
        outcome = 'saved'
        detail = '管理员已将回复消息保存为本群独立关键词'
      } else if (duplicate) detail = '该关键词已存在，仍已执行回扫'
      else detail = '本群关键词已达到长度上限，仍已执行回扫'
      await client.query(`INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time)
        SELECT $1,$2,$3,$4,'keyword_capture',$5,0,$6,$7,now() WHERE NOT EXISTS (
          SELECT 1 FROM t_telegram_moderation_log WHERE bot_rid=$1 AND chat_id=$2 AND message_id=$4 AND event_type='keyword_capture')`,
      [botRid, String(message.chat.id), String(message.from.id), String(message.message_id), outcome, detail, Array.from(content).slice(0, 450).join('')])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  } else {
    await pool.query(`INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time)
      SELECT $1,$2,$3,$4,'keyword_capture','ignored',0,$5,'',now() WHERE NOT EXISTS (
        SELECT 1 FROM t_telegram_moderation_log WHERE bot_rid=$1 AND chat_id=$2 AND message_id=$4 AND event_type='keyword_capture')`,
    [botRid, String(message.chat.id), String(message.from.id), String(message.message_id), detail])
  }
  const scan = await scanRecentGroupMessages({ botRid, chatId: String(message.chat.id), minutes: 30, pool, fetcher })
  if (scan.failed) throw new Error('group_keyword_rescan_failed')
  return true
}

async function processGroupManagementPluginUpdate(options:{pool:Database;fetcher:typeof fetch;botRid:number;update:Update}) {
  const message=groupMessage(options.update)
  if(!message) throw new Error('invalid_group_message')
  if(process.env.PLATFORM_TELEGRAM_ACTIONS==='true' && await captureGroupKeyword(options.pool,options.fetcher,options.botRid,message)) return
  await recordMessage(options.pool,options.botRid,message)
  await syncGroupTitle(options.pool,options.botRid,message)
  if(process.env.PLATFORM_TELEGRAM_ACTIONS==='true') {
    const moderation=await scanRecentGroupMessages({botRid:options.botRid,chatId:String(message.chat.id),messageId:String(message.message_id),pool:options.pool,fetcher:options.fetcher})
    if(moderation.skipped||moderation.failed>0) throw new Error('group_moderation_failed')
  }
}

async function syncTelegramGroupMessages(options: {
  pool?: Database
  fetcher?: typeof fetch
  enabled?: boolean
  shouldContinue?: () => boolean
  logger?: Logger
  batchSize?: number
}) {
  const enabled = options.enabled ?? process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY === 'true'
  if (!enabled) return { skipped: true, processed: 0, failed: 0 }
  const pool = options.pool ?? db, shouldContinue = options.shouldContinue ?? (() => true), logger = options.logger ?? console
  const fetcher = options.fetcher ?? fetch
  if (!shouldContinue()) return { skipped: true, processed: 0, failed: 0 }
  const owner = 'group-moderation-' + process.pid
  const batchSize = Math.min(Math.max(options.batchSize ?? 20, 1), 100)
  let processed = 0, failed = 0
  try {
    const updates = await claim(pool, owner, batchSize)
    for (const update of updates) {
      if (!shouldContinue()) break
      try {
        const message = groupMessage(update.update_body)
        if (!message) throw new Error('invalid_group_message')
        if (isDisabledSensitiveTelegramCommand(message.text ?? message.caption)) {
          if (process.env.PLATFORM_TELEGRAM_ACTIONS === 'true') {
            const bot = await pool.query<{ bot_token: string }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [update.bot_rid])
            const sent = await telegramRequest(fetcher, bot.rows[0]?.bot_token ?? '', 'sendMessage', {
              chat_id: String(message.chat.id), text: DISABLED_SECRET_COMMAND_REPLY, reply_to_message_id: message.message_id, allow_sending_without_reply: true,
            })
            if (!sent.ok) throw new Error('telegram_disabled_secret_reply_failed')
          }
          await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
          processed++
          continue
        }
        if (process.env.PLATFORM_TELEGRAM_ACTIONS === 'true') {
          const exchangeRate = await handleTelegramExchangeRate({
            pool,
            botRid: update.bot_rid,
            update: update.update_body,
            allowGroups: true,
            sendMessage: async (sourceMessage: GroupMessage, text: string) => {
              const bot = await pool.query<{ bot_token: string }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [update.bot_rid])
              const sent = await telegramRequest(fetcher, bot.rows[0]?.bot_token ?? '', 'sendMessage', {
                chat_id: String(sourceMessage.chat?.id ?? ''),
                text,
                reply_to_message_id: sourceMessage.message_id,
                parse_mode: 'HTML',
                allow_sending_without_reply: true,
              })
              return sent.ok === true
            },
          })
          if (exchangeRate.kind === 'replied') {
            await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
            processed++
            continue
          }
          if (await handleGroupTronApprovalCommand(pool, fetcher, update.bot_rid, message)) {
            await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
            processed++
            continue
          }
          if (await handleGroupTronAddress(pool, fetcher, update.bot_rid, message)) {
            await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
            processed++
            continue
          }
          const calculatorReply = telegramCalculatorReply(String(message.text ?? '').trim())
          if (calculatorReply !== null) {
            const bot = await pool.query<{ bot_token: string }>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1', [update.bot_rid])
            const sent = await telegramRequest(fetcher, bot.rows[0]?.bot_token ?? '', 'sendMessage', {
              chat_id: String(message.chat.id),
              text: calculatorReply,
              reply_to_message_id: message.message_id,
              allow_sending_without_reply: true,
              parse_mode: 'HTML',
            })
            if (!sent.ok) throw new Error('telegram_calculator_delivery_failed')
          } else {
            await handleTelegramKeywordReply({ pool, fetcher, botRid: update.bot_rid, message })
          }
        }
        await pool.query("UPDATE t_platform_telegram_update SET status='processed',processed_at=CURRENT_TIMESTAMP,lease_owner=NULL,lease_until=NULL,last_error_code=NULL WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
        processed++
      } catch {
        failed++
        await pool.query("UPDATE t_platform_telegram_update SET status='failed',next_attempt_at=CURRENT_TIMESTAMP+LEAST(interval '5 minutes',interval '2 seconds'*power(2,LEAST(attempts,7))),lease_owner=NULL,lease_until=NULL,last_error_code='group_moderation_failed' WHERE rid=$1 AND status='processing' AND lease_owner=$2", [update.rid, owner])
        logger.error('Telegram group moderation update failed')
      }
    }
    return { skipped: false, processed, failed }
  } catch {
    logger.error('Telegram group moderation update batch failed')
    return { skipped: false, processed, failed, fatal: true }
  }
}

return { groupMessage, processGroupManagementPluginUpdate, syncTelegramGroupMessages }

}
