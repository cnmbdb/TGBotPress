import type { Pool } from 'pg'

type Database = Pick<Pool, 'query'>
type Message = {
  message_id?: number | string
  text?: string
  chat?: { id?: number | string; type?: string }
  from?: { id?: number | string; is_bot?: boolean }
}
type TelegramUpdate = { message?: Message; [key: string]: unknown }

export const telegramEnergyBishuBindClaimPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND u.update_body #>> '{message,chat,id}'=u.update_body #>> '{message,from,id}'",
  "AND left(trim(COALESCE(u.update_body #>> '{message,text}','')),4) IN ('绑定笔数','笔数绑定')",
].join('\n')

export function telegramEnergyBishuBindCommand(update: TelegramUpdate) {
  const message = update.message
  const text = String(message?.text ?? '').trim()
  if (!message || message.chat?.type !== 'private' || message.from?.is_bot === true) return null
  if (String(message.chat.id ?? '') !== String(message.from?.id ?? '')) return null
  if (!text.startsWith('绑定笔数') && !text.startsWith('笔数绑定')) return null
  return { message, text }
}

export type EnergyBishuBindResult =
  | { kind: 'not-command' }
  | { kind: 'replied'; text: string; updated: boolean }

export async function handleTelegramEnergyBishuBind(options: {
  pool: Database
  botRid: number
  update: TelegramUpdate
  sendMessage: (message: Message, text: string) => Promise<boolean>
}): Promise<EnergyBishuBindResult> {
  const command = telegramEnergyBishuBindCommand(options.update)
  if (!command) return { kind: 'not-command' }
  const { message, text } = command
  const commandName = text.startsWith('绑定笔数') ? '绑定笔数' : '笔数绑定'
  const parts = text.slice(commandName.length).trim().split(/\s+/).filter(Boolean)
  const wallet = parts[0] ?? ''
  const tgUsers = parts[1] ?? ''
  let response: string
  let updated = false

  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet) || !/^[0-9]{1,20}(?:,[0-9]{1,20}){0,20}$/.test(tgUsers)) {
    response = '⚠️请输入格式：绑定笔数 T开头的34位钱包地址 687954545 ，表示给笔数地址绑定用户ID通知！\n如果地址需要绑定多个用户通知，用英文逗号,隔开'
  } else {
    const result = await options.pool.query<{
      wallet_exists: boolean
      platform_exists: boolean
      admin_uids: string | null
    }>(
      `SELECT
         EXISTS (SELECT 1 FROM t_energy_ai_bishu eb WHERE eb.wallet_addr=$2 AND eb.bot_rid=$1) AS wallet_exists,
         (SELECT ep.tg_admin_uid FROM t_energy_platform_bot ep WHERE ep.bot_rid=$1 AND ep.status=0 ORDER BY ep.rid LIMIT 1) AS admin_uids,
         EXISTS (SELECT 1 FROM t_energy_platform_bot ep WHERE ep.bot_rid=$1 AND ep.status=0) AS platform_exists`,
      [options.botRid, wallet],
    )
    const state = result.rows[0]
    if (!state?.wallet_exists) {
      response = `❌地址：${wallet}在该机器人中不存在笔数套餐，请先增加笔数`
    } else if (!state.platform_exists) {
      response = '⚠️机器人未配置能量平台或者未启用,仅允许管理员执行,请检查数据'
    } else if (!state.admin_uids?.trim()) {
      response = '⚠️能量平台管理员不正确,仅允许管理员执行,请检查数据1'
    } else if (!state.admin_uids.split(',').map(value => value.trim()).includes(String(message.from?.id ?? ''))) {
      response = '⚠️能量平台管理员不正确,仅允许管理员执行,请检查数据2'
    } else {
      const write = await options.pool.query<{ tg_uid: string }>(
        `UPDATE t_energy_ai_bishu eb
         SET tg_uid=$3, update_time=now()
         WHERE eb.bot_rid=$1 AND eb.wallet_addr=$2
           AND EXISTS (
             SELECT 1 FROM t_energy_platform_bot ep
             WHERE ep.bot_rid=$1 AND ep.status=0
               AND ep.tg_admin_uid IS NOT NULL
               AND EXISTS (SELECT 1 FROM unnest(string_to_array(ep.tg_admin_uid, ',')) AS admin_uid(value) WHERE trim(admin_uid.value)=$4)
           )
         RETURNING eb.tg_uid`,
        [options.botRid, wallet, tgUsers, String(message.from?.id ?? '')],
      )
      const readback = await options.pool.query<{ tg_uid: string }>(
        'SELECT tg_uid FROM t_energy_ai_bishu WHERE bot_rid=$1 AND wallet_addr=$2',
        [options.botRid, wallet],
      )
      updated = write.rowCount === 1 && readback.rows[0]?.tg_uid === tgUsers
      response = updated
        ? `✅笔数地址：${wallet} 通知已更改！`
        : '⚠️管理员配置或笔数套餐状态已变化，请重试'
    }
  }

  const sent = await options.sendMessage(message, response)
  if (!sent) throw new Error('telegram_energy_bishu_bind_reply_failed')
  return { kind: 'replied', text: response, updated }
}
