import type { Pool } from 'pg'
export type VerificationHost = {
 db: Pick<Pool, 'query' | 'connect'>
 cookie: (name: string, value: string, maxAge: number) => string
 cookies: (request: Request) => Record<string, string>
 digest: (value: string) => string
 equalTokens: (left: string, right: string) => boolean
 isToken: (value: unknown) => value is string
 sendVerifiedJoinNotification: (...args: any[]) => Promise<any>
}
export function createVerificationApi(host: VerificationHost) {
const { db, cookie, cookies, digest, equalTokens, isToken, sendVerifiedJoinNotification } = host
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
const cookieName = 'tg_telegram_verification'
type Verification = { rid: number; bot_rid: number; chat_id: string | null; user_id: string; verification_type: string; status: string; expires_at: Date | string; verification_message_id: number | null; mini_app_message_id: number | null; user_chat_id: string | null }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
function result(message: string, status = 200) { return Response.json({ message }, { status, headers }) }
function tokenFrom(request: Request) { const token = new URL(request.url).searchParams.get('verify'); return isToken(token) ? token : null }
function tokenPage(status: string, type: string, completeUrl: string) {
  const ready = status === 'pending'
  const content = ready
    ? `<div id="playcaptcha-root" data-complete-url="${escapeHtml(completeUrl)}" data-asset-base="/captcha/toys/"></div><div id="verification-feedback" role="status" aria-live="polite"></div>`
    : status === 'verified'
      ? '<section class="verification-state"><h1>验证已完成</h1><p>可以关闭此页面并返回 Telegram。</p></section>'
      : `<section class="verification-state"><h1>验证链接已失效</h1><p>${type === 'ad_challenge' ? '违规验证已超时，系统将按照群组策略执行永久封禁并移出群组。' : '请返回 Telegram 重新发起验证。'}</p></section>`
  const appScript = `<script>(()=>{const app=window.Telegram&&window.Telegram.WebApp;if(!app)return;app.ready();app.expand();app.setHeaderColor('#edf1f3');app.setBackgroundColor('#edf1f3');const feedback=document.getElementById('verification-feedback');if(feedback)new MutationObserver(()=>{if(feedback.textContent.includes('验证通过'))setTimeout(()=>app.close(),650)}).observe(feedback,{childList:true,characterData:true,subtree:true})})()</script>`
  const captchaScript = ready ? '<script src="/captcha/playcaptcha.js" defer></script>' : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="csrf-token" content="native-verification"><title>Telegram 人机验证</title><link rel="stylesheet" href="/captcha/playcaptcha.css"><script src="https://telegram.org/js/telegram-web-app.js"></script><style>:root{color-scheme:light;--clawcap-bg:#fff;--clawcap-ink:#17191c;--clawcap-muted:#69707a;--clawcap-accent:#176b87;--clawcap-action:#e34b55}*{box-sizing:border-box}html,body{min-height:100%;margin:0;background:#edf1f3;color:#17191c;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{min-height:100vh;min-height:var(--tg-viewport-stable-height,100svh);display:flex;align-items:flex-start;justify-content:center;padding:max(12px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(14px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));overflow-x:hidden}.verification-shell{display:flex;width:min(100%,430px);margin:auto;flex-direction:column;align-items:center}.verification-brand{width:100%;margin:0 0 12px;color:#4d5963;font-size:13px;text-align:center}#playcaptcha-root{display:flex;width:100%;align-items:flex-start;justify-content:center}.verification-state{padding:28px 24px;border:1px solid #d8dee2;border-radius:12px;background:#fff;text-align:center;box-shadow:0 12px 35px #18242d14}.verification-state h1{margin:0 0 8px;font-size:20px}.verification-state p{margin:0;color:#69707a;font-size:14px;line-height:1.6}#verification-feedback{width:100%;min-height:24px;margin-top:10px;color:#176b87;font-size:13px;text-align:center}@media(max-height:760px){:root{--captcha-mini-scale:.88}.verification-brand{margin-bottom:8px}}@media(max-width:380px){:root{--captcha-mini-scale:.82}}@media(max-height:660px){:root{--captcha-mini-scale:.78}.verification-brand{font-size:12px}}</style>${captchaScript}</head><body><main class="verification-shell"><p class="verification-brand">Telegram 安全验证</p>${content}</main>${appScript}</body></html>`
}
async function telegram(botToken: string, method: string, payload: Record<string, unknown>) {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return { ok: false, description: '当前开发环境 Telegram 操作已关闭' }
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(12_000) })
    return await response.json() as { ok?: boolean; description?: string }
  } catch { return { ok: false, description: 'Telegram 接口暂时无法连接' } }
}
async function audit(row: Verification, status: 'passed' | 'failed', promptMessageId: number | null) {
  const prefix = row.verification_type === 'ad_challenge' ? 'ad' : row.verification_type
  await db.query(`INSERT INTO t_telegram_moderation_log(bot_rid,chat_id,user_id,message_id,event_type,action,score,reasons,content_preview,create_time)
    VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,now())`, [row.bot_rid, row.chat_id, row.user_id, promptMessageId, `${prefix}_verification_${status}`.slice(0, 40), status, status === 'passed' ? '用户已完成人机验证' : 'Telegram 放行失败', `验证记录 #${row.rid}`])
}
async function telegramVerificationApi(request: Request) {
  const token = tokenFrom(request)
  if (!token) return result('验证链接不存在。', 404)
  const tokenHash = digest(token)
  if (request.method === 'GET') {
    const found = await db.query<Verification>('SELECT rid,bot_rid,chat_id::text,user_id::text,verification_type,status,expires_at,verification_message_id,mini_app_message_id,user_chat_id::text FROM t_telegram_verification WHERE token_hash=$1 LIMIT 1', [tokenHash])
    const row = found.rows[0]
    if (!row) return result('验证链接不存在。', 404)
    const expired = row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now()
    const displayStatus = expired ? 'expired' : row.status
    const origin = process.env.PLATFORM_ORIGIN
    if (!origin) return result('验证服务地址尚未配置。', 503)
    const completeUrl = new URL('/api/moderation?verify=' + encodeURIComponent(token), new URL(origin).origin).toString()
    const response = new Response(tokenPage(displayStatus, row.verification_type, completeUrl), { status: ['expired', 'expiring'].includes(displayStatus) ? 410 : 200, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } })
    if (displayStatus === 'pending') {
      const remaining = Math.max(1, Math.min(86400, Math.floor((new Date(row.expires_at).getTime() - Date.now()) / 1000)))
      response.headers.append('Set-Cookie', cookie(cookieName, tokenHash, remaining))
    }
    return response
  }
  if (request.method !== 'POST') return result('请求方法不支持。', 405)
  const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!origin || request.headers.get('origin') !== origin || !request.headers.get('content-type')?.startsWith('application/json')) return result('请求来源无效。', 403)
  const gate = cookies(request)[cookieName]
  if (!gate || !equalTokens(gate, tokenHash) || request.headers.get('x-csrf-token') !== 'native-verification') return result('验证会话已失效，请重新打开验证链接。', 419)
  const client = await db.connect()
  let verification: Verification | undefined
  try {
    await client.query('BEGIN')
    const found = await client.query<Verification>('SELECT rid,bot_rid,chat_id::text,user_id::text,verification_type,status,expires_at,verification_message_id,mini_app_message_id,user_chat_id::text FROM t_telegram_verification WHERE token_hash=$1 FOR UPDATE', [tokenHash])
    verification = found.rows[0]
    if (!verification) { await client.query('ROLLBACK'); return result('验证链接不存在。', 404) }
    if (verification.status === 'verified') { await client.query('COMMIT'); return result('验证已经完成。') }
    if (verification.status !== 'pending' || new Date(verification.expires_at).getTime() <= Date.now()) { await client.query('ROLLBACK'); return result('验证链接已失效。', 410) }
    if (!['join_request', 'join_member', 'ad_challenge', 'support'].includes(verification.verification_type)) { await client.query('ROLLBACK'); return result('此验证类型尚未迁移。', 409) }
    await client.query("UPDATE t_telegram_verification SET status='processing',update_time=now() WHERE rid=$1", [verification.rid])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  if (!verification) return result('验证链接不存在。', 404)

  const bot = await db.query<{ bot_token: string; bot_username: string | null; bot_admin_username: string | null }>('SELECT bot_token,bot_username,bot_admin_username FROM t_telegram_bot WHERE rid=$1', [verification.bot_rid])
  const botToken = bot.rows[0]?.bot_token
  if (!botToken) {
    await db.query("UPDATE t_telegram_verification SET status='pending',update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid])
    return result('机器人配置不存在。', 404)
  }
  if (verification.verification_type === 'support') {
    const settings = await db.query<{ support_verified_minutes: number }>('SELECT support_verified_minutes FROM t_telegram_bot_moderation_config WHERE bot_rid=$1 AND support_enabled=true', [verification.bot_rid])
    if (!verification.user_chat_id || !settings.rows[0]) {
      await db.query("UPDATE t_telegram_verification SET status='pending',update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid])
      return result('客服会话已关闭或机器人配置已停用。', 409)
    }
    await db.query("UPDATE t_telegram_verification SET status='verified',verified_at=now(),expires_at=now()+($2::text||' minutes')::interval,update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid, Math.max(5, Number(settings.rows[0].support_verified_minutes) || 1440)])
    await audit(verification, 'passed', verification.verification_message_id)
    if (verification.verification_message_id) void telegram(botToken, 'deleteMessage', { chat_id: verification.user_chat_id, message_id: verification.verification_message_id })
    void telegram(botToken, 'sendMessage', { chat_id: verification.user_chat_id, text: '验证通过，客服会话已开启。请直接发送文字、图片或文件；发送 /endsupport 可结束会话。' })
    const response = result('验证通过，客服会话已开启。')
    response.headers.append('Set-Cookie', cookie(cookieName, '', 0))
    return response
  }
  const payload = { chat_id: verification.chat_id, user_id: verification.user_id }
  const telegramResult = verification.verification_type === 'join_request'
    ? await telegram(botToken, 'approveChatJoinRequest', payload)
    : await telegram(botToken, 'restrictChatMember', { ...payload, permissions: { can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,can_react_to_messages:true,can_edit_tag:true,can_change_info:true,can_invite_users:true,can_pin_messages:true,can_manage_topics:true }, use_independent_chat_permissions: true })
  if (!telegramResult.ok) {
    await db.query("UPDATE t_telegram_verification SET status='pending',update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid])
    await audit(verification, 'failed', verification.verification_message_id)
    return result(`Telegram 放行失败：${telegramResult.description || '请求失败，请稍后重试。'}`, 502)
  }
  await db.query("UPDATE t_telegram_verification SET status='verified',verified_at=now(),update_time=now() WHERE rid=$1 AND status='processing'", [verification.rid])
  if (verification.verification_type === 'ad_challenge') await db.query("UPDATE t_telegram_moderated_member SET status='released',update_time=now() WHERE bot_rid=$1 AND chat_id=$2 AND user_id=$3 AND status='active'", [verification.bot_rid, verification.chat_id, verification.user_id])
  await audit(verification, 'passed', verification.verification_message_id)
  const promptChatId = ['join_request','support'].includes(verification.verification_type) ? verification.user_chat_id : verification.chat_id
  if (verification.verification_message_id && promptChatId) void telegram(botToken, 'deleteMessage', { chat_id: promptChatId, message_id: verification.verification_message_id })
  if (verification.mini_app_message_id && verification.user_chat_id) void telegram(botToken, 'deleteMessage', { chat_id: verification.user_chat_id, message_id: verification.mini_app_message_id })
  if (['join_member', 'join_request'].includes(verification.verification_type) && verification.chat_id) {
    try {
      const notified = await sendVerifiedJoinNotification({ pool: db, fetcher: fetch, botRid: verification.bot_rid, token: botToken, bot: bot.rows[0], chatId: verification.chat_id, userId: verification.user_id })
      if (!notified) await telegram(botToken, 'sendMessage', { chat_id: verification.chat_id, text: '验证通过，欢迎加入。', allow_sending_without_reply: true })
    } catch { /* A welcome-message failure must not undo Telegram approval or completed verification. */ }
  }
  const response = result('验证通过，可以返回 Telegram。')
  response.headers.append('Set-Cookie', cookie(cookieName, '', 0))
  return response
}

return telegramVerificationApi
}
