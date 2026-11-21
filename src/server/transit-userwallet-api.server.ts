import { z } from 'zod'
import { can, identity, run } from './api.server'
import { db } from './db.server'
import { units, formatUnits } from '@tgbotpress/plugin-transit/units.js'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const money = z.string().trim().regex(/^\d{1,12}(?:\.\d{1,4})?$/, '金额最多 12 位整数和 4 位小数')
const base = 'admin.transit.userwallet'
const access = (user: Awaited<ReturnType<typeof identity>>) => can(user, '闪兑管理', `${base}.index`) && can(user, '闪兑用户', `${base}.index`)
const allowed = (user: Awaited<ReturnType<typeof identity>>, permission: string, action: string) => can(user, permission, `${base}.${action}`)
function originError(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  return null
}

export function transitUserWalletApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!access(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    if (request.method === 'GET') {
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        wallet: z.string().trim().max(200).default(''),
      }).parse(Object.fromEntries(new URL(request.url).searchParams))
      const pattern = `%${input.wallet.replace(/[!%_]/g, char => `!${char}`)}%`
      const where = `($1 = '%%' OR COALESCE(wallet_addr,'') ILIKE $1 ESCAPE '!')`
      const total = await db.query(`SELECT count(*)::int AS total FROM t_transit_user_wallet WHERE ${where}`, [pattern])
      const result = await db.query(`SELECT rid, chain_type, wallet_addr, total_transit_usdt, total_transit_sxf,
        total_yuzhi_sxf, need_feedback_sxf, send_feedback_sxf,
        to_char(last_transit_time, 'YYYY-MM-DD HH24:MI:SS') AS last_transit_time,
        to_char(last_yuzhi_time, 'YYYY-MM-DD HH24:MI:SS') AS last_yuzhi_time
        FROM t_transit_user_wallet WHERE ${where} ORDER BY rid DESC LIMIT $2 OFFSET $3`, [pattern, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({ rows: result.rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize,
        canAdd: allowed(user, '添加预支', 'add'), canAdjust: allowed(user, '修改预支', 'update') }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const badOrigin = originError(request)
    if (badOrigin) return badOrigin
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), chain_type: z.literal('trc'), wallet_addr: z.string().trim().min(1).max(200), yuzhi_sxf: money }).strict(),
      z.object({ action: z.literal('adjust'), rid: id, yuzhi_sxf: money }).strict(),
    ]).parse(body)
    const permission = action.action === 'create' ? ['添加预支', 'add'] : ['修改预支', 'update']
    if (!allowed(user, permission[0], permission[1])) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
    const addition = units(action.yuzhi_sxf)
    if (addition === null || addition <= 0n) return Response.json({ message: '预支金额必须大于 0' }, { status: 400, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      let resourceId: number
      if (action.action === 'create') {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`trc:${action.wallet_addr}`])
        const existing = await client.query('SELECT rid FROM t_transit_user_wallet WHERE wallet_addr=$1 AND chain_type=$2 LIMIT 1', [action.wallet_addr, action.chain_type])
        if (existing.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '钱包已存在，请在原记录中调整预支' }, { status: 409, headers }) }
        const created = await client.query(`INSERT INTO t_transit_user_wallet(chain_type,wallet_addr,total_yuzhi_sxf,need_feedback_sxf,last_yuzhi_time)
          VALUES($1,$2,$3,$3,now()) RETURNING rid`, [action.chain_type, action.wallet_addr, action.yuzhi_sxf])
        resourceId = created.rows[0].rid
      } else {
        const current = await client.query('SELECT rid,total_yuzhi_sxf FROM t_transit_user_wallet WHERE rid=$1 FOR UPDATE', [action.rid])
        if (!current.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '闪兑用户记录不存在' }, { status: 404, headers }) }
        const currentTotal = units(String(current.rows[0].total_yuzhi_sxf ?? '0'), 190)
        if (currentTotal === null) { await client.query('ROLLBACK'); return Response.json({ message: '原预支总额格式异常，无法安全调整' }, { status: 409, headers }) }
        const total = formatUnits(currentTotal + addition)
        if (total.length > 200) { await client.query('ROLLBACK'); return Response.json({ message: '预支总额超出存储范围' }, { status: 400, headers }) }
        const updated = await client.query(`UPDATE t_transit_user_wallet SET total_yuzhi_sxf=$2, need_feedback_sxf=$3, last_yuzhi_time=now() WHERE rid=$1 RETURNING rid`, [action.rid, total, action.yuzhi_sxf])
        resourceId = updated.rows[0].rid
      }
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, action.action === 'create' ? 'transit.userwallet.advance.create' : 'transit.userwallet.advance.adjust', resourceId])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: action.action === 'create' ? '预支记录已添加' : '预支金额已调整' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })
}
