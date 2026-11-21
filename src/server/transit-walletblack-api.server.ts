import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const route = 'admin.transit.walletblack.index'
const fields = {
  chain_type: z.literal('trc'),
  black_wallet: z.string().trim().min(1).max(200),
  comments: z.string().trim().max(255).default(''),
}
function hasAccess(user: Awaited<ReturnType<typeof identity>>) {
  return can(user, '闪兑管理', route) && can(user, '闪兑黑钱包', route)
}
function assertOrigin(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  }
  return null
}
export function transitWalletBlackApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!hasAccess(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        search: z.string().trim().max(200).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const term = '%' + input.search.replace(/[!%_]/g, character => '!' + character) + '%'
      const where = "($1 = '%%' OR black_wallet ILIKE $1 ESCAPE '!')"
      const total = await db.query('SELECT count(*)::int AS total FROM t_transit_wallet_black WHERE ' + where, [term])
      const rows = await db.query(
        "SELECT rid, chain_type, black_wallet, comments, " +
        "to_char(create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time, " +
        "to_char(update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time " +
        "FROM t_transit_wallet_black WHERE " + where + " ORDER BY rid DESC LIMIT $2 OFFSET $3",
        [term, input.pageSize, (input.page - 1) * input.pageSize],
      )
      return Response.json({
        rows: rows.rows,
        total: total.rows[0].total,
        page: input.page,
        pageSize: input.pageSize,
        canAdd: can(user, '添加黑钱包', 'admin.transit.walletblack.add'),
        canEdit: can(user, '修改黑钱包地址', 'admin.transit.walletblack.update'),
        canDelete: can(user, '删除黑钱包地址', 'admin.transit.walletblack.delete'),
      }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const originError = assertOrigin(request)
    if (originError) return originError
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), ...fields }).strict(),
      z.object({ action: z.literal('update'), rid: id, ...fields }).strict(),
      z.object({ action: z.literal('delete'), rid: id }).strict(),
    ]).parse(body)
    if (action.action === 'create' && !can(user, '添加黑钱包', 'admin.transit.walletblack.add')) return Response.json({ message: '没有添加权限' }, { status: 403, headers })
    if (action.action === 'update' && !can(user, '修改黑钱包地址', 'admin.transit.walletblack.update')) return Response.json({ message: '没有修改权限' }, { status: 403, headers })
    if (action.action === 'delete' && !can(user, '删除黑钱包地址', 'admin.transit.walletblack.delete')) return Response.json({ message: '没有删除权限' }, { status: 403, headers })
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (action.action === 'delete') {
        const removed = await client.query('DELETE FROM t_transit_wallet_black WHERE rid = $1 RETURNING rid', [action.rid])
        if (!removed.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '黑钱包记录不存在' }, { status: 404, headers })
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'transit.walletblack.delete', action.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '黑钱包已移除' }, { headers })
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['black:' + action.chain_type + ':' + action.black_wallet])
      if (action.action === 'update') {
        const current = await client.query('SELECT rid FROM t_transit_wallet_black WHERE rid = $1 FOR UPDATE', [action.rid])
        if (!current.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '黑钱包记录不存在' }, { status: 404, headers })
        }
      }
      const duplicate = await client.query(
        'SELECT rid FROM t_transit_wallet_black WHERE black_wallet = $1 AND chain_type = $2 AND ($3::int IS NULL OR rid <> $3) LIMIT 1',
        [action.black_wallet, action.chain_type, action.action === 'update' ? action.rid : null],
      )
      if (duplicate.rowCount) {
        await client.query('ROLLBACK')
        return Response.json({ message: '该钱包地址已在黑名单中' }, { status: 409, headers })
      }
      let rid: number
      if (action.action === 'create') {
        const created = await client.query(
          'INSERT INTO t_transit_wallet_black(chain_type, black_wallet, comments, create_time) VALUES($1, $2, $3, now()) RETURNING rid',
          [action.chain_type, action.black_wallet, action.comments],
        )
        rid = created.rows[0].rid
      } else {
        const updated = await client.query(
          'UPDATE t_transit_wallet_black SET chain_type=$2, black_wallet=$3, comments=$4, update_time=now() WHERE rid=$1 RETURNING rid',
          [action.rid, action.chain_type, action.black_wallet, action.comments],
        )
        rid = updated.rows[0].rid
      }
      await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [
        user.id, action.action === 'create' ? 'transit.walletblack.create' : 'transit.walletblack.update', rid,
      ])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: action.action === 'create' ? '黑钱包已添加' : '黑钱包已更新' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}