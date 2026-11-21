import type { Pool } from 'pg'

type Database = Pick<Pool, 'query'>
type ActivationMessage = {
  text?: unknown
  message_id: number | string
  chat: { id: number | string; type: string }
  from?: { id?: number | string; is_bot?: boolean }
}
type Wallet = { send_wallet: string | null; send_wallet_privatekey: string | null; tg_notice_obj_receive: string | null }
type Ledger = { state: 'signing' | 'succeeded' | 'manual'; tx_hash: string | null }
type TgResponse = { ok?: boolean; description?: string; result?: { message_id?: number } }

export const telegramAdminActivationClaimPredicate = [
  "u.update_body ? 'message' AND u.update_body #>> '{message,chat,type}'='private'",
  "AND COALESCE(u.update_body #>> '{message,from,is_bot}','false')<>'true'",
  "AND trim(COALESCE(u.update_body #>> '{message,text}','')) LIKE '激活地址%'",
].join('\n')

const addressPattern = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u
const activationCommand = /^激活地址\s*(.*?)\s*$/u
const transactionPattern = /^[a-f0-9]{64}$/iu

function signerSettings() {
  const token = process.env.TRON_SIGNER_TOKEN?.trim() ?? ''
  const environment = (process.env.APP_ENV ?? 'production').toLowerCase()
  const fallback = ['local', 'dev', 'development'].includes(environment) ? 'http://job:9501' : ''
  const configuredUrl = process.env.TRON_SIGNER_URL?.trim() || fallback
  if (token.length < 32 || !configuredUrl) throw new Error('signer_not_configured')
  const base = new URL(configuredUrl)
  if (base.protocol !== 'https:' && !['local', 'dev', 'development'].includes(environment)) throw new Error('signer_https_required')
  return { token, endpoint: new URL('/api/internal/tron/sign', base) }
}

async function reply(sendMessage: (message: ActivationMessage, text: string) => Promise<boolean>, message: ActivationMessage, text: string) {
  if (!(await sendMessage(message, text))) throw new Error('telegram_admin_activation_reply_failed')
}

export async function handleTelegramAdminActivation(options: {
  pool: Database
  fetcher: typeof fetch
  botRid: number
  updateRid: number
  message: ActivationMessage
  sendMessage: (message: ActivationMessage, text: string) => Promise<boolean>
}): Promise<'ignored' | 'replied'> {
  const { pool, fetcher, botRid, updateRid, message, sendMessage } = options
  const command = String(message.text ?? '').trim()
  if (!command.startsWith('激活地址')) return 'ignored'

  const wallets = await pool.query<Wallet>(
    'SELECT send_wallet,send_wallet_privatekey,tg_notice_obj_receive FROM t_transit_wallet WHERE bot_rid=$1 AND status=0 ORDER BY rid LIMIT 1',
    [botRid],
  )
  const wallet = wallets.rows[0]
  if (!wallet) {
    await reply(sendMessage, message, '机器人未配置闪兑钱包或者未启用,仅允许管理员执行,请检查数据')
    return 'replied'
  }
  const adminIds = (wallet.tg_notice_obj_receive ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (!adminIds.length || !adminIds.includes(String(message.chat.id))) {
    await reply(sendMessage, message, '闪兑钱包管理员不正确,仅允许管理员执行,请检查数据')
    return 'replied'
  }

  const address = activationCommand.exec(command)?.[1]?.trim() ?? ''
  if (!addressPattern.test(address)) {
    await reply(sendMessage, message, '格式错误，请输入格式：激活地址xxxxxxx\n\n比如  激活地址TYASr5UV6HEcXatwdFQfmL')
    return 'replied'
  }
  if (process.env.PLATFORM_TELEGRAM_ADDRESS_ACTIVATION_ACTIONS !== 'true') {
    await reply(sendMessage, message, '开发环境未启用地址激活转账操作。')
    return 'replied'
  }
  if (!wallet.send_wallet || !wallet.send_wallet_privatekey) {
    await reply(sendMessage, message, '未配置预支的钱包,联系管理员')
    return 'replied'
  }

  const { token, endpoint } = signerSettings()
  const tronGridUrl = new URL(`https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}`)
  const tronGridKey = process.env.TRONGRID_API_KEY?.trim()
  const accountResponse = await fetcher(tronGridUrl, {
    method: 'GET', headers: tronGridKey ? { 'TRON-PRO-API-KEY': tronGridKey } : {},
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  if (!accountResponse.ok) throw new Error('trongrid_account_lookup_failed')
  const accountBody = await accountResponse.json() as { success?: boolean; data?: unknown[] }
  if (accountBody.success !== true || !Array.isArray(accountBody.data)) throw new Error('trongrid_account_response_invalid')
  if (accountBody.data.length > 0) {
    await reply(sendMessage, message, `您的地址：${address}，已经激活，无需激活！`)
    return 'replied'
  }

  const reservation = await pool.query<{ update_rid: number }>(
    `INSERT INTO t_platform_telegram_address_activation(update_rid,bot_rid,target_address,state)
     VALUES($1,$2,$3,'signing') ON CONFLICT DO NOTHING RETURNING update_rid`,
    [updateRid, botRid, address],
  )
  if (!reservation.rows[0]) {
    const existing = await pool.query<Ledger>(
      'SELECT state,tx_hash FROM t_platform_telegram_address_activation WHERE bot_rid=$1 AND target_address=$2 LIMIT 1',
      [botRid, address],
    )
    const state = existing.rows[0]?.state
    if (state === 'succeeded') {
      await reply(sendMessage, message, `您的地址：${address}，激活交易已成功提交。`)
    } else {
      await reply(sendMessage, message, '该地址已有一笔激活交易正在核验或需要人工核对，请联系客服，避免重复转账。')
    }
    return 'replied'
  }

  try {
    const signerResponse = await fetcher(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        operation: 'transfer_trx', private_key_ciphertext: wallet.send_wallet_privatekey,
        from_address: wallet.send_wallet, to_address: address, amount: '1', permission_id: 0,
      }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    })
    if (!signerResponse.ok) throw new Error('signer_http_error')
    const signerBody = await signerResponse.json() as { code?: number; data?: { txid?: unknown } }
    const txid = String(signerBody.data?.txid ?? '')
    if (signerBody.code !== 200 || !transactionPattern.test(txid)) throw new Error('signer_result_ambiguous')
    await pool.query(
      "UPDATE t_platform_telegram_address_activation SET state='succeeded',tx_hash=$2,error_code=NULL,updated_at=now() WHERE update_rid=$1 AND state='signing'",
      [updateRid, txid],
    )
    await reply(sendMessage, message, `恭喜您，您的地址 ${address} 激活成功！`)
  } catch {
    // A signer request may have broadcast before its response was lost. Never retry it automatically.
    await pool.query(
      "UPDATE t_platform_telegram_address_activation SET state='manual',error_code='signer_result_ambiguous',updated_at=now() WHERE update_rid=$1 AND state='signing'",
      [updateRid],
    )
    await reply(sendMessage, message, '激活转账状态待核验，请联系客服处理，避免重复转账。')
  }
  return 'replied'
}
