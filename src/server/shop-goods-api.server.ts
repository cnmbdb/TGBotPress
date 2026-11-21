import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const price = z.string().trim().regex(/^(?:\d{1,12})(?:\.\d{1,4})?$/, '请输入不超过 12 位整数、4 位小数的非负金额').default('0')
const productFields = {
  goods_name: z.string().trim().min(1).max(50),
  goods_trx_price: price,
  goods_usdt_price: price,
  goods_type: z.literal(1),
  show_notes: z.string().max(1000).default(''),
  seq_sn: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  comments: z.string().max(3000).default(''),
}
const pageInput = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15), search: z.string().trim().max(50).default('') })

function hasGoodsAccess(user: Awaited<ReturnType<typeof identity>>) {
  const route = 'admin.shop.goods.index'
  return can(user, '商城管理', route) && can(user, '商品管理', route)
}
function assertOrigin(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  }
  return null
}

export function shopGoodsApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!hasGoodsAccess(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })

    if (request.method === 'GET') {
      const input = pageInput.parse(Object.fromEntries(new URL(request.url).searchParams))
      const search = `%${input.search.replace(/[!%_]/g, char => `!${char}`)}%`
      const where = "($1 = '%%' OR goods_name ILIKE $1 ESCAPE '!')"
      const total = await db.query(`SELECT count(*)::int AS total FROM t_shop_goods WHERE ${where}`, [search])
      const result = await db.query(`SELECT rid, goods_name, goods_type, goods_usdt_price::text AS goods_usdt_price,
        goods_trx_price::text AS goods_trx_price, show_notes, status, seq_sn, comments,
        to_char(create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time,
        to_char(update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time
        FROM t_shop_goods WHERE ${where} ORDER BY rid DESC LIMIT $2 OFFSET $3`, [search, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({
        rows: result.rows.map(row => ({ ...row, goods_type_label: Number(row.goods_type) === 1 ? '虚拟卡密' : `未知类型 (${row.goods_type})`, enabled: Number(row.status) === 0 })),
        total: total.rows[0].total,
        page: input.page,
        pageSize: input.pageSize,
        canAdd: can(user, '添加商品', 'admin.shop.goods.add'),
        canEdit: can(user, '修改商品', 'admin.shop.goods.update'),
        canDelete: can(user, '删除商品', 'admin.shop.goods.delete'),
        canChangeStatus: can(user, '商品管理', 'admin.shop.goods.index'),
      }, { headers })
    }

    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const originError = assertOrigin(request)
    if (originError) return originError
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), ...productFields }).strict(),
      z.object({ action: z.literal('update'), rid: id, ...productFields }).strict(),
      z.object({ action: z.literal('delete'), rid: id }).strict(),
      z.object({ action: z.literal('set_status'), rid: id, enabled: z.boolean() }).strict(),
    ]).parse(body)

    if (action.action === 'create' && !can(user, '添加商品', 'admin.shop.goods.add')) return Response.json({ message: '没有添加权限' }, { status: 403, headers })
    if (action.action === 'update' && !can(user, '修改商品', 'admin.shop.goods.update')) return Response.json({ message: '没有修改权限' }, { status: 403, headers })
    if (action.action === 'delete' && !can(user, '删除商品', 'admin.shop.goods.delete')) return Response.json({ message: '没有删除权限' }, { status: 403, headers })
    if (action.action === 'set_status' && !can(user, '商品管理', 'admin.shop.goods.index')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (action.action === 'create' || action.action === 'update') {
        const duplicate = await client.query('SELECT rid FROM t_shop_goods WHERE goods_name = $1 AND ($2::int IS NULL OR rid <> $2) LIMIT 1', [action.goods_name, action.action === 'update' ? action.rid : null])
        if (duplicate.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '商品名称已存在' }, { status: 409, headers })
        }
        if (action.action === 'create') {
          const created = await client.query(`INSERT INTO t_shop_goods(goods_name, goods_type, goods_trx_price, goods_usdt_price, show_notes, seq_sn, comments, status, create_time)
            VALUES($1, $2, $3, $4, $5, $6, $7, 1, now()) RETURNING rid`, [action.goods_name, action.goods_type, action.goods_trx_price, action.goods_usdt_price, action.show_notes, action.seq_sn, action.comments])
          await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.goods.create', created.rows[0].rid])
        } else {
          const found = await client.query('SELECT rid FROM t_shop_goods WHERE rid = $1 FOR UPDATE', [action.rid])
          if (!found.rowCount) {
            await client.query('ROLLBACK')
            return Response.json({ message: '商品不存在' }, { status: 404, headers })
          }
          await client.query(`UPDATE t_shop_goods SET goods_name = $2, goods_type = $3, goods_trx_price = $4, goods_usdt_price = $5,
            show_notes = $6, seq_sn = $7, comments = $8, update_time = now() WHERE rid = $1`, [action.rid, action.goods_name, action.goods_type, action.goods_trx_price, action.goods_usdt_price, action.show_notes, action.seq_sn, action.comments])
          await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.goods.update', action.rid])
        }
      } else if (action.action === 'delete') {
        const found = await client.query('SELECT rid FROM t_shop_goods WHERE rid = $1 FOR UPDATE', [action.rid])
        if (!found.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '商品不存在' }, { status: 404, headers })
        }
        const references = await client.query(`SELECT EXISTS(SELECT 1 FROM t_shop_goods_cdkey WHERE goods_rid = $1) OR EXISTS(SELECT 1 FROM t_shop_goods_bot WHERE goods_rid = $1) AS used`, [action.rid])
        if (references.rows[0].used) {
          await client.query('ROLLBACK')
          return Response.json({ message: '该商品已关联卡密或机器人商品，请先解除关联' }, { status: 409, headers })
        }
        await client.query('DELETE FROM t_shop_goods WHERE rid = $1', [action.rid])
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.goods.delete', action.rid])
      } else {
        const updated = await client.query('UPDATE t_shop_goods SET status = $2, update_time = now() WHERE rid = $1 RETURNING rid', [action.rid, action.enabled ? 0 : 1])
        if (!updated.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '商品不存在' }, { status: 404, headers })
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.goods.set_status', action.rid])
      }
      await client.query('COMMIT')
      const message = action.action === 'create' ? '商品已添加' : action.action === 'update' ? '商品已更新' : action.action === 'delete' ? '商品已删除' : '商品状态已更新'
      return Response.json({ ok: true, message }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
