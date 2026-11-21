import { z } from 'zod'
import type { Pool } from 'pg'
export type GroupIdentity = { id: string; name: string; roles: string[]; permissions: string[]; routes: string[] }
export type GroupApiHost = { db: Pick<Pool, 'query' | 'connect'>; identity: (request: Request) => Promise<GroupIdentity>; can: (user: GroupIdentity, permission: string, route: string) => boolean; run: (handler: () => Promise<Response>) => Promise<Response> }
export function createGroupApi(host: GroupApiHost) {
const { db, can, identity, run } = host

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const statusLabels: Record<number, string> = { 1: '使用中', 2: '已停用', 3: '群组不存在' }
function canOpenGroupPage(user: Awaited<ReturnType<typeof identity>>) {
  return user.roles.includes('超级管理员') || (user.permissions.includes('群组用户') && user.permissions.includes('群组列表'))
}
function canGroupAction(user: Awaited<ReturnType<typeof identity>>, permission: string, route: string) {
  return canOpenGroupPage(user) && can(user, permission, route)
}

function groupApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!canOpenGroupPage(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.searchParams.get('action') === 'options') {
        const bots = await db.query('SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC')
        return Response.json({ bots: bots.rows }, { headers })
      }
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        search: z.string().trim().max(200).default(''),
        botRid: z.union([z.literal('all'), z.coerce.number().int().positive()]).default('all'),
      }).parse(Object.fromEntries(url.searchParams))
      const cleaned = input.search.replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '')
      const pattern = `%${cleaned.replace(/[!%_]/g, char => `!${char}`)}%`
      const bot = input.botRid === 'all' ? null : input.botRid
      const where = "($1='%%' OR a.tg_groupusername ILIKE $1 ESCAPE '!') AND ($2::int IS NULL OR a.bot_rid=$2)"
      const total = await db.query(`SELECT count(*)::int AS total FROM t_telegram_bot_group a WHERE ${where}`, [pattern, bot])
      const rows = await db.query(`SELECT a.rid,a.bot_rid,a.group_type,a.tg_groupid::text AS tg_groupid,a.tg_groupusername,a.tg_groupnickname,a.status,a.is_admin,
        to_char(a.first_time,'YYYY-MM-DD HH24:MI:SS') AS first_time,to_char(a.last_time,'YYYY-MM-DD HH24:MI:SS') AS last_time,
        to_char(a.stop_time,'YYYY-MM-DD HH24:MI:SS') AS stop_time,a.follow_count,b.bot_firstname,b.bot_username
        FROM t_telegram_bot_group a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid WHERE ${where}
        ORDER BY a.rid DESC LIMIT $3 OFFSET $4`, [pattern, bot, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({ rows: rows.rows.map(row => ({ ...row, status_label: statusLabels[row.status] || `未知状态 (${row.status})`, is_admin_label: row.is_admin === 'Y' ? '管理员' : '普通' })), total: total.rows[0].total, page: input.page, pageSize: input.pageSize, permissions: { send: canGroupAction(user, '发送消息', 'admin.groupuser.group.sendmessage'), delete: canGroupAction(user, '删除群组', 'admin.groupuser.group.delete') }, telegramEnabled: process.env.PLATFORM_TELEGRAM_ACTIONS === 'true' }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const origin = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
    if (!origin || request.headers.get('origin') !== origin || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
    const length = Number(request.headers.get('content-length') || 0)
    if (length > 8192) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    const raw = await request.text()
    if (raw.length > 8192) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    let body: unknown
    try { body = JSON.parse(raw) } catch { return Response.json({ message: '请检查输入内容' }, { status: 400, headers }) }
    const action = z.object({ action: z.enum(['sendmessage', 'delete']) }).parse(body).action
    const rid = z.object({ rid: z.coerce.number().int().positive().max(2147483647) }).parse(body).rid
    if (action === 'delete') {
      if (!canGroupAction(user, '删除群组', 'admin.groupuser.group.delete')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        const deleted = await client.query('DELETE FROM t_telegram_bot_group WHERE rid=$1 RETURNING rid', [rid])
        if (!deleted.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '数据不存在或已删除' }, { status: 404, headers }) }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'groupuser.group.delete', rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '删除成功' }, { headers })
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (!canGroupAction(user, '发送消息', 'admin.groupuser.group.sendmessage')) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
    const message = z.object({ message: z.string().trim().min(1).max(4096) }).parse(body).message
    const record = await db.query(`SELECT g.rid,g.bot_rid,g.tg_groupid::text AS tg_groupid,g.status,b.bot_token
      FROM t_telegram_bot_group g LEFT JOIN t_telegram_bot b ON b.rid=g.bot_rid WHERE g.rid=$1`, [rid])
    if (!record.rowCount) return Response.json({ message: '数据不存在' }, { status: 404, headers })
    const group = record.rows[0]
    if (group.status !== 1) return Response.json({ message: '群组状态不为使用中' }, { status: 409, headers })
    if (!group.bot_token) return Response.json({ message: '机器人数据不存在或未配置 Token' }, { status: 409, headers })
    if (process.env.PLATFORM_TELEGRAM_ACTIONS !== 'true') return Response.json({ message: '当前开发环境未启用外部机器人操作' }, { status: 409, headers })
    let telegram: { ok?: boolean; result?: unknown; description?: string }
    try {
      const response = await fetch(`https://api.telegram.org/bot${group.bot_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: group.tg_groupid, text: message, parse_mode: 'HTML' }), signal: AbortSignal.timeout(12_000) })
      telegram = await response.json() as typeof telegram
    } catch { return Response.json({ message: '发送失败，请检查服务器网络后重试' }, { status: 502, headers }) }
    if (telegram.ok && telegram.result) {
      await db.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'groupuser.group.send_message', rid])
      return Response.json({ ok: true, message: '发送成功' }, { headers })
    }
    const description = telegram.description || 'Telegram 返回未知错误'
    let changedStatus: number | null = null
    if (description === 'Forbidden: user is deactivated') changedStatus = 3
    else if (description === 'Forbidden: bot was kicked from the supergroup chat') changedStatus = 2
    if (changedStatus) await db.query('UPDATE t_telegram_bot_group SET status=$2,stop_time=now() WHERE rid=$1 AND status=1', [rid, changedStatus])
    return Response.json({ message: `发送失败：${description}` }, { status: 502, headers })
  })
}

return groupApi
}
