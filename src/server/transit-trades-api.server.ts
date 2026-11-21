import { z } from 'zod'
import { can, identity, run } from './api.server'
import { db } from './db.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const idSchema = z.coerce.number().int().positive().max(2_147_483_647)
const statusLabels: Record<number, string> = { 6: '黑钱包', 7: '转入金额不符', 8: '转账中', 9: '转账成功', 1: '待兑换', 10: '余额不足', 5: '币种无效', 2: '交易失败', 0: '待确认' }
const pageRoute = 'admin.transit.trade.index'
const canAccess = (user: Awaited<ReturnType<typeof identity>>) => can(user, '闪兑管理', pageRoute) && can(user, '闪兑交易', pageRoute)
const like = (value: string) => '%' + value.replace(/[!%_]/g, char => '!' + char) + '%'

function originFailure(request: Request) {
  const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!expected || request.headers.get('origin') !== expected) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求格式无效' }, { status: 415, headers })
  return null
}

export function transitTradesApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!canAccess(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    if (request.method === 'GET') {
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        tx_hash: z.string().trim().max(100).default(''),
        transferfrom_address: z.string().trim().max(200).default(''),
        transferto_address: z.string().trim().max(200).default(''),
      }).parse(Object.fromEntries(new URL(request.url).searchParams))
      const values = [like(input.tx_hash), like(input.transferfrom_address), like(input.transferto_address)]
      const where = "($1='%%' OR tx_hash ILIKE $1 ESCAPE '!') AND ($2='%%' OR transferfrom_address ILIKE $2 ESCAPE '!') AND ($3='%%' OR transferto_address ILIKE $3 ESCAPE '!')"
      const count = await db.query('SELECT count(*)::int AS total FROM t_transit_wallet_trade_list WHERE ' + where, values)
      const select = 'SELECT rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,sendback_coin_name,sendback_amount,' +
        "CASE WHEN \"timestamp\" ~ '^[0-9]+$' THEN to_char(to_timestamp((\"timestamp\"::numeric/1000)::double precision) AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') ELSE \"timestamp\" END AS timestamp," +
        "to_char(get_time AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS get_time," +
        "process_status,to_char(process_time AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS process_time," +
        "process_comments,to_char(sendback_time AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS') AS sendback_time " +
        'FROM t_transit_wallet_trade_list WHERE ' + where + ' ORDER BY rid DESC LIMIT $4 OFFSET $5'
      const result = await db.query(select, [...values, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({
        rows: result.rows.map(row => ({
          ...row, rid: Number(row.rid), process_status: Number(row.process_status),
          process_status_label: statusLabels[Number(row.process_status)] ?? '未知状态 (' + row.process_status + ')',
          can_reissue: Number(row.process_status) === 10, can_stop: [1, 10].includes(Number(row.process_status)),
        })),
        total: count.rows[0].total, page: input.page, pageSize: input.pageSize,
        canReissue: can(user, '兑换补发', 'admin.transit.trade.reswap'),
        canStop: can(user, '禁止兑换', 'admin.transit.trade.stopswap'),
        canDelete: can(user, '兑换补发', 'admin.transit.trade.reswap') || can(user, '禁止兑换', 'admin.transit.trade.stopswap'),
      }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const rejected = originFailure(request)
    if (rejected) return rejected
    let raw: unknown
    try { raw = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const input = z.discriminatedUnion('action', [
      z.object({ action: z.literal('reswap'), rid: idSchema }).strict(),
      z.object({ action: z.literal('stopswap'), rid: idSchema }).strict(),
      z.object({ action: z.literal('batch_delete'), ids: z.array(idSchema).min(1).max(100) }).strict(),
    ]).parse(raw)
    if (input.action === 'reswap' && !can(user, '兑换补发', 'admin.transit.trade.reswap')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
    if (input.action === 'stopswap' && !can(user, '禁止兑换', 'admin.transit.trade.stopswap')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
    if (input.action === 'batch_delete' && !(can(user, '兑换补发', 'admin.transit.trade.reswap') || can(user, '禁止兑换', 'admin.transit.trade.stopswap'))) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (input.action === 'reswap' || input.action === 'stopswap') {
        const current = await client.query('SELECT process_status FROM t_transit_wallet_trade_list WHERE rid=$1 FOR UPDATE', [input.rid])
        if (!current.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '交易数据不存在' }, { status: 404, headers }) }
        const status = Number(current.rows[0].process_status)
        if (input.action === 'reswap' && status !== 10) { await client.query('ROLLBACK'); return Response.json({ message: '状态为余额不足时，才能补发' }, { status: 409, headers }) }
        if (input.action === 'stopswap' && ![1, 10].includes(status)) { await client.query('ROLLBACK'); return Response.json({ message: '状态为余额不足或待兑换时，才能禁止' }, { status: 409, headers }) }
        if (input.action === 'reswap') {
          await client.query("UPDATE t_transit_wallet_trade_list SET process_status=1,tg_notice_status_send='N' WHERE rid=$1", [input.rid])
          await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'transit.trade.reissue', input.rid])
          await client.query('COMMIT')
          return Response.json({ ok: true, message: '补发已提交' }, { headers })
        }
        await client.query("UPDATE t_transit_wallet_trade_list SET process_status=5,tg_notice_status_send='Y',process_comments='人工禁止兑换' WHERE rid=$1", [input.rid])
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'transit.trade.stop', input.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '已禁止兑换' }, { headers })
      }
      const ids = [...new Set(input.ids)]
      const placeholders = ids.map((_, index) => '$' + (index + 1)).join(',')
      const deleted = await client.query('DELETE FROM t_transit_wallet_trade_list WHERE rid IN (' + placeholders + ') RETURNING rid', ids)
      for (const row of deleted.rows) await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'transit.trade.delete', row.rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: '已删除 ' + deleted.rowCount + ' 条记录' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })
}
