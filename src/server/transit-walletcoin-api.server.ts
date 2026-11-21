import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const amount = z.string().trim().regex(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/, '金额最多 6 位整数和 2 位小数').default('0')
const profitRate = amount.refine(value => Number(value) < 1, '实时利润必须小于 1')
const exchangeRate = amount.refine(value => Number(value) <= 10, '汇率不能大于 10')
const integer = z.coerce.number().int().min(1).max(2_147_483_647)
const coin = z.enum(['trx', 'usdt'])
const route = 'admin.transit.walletcoin.index'
const fields = {
  transit_wallet_id: id,
  in_coin_name: coin,
  out_coin_name: coin,
  is_realtime_rate: z.coerce.number().int().refine(value => [1, 2, 3].includes(value), '汇率方式无效').default(1),
  profit_rate: profitRate.default('0.10'),
  exchange_rate: exchangeRate.default('1'),
  kou_out_amount: amount.default('0'),
  min_transit_amount: integer.default(1),
  max_transit_amount: integer.default(1000),
  comments: z.string().trim().max(255).default(''),
}
function hasAccess(user: Awaited<ReturnType<typeof identity>>) {
  return can(user, '闪兑管理', route) && can(user, '闪兑币种', route)
}
function assertOrigin(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  }
  return null
}
function validateFields(data: { in_coin_name: string; out_coin_name: string; min_transit_amount: number; max_transit_amount: number }) {
  if (data.in_coin_name === data.out_coin_name) return '转入币名和回款币名不能相同'
  if (data.min_transit_amount > data.max_transit_amount) return '最低转入不能大于最高转入'
  return null
}
export function transitWalletCoinApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!hasAccess(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.searchParams.get('action') === 'options') {
        const wallets = await db.query('SELECT rid, receive_wallet, send_wallet, status FROM t_transit_wallet ORDER BY rid DESC')
        return Response.json({ wallets: wallets.rows }, { headers })
      }
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        walletId: z.union([z.literal('all'), id]).default('all'),
        search: z.string().trim().max(120).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const walletId = input.walletId === 'all' ? null : input.walletId
      const term = '%' + input.search.replace(/[!%_]/g, character => '!' + character) + '%'
      const where = `($1::int IS NULL OR c.transit_wallet_id = $1)
        AND ($2 = '%%' OR COALESCE(w.receive_wallet, '') ILIKE $2 ESCAPE '!'
          OR COALESCE(w.send_wallet, '') ILIKE $2 ESCAPE '!')`
      const values = [walletId, term]
      const total = await db.query(`SELECT count(*)::int AS total
        FROM t_transit_wallet_coin c JOIN t_transit_wallet w ON w.rid = c.transit_wallet_id
        WHERE ${where}`, values)
      const result = await db.query(`SELECT c.rid, c.transit_wallet_id, w.receive_wallet, w.send_wallet,
        c.in_coin_name, c.out_coin_name, c.is_realtime_rate, c.profit_rate::text AS profit_rate,
        c.exchange_rate::text AS exchange_rate, c.kou_out_amount::text AS kou_out_amount,
        c.min_transit_amount, c.max_transit_amount, c.comments,
        to_char(c.create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time,
        to_char(c.update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time
        FROM t_transit_wallet_coin c JOIN t_transit_wallet w ON w.rid = c.transit_wallet_id
        WHERE ${where} ORDER BY c.rid DESC LIMIT $3 OFFSET $4`,
      [...values, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({
        rows: result.rows.map(row => ({
          ...row,
          is_realtime_rate_label: ({ 1: '实时 · 直减', 2: '固定汇率', 3: '实时 · 百分比' } as Record<number, string>)[Number(row.is_realtime_rate)] || '未知方式',
        })),
        total: total.rows[0].total,
        page: input.page,
        pageSize: input.pageSize,
        canAdd: can(user, '添加闪兑币种', 'admin.transit.walletcoin.add'),
        canEdit: can(user, '修改闪兑币种', 'admin.transit.walletcoin.update'),
        canDelete: can(user, '删除闪兑币种', 'admin.transit.walletcoin.delete'),
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
    if (action.action === 'create' && !can(user, '添加闪兑币种', 'admin.transit.walletcoin.add')) return Response.json({ message: '没有添加权限' }, { status: 403, headers })
    if (action.action === 'update' && !can(user, '修改闪兑币种', 'admin.transit.walletcoin.update')) return Response.json({ message: '没有修改权限' }, { status: 403, headers })
    if (action.action === 'delete' && !can(user, '删除闪兑币种', 'admin.transit.walletcoin.delete')) return Response.json({ message: '没有删除权限' }, { status: 403, headers })
    if (action.action !== 'delete') {
      const invalid = validateFields(action)
      if (invalid) return Response.json({ message: invalid }, { status: 400, headers })
    }
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (action.action === 'delete') {
        const removed = await client.query('DELETE FROM t_transit_wallet_coin WHERE rid = $1 RETURNING rid', [action.rid])
        if (!removed.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '闪兑币种不存在' }, { status: 404, headers })
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'transit.walletcoin.delete', action.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '闪兑币种已删除' }, { headers })
      }
      const wallet = await client.query('SELECT rid FROM t_transit_wallet WHERE rid = $1', [action.transit_wallet_id])
      if (!wallet.rowCount) {
        await client.query('ROLLBACK')
        return Response.json({ message: '收款钱包不存在' }, { status: 404, headers })
      }
      if (action.action === 'update') {
        const current = await client.query('SELECT rid, transit_wallet_id FROM t_transit_wallet_coin WHERE rid = $1 FOR UPDATE', [action.rid])
        if (!current.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '闪兑币种不存在' }, { status: 404, headers })
        }
        if (Number(current.rows[0].transit_wallet_id) !== action.transit_wallet_id) {
          await client.query('ROLLBACK')
          return Response.json({ message: '原版规则不允许修改币种所属钱包' }, { status: 400, headers })
        }
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(action.transit_wallet_id) + ':' + action.in_coin_name])
      const duplicate = await client.query(`SELECT rid FROM t_transit_wallet_coin
        WHERE transit_wallet_id = $1 AND in_coin_name = $2 AND ($3::int IS NULL OR rid <> $3) LIMIT 1`,
      [action.transit_wallet_id, action.in_coin_name, action.action === 'update' ? action.rid : null])
      if (duplicate.rowCount) {
        await client.query('ROLLBACK')
        return Response.json({ message: '该钱包的转入币种已配置' }, { status: 409, headers })
      }
      let resourceId: number
      if (action.action === 'create') {
        const created = await client.query(`INSERT INTO t_transit_wallet_coin(
          transit_wallet_id, in_coin_name, out_coin_name, is_realtime_rate, profit_rate, exchange_rate,
          kou_out_amount, min_transit_amount, max_transit_amount, comments, create_time
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING rid`, [
          action.transit_wallet_id, action.in_coin_name, action.out_coin_name, action.is_realtime_rate,
          action.profit_rate, action.exchange_rate, action.kou_out_amount, action.min_transit_amount,
          action.max_transit_amount, action.comments,
        ])
        resourceId = created.rows[0].rid
      } else {
        const updated = await client.query(`UPDATE t_transit_wallet_coin SET
          transit_wallet_id=$2, in_coin_name=$3, out_coin_name=$4, is_realtime_rate=$5,
          profit_rate=$6, exchange_rate=$7, kou_out_amount=$8, min_transit_amount=$9,
          max_transit_amount=$10, comments=$11, update_time=now()
          WHERE rid=$1 RETURNING rid`, [
          action.rid, action.transit_wallet_id, action.in_coin_name, action.out_coin_name,
          action.is_realtime_rate, action.profit_rate, action.exchange_rate, action.kou_out_amount,
          action.min_transit_amount, action.max_transit_amount, action.comments,
        ])
        resourceId = updated.rows[0].rid
      }
      await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [
        user.id, action.action === 'create' ? 'transit.walletcoin.create' : 'transit.walletcoin.update', resourceId,
      ])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: action.action === 'create' ? '闪兑币种已添加' : '闪兑币种已更新' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
