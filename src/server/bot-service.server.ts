import { createHash, createHmac } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'

export class BotServiceError extends Error { constructor(public status: number, message: string) { super(message) } }
type Queryable = Pick<PoolClient, 'query'>
type Bot = { rid: number; bot_token: string; bot_username: string | null; bot_firstname: string | null }
type TelegramResult = { id?: number; first_name?: string; username?: string; [key: string]: unknown }
export type BotDependencies = { invalidate: (rid: number) => Promise<void>; telegram: (token: string, method: 'getMe' | 'setWebhook' | 'setMyCommands', data?: Record<string, unknown>) => Promise<TelegramResult>; templateRid: number; autoClone: boolean }

export function webhookSecret(rid: number, token: string, configuredKey: string, appKey: string) {
  if (rid <= 0 || !token) throw new BotServiceError(400, '机器人令牌未配置')
  let key: Buffer | string = configuredKey.trim()
  if (key && key.length < 32) throw new BotServiceError(503, 'Webhook 安全密钥未配置完整')
  if (!key) {
    const raw = appKey.startsWith('base64:') ? Buffer.from(appKey.slice(7), 'base64') : Buffer.from(appKey)
    if (raw.length < 32) throw new BotServiceError(503, 'Webhook 安全密钥未配置完整')
    key = createHmac('sha256', raw).update('telegram-webhook-master:v1').digest()
  }
  return createHmac('sha256', key).update(`${rid}:${token}`).digest('hex')
}
export function configuredWebhookOrigin(values: { telegramWebhookOrigin?: string; webhookPublicOrigin?: string; webUrl?: string; platformOrigin?: string; appUrl?: string }) {
  return [values.telegramWebhookOrigin, values.webhookPublicOrigin, values.webUrl, values.platformOrigin, values.appUrl].map(value => value?.trim() ?? '').find(Boolean) ?? ''
}
export function configuredWebhookUrl(base: string, rid: number) {
  let url: URL
  try { url = new URL(base) } catch { throw new BotServiceError(503, '请配置 WEB_URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && !['443','80','88','8443'].includes(url.port))) throw new BotServiceError(400, 'WEB_URL 必须是使用受支持端口的 HTTPS 地址')
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/telegram/getdata`
  url.searchParams.set('rid', String(rid))
  return url.href
}
export async function invalidateLegacyBotCache(rid: number) {
  const directory = process.env.LEGACY_CACHE_PATH
  if (!directory) {
    if (process.env.PLATFORM_LEGACY_CACHE_REQUIRED !== 'false') throw new BotServiceError(503, '兼容缓存目录尚未配置')
    return
  }
  for (const key of [`telegram_bot_bot_${rid}`, `telegram_bot_keyreply_${rid}`]) {
    const hash = createHash('sha1').update(key).digest('hex')
    try { await unlink(join(directory, hash.slice(0,2), hash.slice(2,4), hash)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new BotServiceError(503, '兼容缓存暂时无法刷新') }
  }
}
export async function telegramRequest(token: string, method: 'getMe' | 'setWebhook' | 'setMyCommands', data: Record<string, unknown> = {}): Promise<TelegramResult> {
  if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') throw new BotServiceError(409, '当前开发环境未启用外部机器人操作')
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new BotServiceError(400, '机器人令牌未配置或格式无效')
  let response: Response
  try { response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data), signal:AbortSignal.timeout(10_000) }) }
  catch { throw new BotServiceError(502, 'Telegram 暂时无法连接') }
  let body: { ok?: boolean; result?: TelegramResult; description?: string; error_code?: number }
  try { body = await response.json() } catch { throw new BotServiceError(502, 'Telegram 返回了无效响应') }
  // Do not pass upstream descriptions through: they can contain credentials or untrusted text.
  if (!response.ok || !body.ok) {
    if (body.error_code === 401) throw new BotServiceError(502, 'Telegram 已拒绝此机器人令牌（401 Unauthorized），请在机器人设置中更新有效令牌')
    throw new BotServiceError(502, 'Telegram 操作失败，请检查机器人令牌与网络')
  }
  return body.result && typeof body.result === 'object' ? body.result : {}
}
export const defaultBotDependencies = (): BotDependencies => ({ invalidate: invalidateLegacyBotCache, telegram: telegramRequest, templateRid: Number(process.env.TG_BOT_TEMPLATE_RID || 1), autoClone: process.env.TG_BOT_AUTO_CLONE_CONFIG !== 'false' })

export async function cloneBotConfiguration(client: Queryable, from: number, to: number, force: boolean) {
  if (from === to) throw new BotServiceError(400, '来源机器人和目标机器人不能相同')
  const locked = await client.query<Bot>('SELECT rid FROM t_telegram_bot WHERE rid=ANY($1::int[]) ORDER BY rid FOR UPDATE', [[from,to]])
  if (locked.rowCount !== 2) throw new BotServiceError(404, '来源或目标机器人不存在')
  if (!force) {
    const found = await client.query('SELECT EXISTS(SELECT 1 FROM t_telegram_bot_command WHERE bot_rid=$1 UNION ALL SELECT 1 FROM t_telegram_bot_keyreply WHERE bot_rid=$1 UNION ALL SELECT 1 FROM t_telegram_bot_ad WHERE bot_rid=$1) AS found',[to])
    if (found.rows[0].found) throw new BotServiceError(409, '目标机器人已有配置，请选择覆盖后重试')
  } else {
    for (const table of ['t_telegram_bot_keyreply_keyboard','t_telegram_bot_ad_keyboard','t_telegram_bot_command','t_telegram_bot_keyreply','t_telegram_bot_ad']) await client.query(`DELETE FROM ${table} WHERE bot_rid=$1`,[to])
  }
  const commands=await client.query(`INSERT INTO t_telegram_bot_command(bot_rid,command,description,command_type,seq_sn,create_by,create_time,update_by,update_time) SELECT $2,command,description,command_type,seq_sn,create_by,now(),update_by,now() FROM t_telegram_bot_command WHERE bot_rid=$1`,[from,to])
  const replies=await client.query('SELECT * FROM t_telegram_bot_keyreply WHERE bot_rid=$1 ORDER BY rid',[from])
  const replyMap=new Map<number,number>()
  for (const row of replies.rows) {
    const inserted=await client.query(`INSERT INTO t_telegram_bot_keyreply(bot_rid,key_type,monitor_word,reply_photo,reply_content,opt_type,status,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,now()) RETURNING rid`,[to,row.key_type,row.monitor_word,row.reply_photo,row.reply_content,row.opt_type,row.status,row.create_by,row.update_by])
    replyMap.set(row.rid,inserted.rows[0].rid)
  }
  const replyBoards=await client.query('SELECT * FROM t_telegram_bot_keyreply_keyboard WHERE bot_rid=$1 ORDER BY rid',[from])
  let replyBoardCount=0
  for(const row of replyBoards.rows) { const target=replyMap.get(row.keyreply_rid); if(!target) continue; await client.query(`INSERT INTO t_telegram_bot_keyreply_keyboard(bot_rid,keyreply_rid,keyboard_rid,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$5,now())`,[to,target,row.keyboard_rid,row.create_by,row.update_by]); replyBoardCount++ }
  const ads=await client.query('SELECT * FROM t_telegram_bot_ad WHERE bot_rid=$1 ORDER BY rid',[from])
  const adMap=new Map<number,number>()
  for (const row of ads.rows) {
    const inserted=await client.query(`INSERT INTO t_telegram_bot_ad(bot_rid,notice_cycle,notice_obj,notice_photo,notice_ad,status,last_notice_time,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,now()) RETURNING rid`,[to,row.notice_cycle,row.notice_obj,row.notice_photo,row.notice_ad,row.status,row.last_notice_time,row.create_by,row.update_by])
    adMap.set(row.rid,inserted.rows[0].rid)
  }
  const adBoards=await client.query('SELECT * FROM t_telegram_bot_ad_keyboard WHERE bot_rid=$1 ORDER BY rid',[from])
  let adBoardCount=0
  for(const row of adBoards.rows) { const target=adMap.get(row.ad_rid); if(!target) continue; await client.query(`INSERT INTO t_telegram_bot_ad_keyboard(bot_rid,ad_rid,keyboard_rid,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$5,now())`,[to,target,row.keyboard_rid,row.create_by,row.update_by]); adBoardCount++ }
  return { commands:commands.rowCount || 0, replies:replyMap.size, replyKeyboards:replyBoardCount, ads:adMap.size, adKeyboards:adBoardCount }
}
export async function deleteBotConfiguration(client: Queryable, rid: number) {
  const found=await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[rid])
  if(!found.rowCount) throw new BotServiceError(404,'机器人不存在')
  const keys=await client.query('SELECT keyboard_rid FROM t_telegram_bot_keyreply_keyboard WHERE bot_rid=$1',[rid])
  for(const table of ['t_telegram_bot_keyreply_keyboard','t_telegram_bot_ad_keyboard','t_telegram_bot_keyreply','t_telegram_bot_ad','t_telegram_bot_command','t_telegram_bot_group','t_telegram_bot_user','t_collection_wallet','t_transit_wallet','t_energy_platform_bot']) await client.query(`DELETE FROM ${table} WHERE bot_rid=$1`,[rid])
  for(const table of ['t_telegram_moderation_log','t_telegram_group_message_history','t_telegram_support_message','t_telegram_verification','t_telegram_bot_group_policy','t_telegram_bot_moderation_config']) {
    const exists=await client.query('SELECT to_regclass($1) AS name',[table]); if(exists.rows[0].name) await client.query(`DELETE FROM ${table} WHERE bot_rid=$1`,[rid])
  }
  if(keys.rowCount) await client.query(`DELETE FROM t_telegram_bot_keyboard k WHERE k.rid=ANY($1::int[]) AND NOT EXISTS(SELECT 1 FROM t_telegram_bot_keyreply_keyboard r WHERE r.keyboard_rid=k.rid) AND NOT EXISTS(SELECT 1 FROM t_telegram_bot_ad_keyboard a WHERE a.keyboard_rid=k.rid)`,[keys.rows.map(row=>row.keyboard_rid)])
  await client.query('DELETE FROM t_telegram_bot WHERE rid=$1',[rid])
}

export class BotService {
  constructor(private pool: Pool, private dependencies: BotDependencies = defaultBotDependencies()) {}
  async detail(rid: number) {
    const result=await this.pool.query(`SELECT rid,bot_token,bot_admin_username,bot_firstname,bot_username,comments,recharge_wallet_addr,to_char(get_tx_time,'YYYY-MM-DD"T"HH24:MI') AS get_tx_time FROM t_telegram_bot WHERE rid=$1`,[rid])
    if(!result.rowCount) throw new BotServiceError(404,'机器人不存在')
    return result.rows[0]
  }
  async options() { return (await this.pool.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid LIMIT 2000')).rows }
  private async transaction<T>(rid: number | undefined, actor: string, action: string, work: (client: PoolClient) => Promise<T>) {
    const client=await this.pool.connect()
    let committed=false
    try {
      await client.query('BEGIN')
      const result=await work(client)
      const resource=rid ?? (result as {rid?:number}).rid
      if(resource) await this.dependencies.invalidate(resource)
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[actor,`telegram.bot.${action}`,resource || null])
      await client.query('COMMIT'); committed=true
      if(resource) { try { await this.dependencies.invalidate(resource) } catch { console.error('Bot cache post-commit invalidation failed') } }
      return result
    } catch(error) { if(!committed) await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async add(data: {bot_token:string;bot_admin_username:string;comments:string;clone_from_rid?:number}, actor:string) {
    return this.transaction(undefined,actor,'add',async client=> {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('tg-bot-token:' || $1,0))",[data.bot_token])
      if((await client.query('SELECT rid FROM t_telegram_bot WHERE bot_token=$1',[data.bot_token])).rowCount) throw new BotServiceError(409,'机器人已存在')
      const inserted=await client.query('INSERT INTO t_telegram_bot(bot_token,bot_admin_username,comments,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$4,now()) RETURNING rid',[data.bot_token,data.bot_admin_username,data.comments,actor])
      const rid=inserted.rows[0].rid
      if(this.dependencies.autoClone) { const source=data.clone_from_rid || this.dependencies.templateRid; if(source>0 && source!==rid) await cloneBotConfiguration(client,source,rid,false) }
      return {rid}
    })
  }
  async update(rid:number,data:{bot_token?:string;bot_admin_username:string;comments:string},actor:string) {
    const current=await this.pool.query<{bot_token:string}>('SELECT bot_token FROM t_telegram_bot WHERE rid=$1',[rid])
    if(!current.rowCount) throw new BotServiceError(404,'机器人不存在')
    const replacementToken=data.bot_token?.trim() || ''
    const token=replacementToken || current.rows[0].bot_token
    const tokenChanged=token!==current.rows[0].bot_token
    const identity=tokenChanged ? await this.dependencies.telegram(token,'getMe') : null
    if(tokenChanged && (typeof identity?.first_name!=='string' || typeof identity.username!=='string')) throw new BotServiceError(502,'Telegram 返回的机器人信息无效')

    return this.transaction(rid,actor,'update',async client=> {
      const found=await client.query('SELECT bot_token FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[rid]); if(!found.rowCount) throw new BotServiceError(404,'机器人不存在')
      if(found.rows[0].bot_token!==current.rows[0].bot_token) throw new BotServiceError(409,'机器人令牌已更改，请刷新后重试')
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('tg-bot-token:' || $1,0))",[token])
      if((await client.query('SELECT rid FROM t_telegram_bot WHERE bot_token=$1 AND rid<>$2',[token,rid])).rowCount) throw new BotServiceError(409,'机器人已存在')
      await client.query('UPDATE t_telegram_bot SET bot_token=$2,bot_firstname=COALESCE($3,bot_firstname),bot_username=COALESCE($4,bot_username),bot_admin_username=$5,comments=$6,update_by=$7,update_time=now() WHERE rid=$1',[rid,token,identity?.first_name ?? null,identity?.username ?? null,data.bot_admin_username,data.comments,actor])
      return {rid}
    })
  }
  async clone(rid:number,source:number|undefined,force:boolean,actor:string) { return this.transaction(rid,actor,'clone_config',client=>cloneBotConfiguration(client,source || this.dependencies.templateRid,rid,force)) }
  async remove(rid:number,actor:string) { return this.transaction(rid,actor,'delete',async client=> { await deleteBotConfiguration(client,rid); return {rid} }) }
  async recharge(rid:number,address:string,date:string,actor:string) {
    return this.transaction(rid,actor,'recharge',async client=> {
      if(!(await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1 FOR UPDATE',[rid])).rowCount) throw new BotServiceError(404,'机器人不存在')
      if(address) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('tg-wallet:' || $1,0))",[address])
        if((await client.query('SELECT rid FROM t_telegram_bot WHERE recharge_wallet_addr=$1 AND rid<>$2',[address,rid])).rowCount) throw new BotServiceError(409,'充值钱包地址已存在')
        for(const [table,message] of [['t_energy_platform_bot','不能与能量钱包地址相同'],['t_premium_platform','不能与会员钱包地址相同'],['t_transit_wallet','不能与闪兑钱包地址相同']]) if((await client.query(`SELECT rid FROM ${table} WHERE receive_wallet=$1 LIMIT 1`,[address])).rowCount) throw new BotServiceError(409,message)
      }
      await client.query('UPDATE t_telegram_bot SET recharge_wallet_addr=$2,get_tx_time=$3::timestamp,update_by=$4,update_time=now() WHERE rid=$1',[rid,address || null,date ? date.replace('T',' ') : null,actor])
      return {rid}
    })
  }
  async refresh(rid:number,actor:string) {
    const bot=await this.detail(rid)
    const result=await this.dependencies.telegram(bot.bot_token,'getMe')
    if(typeof result.first_name!=='string' || typeof result.username!=='string') throw new BotServiceError(502,'Telegram 返回的机器人信息无效')
    return this.transaction(rid,actor,'refresh',async client=> {
      const updated=await client.query('UPDATE t_telegram_bot SET bot_firstname=$2,bot_username=$3,update_by=$4,update_time=now() WHERE rid=$1 AND bot_token=$5',[rid,result.first_name,result.username,actor,bot.bot_token])
      if(!updated.rowCount) throw new BotServiceError(409,'机器人令牌已更改，请刷新后重试')
      return {rid}
    })
  }
  async webhook(rid:number,actor:string) {
    if(process.env.PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY!=='true') throw new BotServiceError(503,'Telegram 更新接收尚未启用，暂不能注册 Webhook')
    const bot=await this.detail(rid)
    const platformOrigin = process.env.PLATFORM_ORIGIN || ''
    const url = configuredWebhookUrl(configuredWebhookOrigin({ telegramWebhookOrigin: process.env.TELEGRAM_WEBHOOK_ORIGIN, webhookPublicOrigin: process.env.WEBHOOK_PUBLIC_ORIGIN, webUrl: process.env.WEB_URL, platformOrigin }), rid)
    const secret=webhookSecret(rid,bot.bot_token,process.env.TELEGRAM_WEBHOOK_SECRET_KEY || '',process.env.APP_KEY || '')
    await this.dependencies.telegram(bot.bot_token,'setWebhook',{ url,secret_token:secret,allowed_updates:['message','edited_message','callback_query','my_chat_member','chat_member','chat_join_request'] })
    await this.pool.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[actor,'telegram.bot.webhook',rid])
    return {rid}
  }
}
