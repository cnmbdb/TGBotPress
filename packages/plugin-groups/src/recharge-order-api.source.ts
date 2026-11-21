import { z } from 'zod'
import type { DatabaseConnection as Pool } from '@tgbotpress/plugin-sdk'
type Identity = { id: string; name: string; roles: string[]; permissions: string[]; routes: string[] }
type Host = { db: Pick<Pool, 'query' | 'connect'>; identity: (request: Request) => Promise<Identity>; can: (user: Identity, permission: string, route: string) => boolean; run: (handler: () => Promise<Response>) => Promise<Response> }
export function createApi(host: Host) {
const { db, can, identity, run } = host

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const statusLabels: Record<number, string> = { 0: '待支付', 1: '已充值', 2: '已过期', 3: '会员取消' }

function rechargeOrderApi(request: Request) {
  return run(async () => {
    if (request.method !== 'GET') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const user = await identity(request)
    if (!can(user, '充值订单', 'admin.groupuser.rechargeorder.index')) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    const url = new URL(request.url)
    if (url.searchParams.get('action') === 'options') {
      const bots = await db.query(`SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC`)
      return Response.json({ bots: bots.rows }, { headers })
    }
    const input = z.object({
      page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
      search: z.string().trim().max(100).default(''),
      botRid: z.union([z.literal('all'), z.coerce.number().int().positive()]).default('all'),
    }).parse(Object.fromEntries(url.searchParams))
    const search = `%${input.search.replace(/[!%_]/g, char => `!${char}`)}%`
    const bot = input.botRid === 'all' ? null : input.botRid
    const where = "($1='%%' OR a.recharge_tg_username ILIKE $1 ESCAPE '!' OR a.recharge_tg_uid ILIKE $1 ESCAPE '!') AND ($2::int IS NULL OR a.bot_rid=$2)"
    const total = await db.query(`SELECT count(*)::int AS total FROM t_fms_recharge_order a WHERE ${where}`, [search, bot])
    const rows = await db.query(`SELECT a.rid, a.bot_rid, a.recharge_tg_uid, a.recharge_tg_username, a.recharge_coin_name,
      a.recharge_pay_price::text AS recharge_pay_price, a.need_pay_price::text AS need_pay_price, a.status,
      a.comments, to_char(a.create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time,
      to_char(a.update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time,
      to_char(a.expire_time, 'YYYY-MM-DD HH24:MI:SS') AS expire_time,
      to_char(a.cancel_time, 'YYYY-MM-DD HH24:MI:SS') AS cancel_time,
      to_char(a.complete_time, 'YYYY-MM-DD HH24:MI:SS') AS complete_time,
      a.tx_hash, b.bot_firstname, b.bot_username
      FROM t_fms_recharge_order a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid
      WHERE ${where} ORDER BY a.rid DESC LIMIT $3 OFFSET $4`, [search, bot, input.pageSize, (input.page - 1) * input.pageSize])
    return Response.json({ rows: rows.rows.map(row => ({ ...row, status_label: statusLabels[row.status] || `未知状态 (${row.status})` })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize }, { headers })
  })
}

return rechargeOrderApi
}
