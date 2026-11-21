import { constants, createPublicKey, publicEncrypt, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { can, identity, run, type Identity } from './api.server'
import { db } from './db.server'
import { BotServiceError } from './bot-service.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const base = 'admin.energy.platform'
const id = z.coerce.number().int().positive().max(2_147_483_647)
const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const
const platformNames: Record<number, string> = { 1: 'Neee.cc', 2: 'RentEnergysBot', 3: '自己质押代理', 4: 'trongas.io（已关闭）', 5: '机器人开发代理（已关闭）', 6: 'Sohu 搜狐', 7: 'NL-API' }
const canAccess = (user: Identity) => can(user, '能量管理', `${base}.index`) && can(user, '能量平台', `${base}.index`)
const permitted = (user: Identity, permission: string, action: string) => can(user, permission, `${base}.${action}`)
let publicKey: KeyObject | null = null
function encryptApiKey(value: string) {
  if (!publicKey) {
    const path = process.env.TRON_RSA_PUBLIC_KEY_PATH
    const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PUBLIC_KEY)?.replace(/\\n/g, '\n').trim()
    if (!raw) throw new Error('公钥未配置')
    publicKey = createPublicKey(raw)
  }
  const modulusBytes = Math.ceil((publicKey.asymmetricKeyDetails?.modulusLength || 2048) / 8)
  const maxPart = modulusBytes - 42
  const data = Buffer.from(value, 'utf8')
  if (!data.length || data.length > maxPart * 8) throw new RangeError('API 密钥长度超出存储限制')
  const encrypted: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += maxPart) encrypted.push(publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, data.subarray(offset, offset + maxPart)))
  return `v2:${Buffer.concat(encrypted).toString('base64')}`
}
function badOrigin(request: Request) {
  const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!expected || request.headers.get('origin') !== expected) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  return null
}
function parseBaseUrl() {
  const target = new URL(process.env.NL_API_BASE_URL || 'https://tgnl-home.hfz.pw')
  if (target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) throw new BotServiceError(503, 'NL-API 地址配置无效')
  return target.toString().replace(/\/$/, '')
}
async function readResponse(response: Response) {
  const value = await response.json().catch(() => null) as any
  if (!response.ok || !value || typeof value !== 'object') throw new BotServiceError(502, 'NL-API 暂时不可用')
  return value
}
const fields = {
  poll_group: z.enum(groups), platform_name: z.coerce.number().int().refine(value => value >= 1 && value <= 7),
  platform_uid: z.string().trim().max(100).default(''), permission_id: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  alert_platform_balance: z.string().regex(/^\d{1,20}(?:\.\d{1,6})?$/).default('0'),
  tg_notice_obj: z.string().trim().max(200).default(''), tg_notice_bot_rid: z.union([id, z.null()]),
  seq_sn: z.coerce.number().int().min(0).max(2_147_483_647).default(0), comments: z.string().trim().max(3000).default(''),
}
export function energyPlatformApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!canAccess(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    const url = new URL(request.url)
    if (request.method === 'GET') {
      if (url.searchParams.get('action') === 'options') {
        const bots = await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC')
        return Response.json({ bots: bots.rows, platformNames, groups }, { headers })
      }
      if (url.searchParams.get('action') === 'recharge-history') {
        if (!permitted(user, '修改能量平台', 'nlapi_recharge')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
        const rid = id.parse(url.searchParams.get('rid'))
        const result = await db.query('SELECT platform_name,platform_uid FROM t_energy_platform WHERE rid=$1', [rid])
        if (!result.rowCount) return Response.json({ message: '能量平台不存在' }, { status: 404, headers })
        if (Number(result.rows[0].platform_name) !== 7 || !result.rows[0].platform_uid) return Response.json({ message: '仅配置了 API 用户名的 NL-API 平台支持查询' }, { status: 400, headers })
        const target = new URL('/api/api-recharge-orders', parseBaseUrl())
        target.searchParams.set('apiUsername', result.rows[0].platform_uid)
        const response = await fetch(target, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000), redirect: 'error' })
        const payload = await readResponse(response)
        if (!payload.success || !Array.isArray(payload.data)) throw new BotServiceError(502, 'NL-API 充值记录返回异常')
        const orders = payload.data.slice(0, 10).map((item: any) => ({ order_id: String(item.id || ''), amount_trx: Number(item.amount_trx || 0), status: String(item.status || 'unknown'), status_text: ({ pending: '进行中', paid: '已成功', expired: '已过期', cancelled: '已取消' } as Record<string, string>)[item.status] || '未知', created_at: String(item.created_at || ''), expires_at: String(item.expires_at || ''), paid_at: item.paid_at || null }))
        return Response.json({ api_username: result.rows[0].platform_uid, orders }, { headers })
      }
      const input = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15), search: z.string().trim().max(100).default('') }).parse(Object.fromEntries(url.searchParams))
      const search = `%${input.search.replace(/[!%_]/g, c => `!${c}`)}%`
      const where = `($1='%%' OR COALESCE(p.platform_uid,'') ILIKE $1 ESCAPE '!')`
      const total = await db.query(`SELECT count(*)::int AS total FROM t_energy_platform p WHERE ${where}`, [search])
      const result = await db.query(`SELECT p.rid,p.poll_group,p.platform_name,p.status,p.platform_uid,p.permission_id,p.platform_balance::text AS platform_balance,p.alert_platform_balance::text AS alert_platform_balance,(NULLIF(BTRIM(p.platform_apikey),'') IS NOT NULL) AS api_key_configured,p.tg_notice_obj,p.tg_notice_bot_rid,b.bot_firstname,b.bot_username,p.seq_sn,to_char(p.last_alert_time,'YYYY-MM-DD HH24:MI:SS') AS last_alert_time,p.comments,to_char(p.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(p.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time FROM t_energy_platform p LEFT JOIN t_telegram_bot b ON b.rid=p.tg_notice_bot_rid WHERE ${where} ORDER BY p.rid DESC LIMIT $2 OFFSET $3`, [search, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({ rows: result.rows.map(row => ({ ...row, platform_name_label: platformNames[Number(row.platform_name)] || `未知平台(${row.platform_name})`, poll_group_label: `${row.poll_group} 组`, enabled: Number(row.status) === 0 })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize, canAdd: permitted(user, '添加能量平台', 'add'), canEdit: permitted(user, '修改能量平台', 'update'), canManageKey: permitted(user, '修改apikey', 'updateapikey'), canDelete: permitted(user, '删除能量平台', 'delete'), canChangeStatus: permitted(user, '修改能量平台', 'change_status'), canRecharge: permitted(user, '修改能量平台', 'nlapi_recharge') }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const originFailure = badOrigin(request); if (originFailure) return originFailure
    let body: any
    try { body = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const operation = z.object({ action: z.enum(['create','update','delete','status','api-key','nlapi-recharge']) }).parse(body).action
    const permission: [string,string] = operation === 'create' ? ['添加能量平台','add'] : operation === 'update' ? ['修改能量平台','update'] : operation === 'delete' ? ['删除能量平台','delete'] : operation === 'status' ? ['修改能量平台','change_status'] : operation === 'api-key' ? ['修改apikey','updateapikey'] : ['修改能量平台','nlapi_recharge']
    if (!permitted(user, permission[0], permission[1])) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
    if (operation === 'nlapi-recharge') {
      const input = z.object({ action: z.literal('nlapi-recharge'), rid: id, amount: z.coerce.number().int().min(1).max(1_000_000) }).strict().parse(body)
      const result = await db.query('SELECT platform_name,platform_uid FROM t_energy_platform WHERE rid=$1', [input.rid])
      if (!result.rowCount || Number(result.rows[0].platform_name) !== 7 || !result.rows[0].platform_uid) return Response.json({ message: 'NL-API 平台不存在或未配置用户名' }, { status: 400, headers })
      const target = new URL('/api/api-recharge-orders', parseBaseUrl())
      const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ apiUsername: result.rows[0].platform_uid, paymentAddress: 'TJdtCWfm4iaqcQVMJchrobkbP5Y9yqNpPf', amountTrx: input.amount, telegramChatId: null, telegramMessageId: null }), signal: AbortSignal.timeout(15_000), redirect: 'error' })
      const payload = await readResponse(response)
      if (!payload.success || !payload.data) throw new BotServiceError(502, String(payload.error || 'NL-API 充值下单失败'))
      const data = payload.data
      if (!data.orderId || !data.amountTrx || !data.expiresAt) throw new BotServiceError(502, 'NL-API 订单响应不完整')
      return Response.json({ ok: true, data: { order_id: data.orderId, api_username: result.rows[0].platform_uid, payment_address: data.paymentAddress || 'TJdtCWfm4iaqcQVMJchrobkbP5Y9yqNpPf', amount_trx: data.amountTrx, expires_at: data.expiresAt, created_at: data.createdAt, tron_uri: `tron:${data.paymentAddress || 'TJdtCWfm4iaqcQVMJchrobkbP5Y9yqNpPf'}?amount=${data.amountTrx}` } }, { headers })
    }
    if (operation === 'api-key') {
      const input = z.object({ action: z.literal('api-key'), rid: id, platform_apikey: z.string().trim().min(1).max(4000), permission_id: z.coerce.number().int().min(0).max(2_147_483_647).default(0) }).strict().parse(body)
      let encrypted: string
      try { encrypted = encryptApiKey(input.platform_apikey) } catch (error) { return Response.json({ message: error instanceof RangeError ? error.message : '服务端 RSA 公钥未配置' }, { status: error instanceof RangeError ? 400 : 503, headers }) }
      const changed = await db.query('UPDATE t_energy_platform SET platform_apikey=$2,permission_id=$3,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, encrypted, input.permission_id])
      if (!changed.rowCount) return Response.json({ message: '能量平台不存在' }, { status: 404, headers })
      await db.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id,'energy.platform.api-key',input.rid])
      return Response.json({ ok: true, message: 'API 密钥已加密保存' }, { headers })
    }
    if (operation === 'create' || operation === 'update') {
      const schema = z.object({ action: z.enum(['create','update']), ...(operation === 'update' ? { rid: id } : {}), ...fields, platform_apikey: z.string().trim().max(4000).optional() }).strict()
      const input = schema.parse(body)
      if (input.tg_notice_bot_rid !== null) { const bot = await db.query('SELECT rid FROM t_telegram_bot WHERE rid=$1', [input.tg_notice_bot_rid]); if (!bot.rowCount) return Response.json({ message: '通知机器人不存在' }, { status: 400, headers }) }
      let encrypted: string | null = null
      if (input.platform_apikey) { try { encrypted = encryptApiKey(input.platform_apikey) } catch (error) { return Response.json({ message: error instanceof RangeError ? error.message : '服务端 RSA 公钥未配置' }, { status: error instanceof RangeError ? 400 : 503, headers }) } }
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        let rid: number
        if (operation === 'create') {
          const created = await client.query(`INSERT INTO t_energy_platform(poll_group,platform_name,platform_uid,permission_id,alert_platform_balance,platform_apikey,tg_notice_obj,tg_notice_bot_rid,seq_sn,comments,create_time) VALUES($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,now()) RETURNING rid`, [input.poll_group,input.platform_name,input.platform_uid,input.permission_id,input.alert_platform_balance,encrypted,input.tg_notice_obj,input.tg_notice_bot_rid,input.seq_sn,input.comments])
          rid = created.rows[0].rid
        } else {
          const updated = await client.query(`UPDATE t_energy_platform SET poll_group=$2,platform_name=$3,platform_uid=NULLIF($4,''),alert_platform_balance=$5,tg_notice_obj=$6,tg_notice_bot_rid=$7,seq_sn=$8,comments=$9,update_time=now() WHERE rid=$1 RETURNING rid`, [input.rid,input.poll_group,input.platform_name,input.platform_uid,input.alert_platform_balance,input.tg_notice_obj,input.tg_notice_bot_rid,input.seq_sn,input.comments])
          if (!updated.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '能量平台不存在' }, { status: 404, headers }) }
          rid = updated.rows[0].rid
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id,`energy.platform.${operation}`,rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: operation === 'create' ? '能量平台已添加' : '能量平台已更新' }, { headers })
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (operation === 'status') {
      const input = z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict().parse(body)
      const changed = await db.query('UPDATE t_energy_platform SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid',[input.rid,input.enabled ? 0 : 1])
      if (!changed.rowCount) return Response.json({ message: '能量平台不存在' }, { status: 404, headers })
      await db.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id,'energy.platform.status',input.rid])
      return Response.json({ ok:true,message:'平台状态已更新' },{headers})
    }
    const input = z.object({ action: z.literal('delete'), rid: id }).strict().parse(body)
    const removed = await db.query('DELETE FROM t_energy_platform WHERE rid=$1 RETURNING rid',[input.rid])
    if (!removed.rowCount) return Response.json({ message: '能量平台不存在' },{status:404,headers})
    await db.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)',[user.id,'energy.platform.delete',input.rid])
    return Response.json({ok:true,message:'能量平台已删除'},{headers})
  })
}
