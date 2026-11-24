import { run } from './api.server'
import { dispatchThirdPartyPluginRoute } from '../plugins/third-party-runtime.server'
import { db } from './db.server'

export function pluginRuntimeApi(request: Request) {
  return run(async () => {
    if (db.dialect !== 'postgres') return Response.json({ message: '第三方 npm 插件运行时目前要求 PostgreSQL' }, { status: 501, headers: { 'Cache-Control': 'no-store' } })
    const url = new URL(request.url)
    const pluginId = url.searchParams.get('plugin') ?? ''
    if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(pluginId) || pluginId.length > 64) return Response.json({ message: '插件 ID 无效' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return Response.json({ message: '请求方法不支持' }, { status: 405, headers: { 'Cache-Control': 'no-store' } })
    return dispatchThirdPartyPluginRoute(db, request, pluginId)
  })
}
