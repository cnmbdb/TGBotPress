import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const paymentLabels: Record<number, string> = { 1: 'TRX 余额', 2: 'USDT 余额' }
const id = z.coerce.number().int().positive().max(2_147_483_647)

export function shopOrdersApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    const route = 'admin.shop.order.index'
    if (!can(user, '商城管理', route) || !can(user, '商品订单', route)) {
      return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    }

    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.searchParams.get('action') === 'options') {
        const bots = await db.query('SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC')
        return Response.json({ bots: bots.rows }, { headers })
      }

      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        botRid: z.union([z.literal('all'), z.coerce.number().int().positive()]).default('all'),
        cdkey: z.string().trim().max(100).default(''),
      }).parse(Object.fromEntries(url.searchParams))

      const pattern = `%${input.cdkey.replace(/[!%_]/g, char => `!${char}`)}%`
      const botRid = input.botRid === 'all' ? null : input.botRid
      const where = `($1::int IS NULL OR a.bot_rid = $1) AND ($2 = '%%' OR a.cdkey_no ILIKE $2 ESCAPE '!')`
      const values = [botRid, pattern]
      const total = await db.query(`SELECT count(*)::int AS total FROM t_shop_order a JOIN t_telegram_bot b ON b.rid = a.bot_rid WHERE ${where}`, values)
      const result = await db.query(`
        SELECT a.rid, a.bot_rid, a.tg_uid, a.tg_username, a.cdkey_no, a.pay_type,
          a.pay_price, to_char(a.pay_time, 'YYYY-MM-DD HH24:MI:SS') AS pay_time, a.comments,
          b.bot_firstname, b.bot_username, (NULLIF(b.bot_token, '') IS NOT NULL) AS bot_token_configured
        FROM t_shop_order a JOIN t_telegram_bot b ON b.rid = a.bot_rid
        WHERE ${where} ORDER BY a.rid DESC LIMIT $3 OFFSET $4`,
      [...values, input.pageSize, (input.page - 1) * input.pageSize])

      return Response.json({
        rows: result.rows.map(row => ({ ...row, pay_type_label: paymentLabels[Number(row.pay_type)] || `未知方式 (${row.pay_type})` })),
        total: total.rows[0].total,
        page: input.page,
        pageSize: input.pageSize,
        canUpdate: can(user, '修改备注', 'admin.shop.order.update'),
      }, { headers })
    }

    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const platformOrigin = process.env.PLATFORM_ORIGIN
    if (!platformOrigin || request.headers.get('origin') !== new URL(platformOrigin).origin || !request.headers.get('content-type')?.startsWith('application/json')) {
      return Response.json({ message: '请求来源无效' }, { status: 403, headers })
    }
    const input = z.object({ action: z.literal('update_comments'), rid: id, comments: z.string().max(3000) }).strict().parse(await request.json())
    if (!can(user, '修改备注', 'admin.shop.order.update')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const row = await client.query('SELECT rid FROM t_shop_order WHERE rid = $1 FOR UPDATE', [input.rid])
      if (!row.rowCount) {
        await client.query('ROLLBACK')
        return Response.json({ message: '订单不存在' }, { status: 404, headers })
      }
      await client.query('UPDATE t_shop_order SET comments = $2 WHERE rid = $1', [input.rid, input.comments])
      await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.order.update_comments', input.rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: '备注已更新' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
