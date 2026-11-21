import { z } from 'zod'
import { can, identity, run } from './api.server'
import { db } from './db.server'
import { visibleNavigation } from '../lib/navigation'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const route = 'admin.monitor.bot.index'
const id = z.coerce.number().int().positive().max(2_147_483_647)
const money = z.preprocess(v => v === '' || v === null || v === undefined ? '0' : String(v), z.string().trim().regex(/^\d{1,12}(?:\.\d{1,4})?$/))
const fields = {
  bot_rid: id,
  free_monitor_wallet: z.coerce.number().int().min(0).max(100000),
  price_usdt_5: money,
  price_usdt_10: money,
  price_usdt_20: money,
  price_usdt_50: money,
  price_usdt_100: money,
  price_usdt_200: money,
  comments: z.string().trim().max(3000).default(''),
}
const permissions = {
  add: ['添加机器人监控', 'admin.monitor.bot.add'],
  update: ['修改机器人监控', 'admin.monitor.bot.update'],
  delete: ['删除机器人监控', 'admin.monitor.bot.delete'],
  status: ['修改机器人监控', 'admin.monitor.bot.change_status'],
} as const
function permitted(user: Parameters<typeof can>[0], action: keyof typeof permissions) {
  const [name, actionRoute] = permissions[action]
  return can(user, name, actionRoute)
}

export function monitorBotsApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!visibleNavigation(user).some(group => group.items.some(item => item.id === route))) {
      return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    }

    const url = new URL(request.url)
    if (request.method === 'GET') {
      if (url.searchParams.get('action') === 'options') {
        const bots = await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC')
        return Response.json({ bots: bots.rows }, { headers })
      }
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        search: z.string().trim().max(200).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const search = '%' + input.search.replace(/[!%_]/g, c => '!' + c) + '%'
      const where = "($1='%%' OR b.bot_firstname ILIKE $1 ESCAPE '!' OR b.bot_username ILIKE $1 ESCAPE '!' OR COALESCE(m.comments,'') ILIKE $1 ESCAPE '!' OR m.bot_rid::text ILIKE $1 ESCAPE '!')"
      const total = await db.query('SELECT count(*)::int AS total FROM t_monitor_bot m LEFT JOIN t_telegram_bot b ON b.rid=m.bot_rid WHERE ' + where, [search])
      const rows = await db.query(
        "SELECT m.rid,m.bot_rid,b.bot_firstname,b.bot_username,(b.bot_token IS NOT NULL AND b.bot_token<>'') AS token_configured,m.status,m.free_monitor_wallet,m.price_usdt_5::text,m.price_usdt_10::text,m.price_usdt_20::text,m.price_usdt_50::text,m.price_usdt_100::text,m.price_usdt_200::text,m.comments,to_char(m.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(m.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time FROM t_monitor_bot m LEFT JOIN t_telegram_bot b ON b.rid=m.bot_rid WHERE " + where + ' ORDER BY m.rid DESC LIMIT $2 OFFSET $3',
        [search, input.pageSize, (input.page - 1) * input.pageSize],
      )
      return Response.json({
        rows: rows.rows,
        total: total.rows[0].total,
        page: input.page,
        pageSize: input.pageSize,
        permissions: {
          add: permitted(user, 'add'),
          update: permitted(user, 'update'),
          delete: permitted(user, 'delete'),
          status: permitted(user, 'status'),
        },
      }, { headers })
    }

    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const expectedOrigin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
    if (!expectedOrigin || request.headers.get('origin') !== expectedOrigin || !request.headers.get('content-type')?.startsWith('application/json')) {
      return Response.json({ message: '请求来源无效' }, { status: 403, headers })
    }
    const raw = await request.text()
    if (raw.length > 24_000) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    let body: unknown
    try { body = JSON.parse(raw) } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.object({ action: z.enum(['add', 'update', 'delete', 'status']) }).parse(body).action
    if (!permitted(user, action)) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      let rid: number
      if (action === 'add' || action === 'update') {
        const input = z.object({ action: z.enum(['add', 'update']), ...(action === 'update' ? { rid: id } : {}), ...fields }).strict().parse(body)
        await client.query('SELECT pg_advisory_xact_lock(74321,$1)', [input.bot_rid])
        const bot = await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1', [input.bot_rid])
        if (!bot.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '机器人不存在' }, { status: 404, headers })
        }
        const duplicate = await client.query('SELECT rid FROM t_monitor_bot WHERE bot_rid=$1 AND ($2::int IS NULL OR rid<>$2) LIMIT 1', [input.bot_rid, action === 'update' ? input.rid : null])
        if (duplicate.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '该机器人已配置监控' }, { status: 409, headers })
        }
        const values = [input.bot_rid, input.free_monitor_wallet, input.price_usdt_5, input.price_usdt_10, input.price_usdt_20, input.price_usdt_50, input.price_usdt_100, input.price_usdt_200, input.comments]
        if (action === 'add') {
          const created = await client.query('INSERT INTO t_monitor_bot(bot_rid,free_monitor_wallet,price_usdt_5,price_usdt_10,price_usdt_20,price_usdt_50,price_usdt_100,price_usdt_200,comments,status,create_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,now()) RETURNING rid', values)
          rid = created.rows[0].rid
        } else {
          const updated = await client.query('UPDATE t_monitor_bot SET bot_rid=$2,free_monitor_wallet=$3,price_usdt_5=$4,price_usdt_10=$5,price_usdt_20=$6,price_usdt_50=$7,price_usdt_100=$8,price_usdt_200=$9,comments=$10,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, ...values])
          if (!updated.rowCount) {
            await client.query('ROLLBACK')
            return Response.json({ message: '机器人监控配置不存在' }, { status: 404, headers })
          }
          rid = updated.rows[0].rid
        }
      } else if (action === 'status') {
        const input = z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict().parse(body)
        const updated = await client.query('UPDATE t_monitor_bot SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, input.enabled ? 0 : 1])
        if (!updated.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '机器人监控配置不存在' }, { status: 404, headers })
        }
        rid = input.rid
      } else {
        const input = z.object({ action: z.literal('delete'), rid: id }).strict().parse(body)
        const deleted = await client.query('DELETE FROM t_monitor_bot WHERE rid=$1 RETURNING rid', [input.rid])
        if (!deleted.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '机器人监控配置不存在' }, { status: 404, headers })
        }
        rid = input.rid
      }
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'monitor.bot.' + action, rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: action === 'delete' ? '机器人监控配置已删除' : action === 'status' ? '状态已更新' : action === 'add' ? '机器人监控配置已添加' : '机器人监控配置已更新' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
