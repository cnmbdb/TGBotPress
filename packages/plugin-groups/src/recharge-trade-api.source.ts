import { z } from 'zod'
import type { DatabaseConnection as Pool } from '@tgbotpress/plugin-sdk'
type Identity = { id: string; name: string; roles: string[]; permissions: string[]; routes: string[] }
type Host = { db: Pick<Pool, 'query' | 'connect'>; identity: (request: Request) => Promise<Identity>; can: (user: Identity, permission: string, route: string) => boolean; run: (handler: () => Promise<Response>) => Promise<Response> }
export function createApi(host: Host) {
const { db, can, identity, run } = host

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const statuses: Record<number, string> = { 1: '待充值', 7: '金额无对应订单', 8: '充值中', 9: '充值成功', 4: '充值失败', 2: '人工禁止', 3: '找不到用户' }
const stoppable = [1, 4, 7, 3]

function rechargeTradeApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!can(user, '充值交易', 'admin.groupuser.rechargetrade.index')) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        txHash: z.string().trim().max(100).default(''),
        fromAddress: z.string().trim().max(200).default(''),
        toAddress: z.string().trim().max(200).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const pattern = (value: string) => `%${value.replace(/[!%_]/g, char => `!${char}`)}%`
      const values = [pattern(input.txHash), pattern(input.fromAddress), pattern(input.toAddress)]
      const where = "tx_hash ILIKE $1 ESCAPE '!' AND transferfrom_address ILIKE $2 ESCAPE '!' AND transferto_address ILIKE $3 ESCAPE '!'"
      const total = await db.query(`SELECT count(*)::int AS total FROM t_fms_wallet_trade_list WHERE ${where}`, values)
      const rows = await db.query(`SELECT rid, tx_hash, transferfrom_address, transferto_address, coin_name, amount,
        to_char(to_timestamp(NULLIF("timestamp", '')::numeric / 1000) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') AS timestamp,
        process_status, to_char(process_time, 'YYYY-MM-DD HH24:MI:SS') AS process_time, process_comments, to_char(get_time, 'YYYY-MM-DD HH24:MI:SS') AS get_time, recharge_order_rid
        FROM t_fms_wallet_trade_list WHERE ${where} ORDER BY rid DESC LIMIT $4 OFFSET $5`, [...values, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({ rows: rows.rows.map(row => ({ ...row, process_status_label: statuses[row.process_status] || `未知状态 (${row.process_status})`, canStop: stoppable.includes(row.process_status) })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize, canStop: can(user, '禁止充值', 'admin.groupuser.rechargetrade.stoporder') }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
    if (!origin || request.headers.get('origin') !== origin || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
    if (!can(user, '禁止充值', 'admin.groupuser.rechargetrade.stoporder')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
    const length = Number(request.headers.get('content-length') || 0)
    if (length > 4096) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    const raw = await request.text()
    if (raw.length > 4096) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    let body: unknown
    try { body = JSON.parse(raw) } catch { return Response.json({ message: '请检查输入内容' }, { status: 400, headers }) }
    const { rid } = z.object({ action: z.literal('stoporder'), rid: z.coerce.number().int().positive().max(2147483647) }).strict().parse(body)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const found = await client.query('SELECT rid, process_status FROM t_fms_wallet_trade_list WHERE rid=$1 FOR UPDATE', [rid])
      if (!found.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '交易数据不存在' }, { status: 404, headers }) }
      if (!stoppable.includes(found.rows[0].process_status)) { await client.query('ROLLBACK'); return Response.json({ message: '该状态不能禁止' }, { status: 409, headers }) }
      await client.query("UPDATE t_fms_wallet_trade_list SET process_status=2, tg_notice_status_send='Y', process_comments='人工禁止' WHERE rid=$1", [rid])
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'groupuser.recharge_trade.stop', rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: '禁止成功' }, { headers })
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  })
}

return rechargeTradeApi
}
