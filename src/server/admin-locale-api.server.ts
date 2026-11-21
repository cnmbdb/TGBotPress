import { z } from 'zod'
import { db } from './db.server'
import { identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store' }
const inputSchema = z.object({ locale: z.enum(['zh-CN','en','ru','ja']) }).strict()

export function adminLocaleApi(request: Request) {
  return run(async () => {
    const user = await identity(request, { allowUnlicensed: true })
    if (request.method === 'GET') {
      const result = await db.query<{locale:string}>('SELECT locale FROM t_platform_admin_locale WHERE admin_id=$1', [user.id])
      return Response.json({ locale: result.rows[0]?.locale ?? 'zh-CN' }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
    if (!expected || request.headers.get('origin') !== expected || !request.headers.get('content-type')?.startsWith('application/json')) {
      return Response.json({ message: '请求来源无效' }, { status: 403, headers })
    }
    const body = await request.text()
    if (body.length > 1024) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    const { locale } = inputSchema.parse(JSON.parse(body))
    await db.query('INSERT INTO t_platform_admin_locale(admin_id,locale,updated_at) VALUES($1,$2,now()) ON CONFLICT(admin_id) DO UPDATE SET locale=EXCLUDED.locale,updated_at=now()', [user.id, locale])
    return Response.json({ locale }, { headers })
  })
}
