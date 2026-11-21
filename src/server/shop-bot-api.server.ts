import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const discount = z.string().trim().regex(/^(?:0?\.\d{1,2}|1(?:\.0{1,2})?)$/).refine(value => Number(value) > 0 && Number(value) <= 1, '折扣必须大于 0 且不超过 1')
const fields = { bot_rid: id, goods_rid: id, goods_trx_discount: discount, goods_usdt_discount: discount, comments: z.string().max(3000).default('') }

function originError(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  }
  return null
}

export function shopBotApi(request: Request) {
  return run(async () => {
    const user = await identity(request), route = 'admin.shop.bot.index'
    if (!can(user, '商城管理', route) || !can(user, '机器人商品', route)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })

    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.searchParams.get('action') === 'options') {
        const [bots, goods] = await Promise.all([
          db.query('SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC'),
          db.query('SELECT rid, goods_name FROM t_shop_goods ORDER BY rid DESC'),
        ])
        return Response.json({ bots: bots.rows, goods: goods.rows }, { headers })
      }
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        botRid: z.union([z.literal('all'), id]).default('all'),
        goodsName: z.string().trim().max(50).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const pattern = `%${input.goodsName.replace(/[!%_]/g, char => `!${char}`)}%`, botRid = input.botRid === 'all' ? null : input.botRid
      const where = `($1::int IS NULL OR a.bot_rid = $1) AND ($2 = '%%' OR b.goods_name ILIKE $2 ESCAPE '!')`
      const values = [botRid, pattern]
      const total = await db.query(`SELECT count(*)::int AS total FROM t_shop_goods_bot a JOIN t_shop_goods b ON b.rid = a.goods_rid JOIN t_telegram_bot c ON c.rid = a.bot_rid WHERE ${where}`, values)
      const result = await db.query(`SELECT a.rid, a.goods_rid, a.bot_rid, a.goods_trx_discount::text AS goods_trx_discount,
        a.goods_usdt_discount::text AS goods_usdt_discount, a.status, a.comments,
        to_char(a.create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time,
        to_char(a.update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time,
        b.goods_name, c.bot_firstname, c.bot_username, (NULLIF(c.bot_token, '') IS NOT NULL) AS bot_token_configured
        FROM t_shop_goods_bot a JOIN t_shop_goods b ON b.rid = a.goods_rid JOIN t_telegram_bot c ON c.rid = a.bot_rid
        WHERE ${where} ORDER BY a.rid DESC LIMIT $3 OFFSET $4`, [...values, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({
        rows: result.rows.map(row => ({ ...row, enabled: Number(row.status) === 0 })),
        total: total.rows[0].total, page: input.page, pageSize: input.pageSize,
        canAdd: can(user, '添加机器人商品', 'admin.shop.bot.add'),
        canEdit: can(user, '修改机器人商品', 'admin.shop.bot.update'),
        canDelete: can(user, '删除机器人商品', 'admin.shop.bot.delete'),
        canChangeStatus: can(user, '机器人商品', route),
      }, { headers })
    }

    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const invalidOrigin = originError(request)
    if (invalidOrigin) return invalidOrigin
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), ...fields }).strict(),
      z.object({ action: z.literal('update'), rid: id, ...fields }).strict(),
      z.object({ action: z.literal('delete'), rid: id }).strict(),
      z.object({ action: z.literal('set_status'), rid: id, enabled: z.boolean() }).strict(),
    ]).parse(body)
    if (action.action === 'create' && !can(user, '添加机器人商品', 'admin.shop.bot.add')) return Response.json({ message: '没有添加权限' }, { status: 403, headers })
    if (action.action === 'update' && !can(user, '修改机器人商品', 'admin.shop.bot.update')) return Response.json({ message: '没有修改权限' }, { status: 403, headers })
    if (action.action === 'delete' && !can(user, '删除机器人商品', 'admin.shop.bot.delete')) return Response.json({ message: '没有删除权限' }, { status: 403, headers })
    if (action.action === 'set_status' && !can(user, '机器人商品', route)) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (action.action === 'create' || action.action === 'update') {
        await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [action.goods_rid, action.bot_rid])
        if (action.action === 'update') {
          const existing = await client.query('SELECT rid FROM t_shop_goods_bot WHERE rid = $1 FOR UPDATE', [action.rid])
          if (!existing.rowCount) {
            await client.query('ROLLBACK')
            return Response.json({ message: '机器人商品不存在' }, { status: 404, headers })
          }
        }
        const duplicate = await client.query('SELECT rid FROM t_shop_goods_bot WHERE goods_rid = $1 AND bot_rid = $2 AND ($3::int IS NULL OR rid <> $3) LIMIT 1', [action.goods_rid, action.bot_rid, action.action === 'update' ? action.rid : null])
        if (duplicate.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '该机器人已关联此商品' }, { status: 409, headers })
        }
        const references = await client.query('SELECT EXISTS(SELECT 1 FROM t_telegram_bot WHERE rid = $1) AS bot_exists, EXISTS(SELECT 1 FROM t_shop_goods WHERE rid = $2) AS goods_exists', [action.bot_rid, action.goods_rid])
        if (!references.rows[0].bot_exists || !references.rows[0].goods_exists) {
          await client.query('ROLLBACK')
          return Response.json({ message: '所选机器人或商品不存在' }, { status: 404, headers })
        }
        if (action.action === 'create') {
          const inserted = await client.query(`INSERT INTO t_shop_goods_bot(goods_rid, bot_rid, goods_usdt_discount, goods_trx_discount, comments, status, create_time)
            VALUES($1, $2, $3, $4, $5, 1, now()) RETURNING rid`, [action.goods_rid, action.bot_rid, action.goods_usdt_discount, action.goods_trx_discount, action.comments])
          await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.bot_goods.create', inserted.rows[0].rid])
        } else {
          await client.query(`UPDATE t_shop_goods_bot SET goods_rid = $2, bot_rid = $3, goods_usdt_discount = $4,
            goods_trx_discount = $5, comments = $6, update_time = now() WHERE rid = $1`, [action.rid, action.goods_rid, action.bot_rid, action.goods_usdt_discount, action.goods_trx_discount, action.comments])
          await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.bot_goods.update', action.rid])
        }
      } else if (action.action === 'delete') {
        const deleted = await client.query('DELETE FROM t_shop_goods_bot WHERE rid = $1 RETURNING rid', [action.rid])
        if (!deleted.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '机器人商品不存在' }, { status: 404, headers })
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.bot_goods.delete', action.rid])
      } else {
        const updated = await client.query('UPDATE t_shop_goods_bot SET status = $2, update_time = now() WHERE rid = $1 RETURNING rid', [action.rid, action.enabled ? 0 : 1])
        if (!updated.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '机器人商品不存在' }, { status: 404, headers })
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.bot_goods.set_status', action.rid])
      }
      await client.query('COMMIT')
      return Response.json({ ok: true, message: action.action === 'create' ? '机器人商品已添加' : action.action === 'update' ? '机器人商品已更新' : action.action === 'delete' ? '机器人商品已删除' : '状态已更新' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
