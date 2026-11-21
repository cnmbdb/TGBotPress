import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

export function collectionListApi(request: Request) {
  return run(async () => {
    if (request.method !== 'GET') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const user = await identity(request)
    if (!can(user, '归集记录', 'admin.collection.list.index')) return Response.json({ message: '没有访问权限' }, { status: 403, headers })

    const url = new URL(request.url)
    const input = z.object({
      page: z.coerce.number().int().min(1).max(1_000_000).default(1),
      pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(10),
      search: z.string().trim().max(200).default(''),
    }).parse(Object.fromEntries(url.searchParams))
    const filter = `%${input.search.replace(/[!%_]/g, char => `!${char}`)}%`
    const where = "($1 = '%%' OR wallet_addr ILIKE $1 ESCAPE '!' OR collection_wallet_addr ILIKE $1 ESCAPE '!')"
    const total = await db.query(`SELECT count(*)::int AS total FROM t_collection_wallet_list WHERE ${where}`, [filter])
    const rows = await db.query(`SELECT rid, wallet_addr, collection_wallet_addr, coin_name, collection_amount::text AS collection_amount,
      to_char(collection_time, 'YYYY-MM-DD HH24:MI:SS') AS collection_time,
      collection_hash, to_char(create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time
      FROM t_collection_wallet_list WHERE ${where} ORDER BY rid DESC LIMIT $2 OFFSET $3`, [filter, input.pageSize, (input.page - 1) * input.pageSize])
    return Response.json({ rows: rows.rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize }, { headers })
  })
}
