import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const statusLabels: Record<number, string> = { 0: '待支付', 1: '待开通', 2: '已开通', 3: '已过期', 4: '会员取消', 5: '开通失败', 6: '开通中' }
const sourceLabels: Record<number, string> = { 1: '人工下单', 2: '自动下单' }
export function premiumOrderApi(request: Request) {
  return run(async () => {
    if (request.method !== 'GET') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const user = await identity(request), route = 'admin.premium.order.index'
    if (!can(user, '会员管理', route) || !can(user, '会员订单', route)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    const url = new URL(request.url)
    if (url.searchParams.get('action') === 'options') {
      const bots = await db.query('SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC')
      return Response.json({ bots: bots.rows }, { headers })
    }
    const input = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10),z.literal(15),z.literal(20),z.literal(30),z.literal(50),z.literal(100)])).default(15), username: z.string().trim().max(100).default(''), botRid: z.union([z.literal('all'),z.coerce.number().int().positive()]).default('all') }).parse(Object.fromEntries(url.searchParams))
    const username = '%' + input.username.replace(/[!%_]/g, char => '!' + char) + '%', botRid = input.botRid === 'all' ? null : input.botRid
    const where = "($1='%%' OR a.premium_tg_username ILIKE $1 ESCAPE '!') AND ($2::int IS NULL OR a.bot_rid=$2)"
    const total = await db.query(`SELECT count(*)::int AS total FROM t_premium_platform_order a WHERE ${where}`, [username, botRid])
    const result = await db.query(`SELECT a.rid, a.bot_rid, a.premium_platform_rid, a.buy_tg_uid, a.buy_tg_username, a.premium_tg_username, a.need_pay_usdt::text AS need_pay_usdt, a.premium_package_month, a.status, a.create_time, a.expire_time, a.cancel_time, a.complete_time, a.source_type, a.comments, b.bot_username FROM t_premium_platform_order a LEFT JOIN t_telegram_bot b ON a.bot_rid=b.rid WHERE ${where} ORDER BY a.rid DESC LIMIT $3 OFFSET $4`, [username, botRid, input.pageSize, (input.page - 1) * input.pageSize])
    const rows = result.rows.map(row => ({ ...row, status_label: statusLabels[Number(row.status)] || `未知状态 (${row.status})`, source_type_label: sourceLabels[Number(row.source_type)] || `未知来源 (${row.source_type})` }))
    return Response.json({ rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize }, { headers })
  })
}
