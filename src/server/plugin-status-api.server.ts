import { can, identity, run } from './api.server'
import { db } from './db.server'
import { pluginCatalog } from '../plugins/catalog'
import { getCloneProxyLifecycleStatus, changeCloneProxyLifecycle, type CloneProxyLifecycleAction } from '../plugins/cloneproxy/lifecycle.server'
import { groupsPluginStatus, changeGroupsPlugin, type GroupPluginAction } from '../plugins/groups/lifecycle.server'
import { managedPluginStatus, changeManagedPlugin, managedModuleIds, type ManagedModuleId, type PluginLifecycleAction } from '../plugins/module-lifecycle.server'
import { enqueuePluginConfigRefresh } from '../plugins/plugin-config-links.server'
import { pluginInstallRecords, recordBuiltinPluginInstall, recordPluginInstallFailure } from '../plugins/install-records.server'
import { trustedPackageForPlugin } from '../plugins/install-policy.server'
import { installRemotePlugin } from '../plugins/remote-install.server'

const headers = { 'Cache-Control': 'no-store' }
let statusCache: { userId: string; expiresAt: number; payload: { plugins: unknown[] } } | null = null
type User = Awaited<ReturnType<typeof identity>>
const hasModuleAccess = (user: User, plugin: typeof pluginCatalog[number]) => plugin.menuRoutes.some(route => can(user, '', route))

export function pluginStatusApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (request.method === 'POST') {
      const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
      if (!expected || request.headers.get('origin') !== expected || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
      const body = await request.json() as { plugin?: unknown; action?: unknown; version?: unknown; integritySha512?: unknown; packageName?: unknown }
      const plugin = pluginCatalog.find(item => item.id === body.plugin)
      const actions = ['disable','resume','uninstall','install','install_remote'] as const
      if (!plugin || !actions.includes(String(body.action) as typeof actions[number])) return Response.json({ message: '插件操作无效' }, { status: 400, headers })
      if (!hasModuleAccess(user, plugin) && !(plugin.id === 'cloneproxy' && can(user, '克隆/代理基础设置', 'admin.telegram.cloneproxy.basic'))) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
      try {
        let state: string
        const transition = async (action: PluginLifecycleAction) => {
          if (plugin.id === 'groups') return changeGroupsPlugin(db, action as GroupPluginAction)
          if (plugin.id === 'cloneproxy') return changeCloneProxyLifecycle(db, action as CloneProxyLifecycleAction)
          if (managedModuleIds.includes(plugin.id as ManagedModuleId)) return changeManagedPlugin(db, plugin.id as ManagedModuleId, action as PluginLifecycleAction)
          throw new Error('plugin_lifecycle_unsupported')
        }
        if (body.action === 'install_remote') {
          if (typeof body.version !== 'string' || typeof body.integritySha512 !== 'string' || typeof body.packageName !== 'string') return Response.json({ message: '插件远程安装参数无效' }, { status: 400, headers })
          const lifecycleState = await db.query<{ state: string }>('SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id=$1', [plugin.id])
          if (lifecycleState.rows[0]?.state !== 'uninstalled') return Response.json({ message: 'plugin_not_uninstalled' }, { status: 409, headers })
          try {
            const result = await installRemotePlugin({ pool: db, pluginId: plugin.id, packageName: body.packageName, version: body.version, integritySha512: body.integritySha512, token: process.env.GITHUB_PACKAGES_TOKEN ?? '', root: process.env.PLATFORM_PLUGIN_DIR ?? '/var/lib/tg-ultra/plugins', lifecycleInstall: async () => { await transition('install') } })
            state = result.status === 'installed' ? 'active' : result.status
          } catch (error) {
            await recordPluginInstallFailure(db, plugin.id, body.packageName, body.version, error).catch(() => undefined)
            throw error
          }
        } else state = await transition(body.action as PluginLifecycleAction)
        statusCache = null
        if (body.action === 'install') {
          const trusted = trustedPackageForPlugin(plugin.id, { packageName: `@tgbotpress/plugin-${plugin.id}`, version: '0.1.0', source: 'builtin' })
          await recordBuiltinPluginInstall(db, trusted.pluginId, trusted.version)
        }
        let configRefreshQueued = true
        try {
          await enqueuePluginConfigRefresh(db, plugin.id)
        } catch {
          configRefreshQueued = false
          console.error('Plugin Telegram config refresh enqueue failed for ' + plugin.id)
        }
        return Response.json({ ok: true, state, configRefreshQueued, message: configRefreshQueued ? '插件状态已更新' : '插件状态已更新，机器人命令刷新暂未入队' }, { headers })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'plugin_transition_failed'
        if (code.startsWith('groups_plugin_') || code.startsWith('plugin_')) return Response.json({ message: code }, { status: 409, headers })
        throw error
      }
    }
    if (request.method !== 'GET') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    if (statusCache && statusCache.userId === user.id && statusCache.expiresAt > Date.now()) return Response.json(statusCache.payload, { headers })
    const installs = await pluginInstallRecords(db)
    const plugins = await Promise.all(pluginCatalog.map(async plugin => {
      if (!hasModuleAccess(user, plugin) && !(plugin.id === 'cloneproxy' && can(user, '克隆/代理基础设置', 'admin.telegram.cloneproxy.basic'))) return { ...plugin, state: null, blockers: null, executions: null, queue: null }
      if (plugin.id === 'groups') {
        const [status, drain] = await Promise.all([groupsPluginStatus(db), db.query<{blockers:number}>("SELECT count(*)::int AS blockers FROM t_platform_plugin_task WHERE plugin_id='groups' AND (status IN ('pending','processing') OR (status='failed' AND attempts<8))")])
        return { ...plugin, state: status.state, blockers: drain.rows[0]?.blockers ?? 0, executions: status.queue.processing, queue: status.queue }
      }
      if (plugin.id === 'cloneproxy') return { ...plugin, ...await getCloneProxyLifecycleStatus(db), queue: null }
      if (managedModuleIds.includes(plugin.id as ManagedModuleId)) return { ...plugin, ...await managedPluginStatus(db, plugin.id as ManagedModuleId), queue: null }
      return { ...plugin, state: null, blockers: null, executions: null, queue: null }
    }))
    const payload = { plugins: plugins.map(plugin => ({ ...plugin, install: installs.find(record => record.plugin_id === plugin.id) ?? null })) }; statusCache = { userId: user.id, expiresAt: Date.now() + 3_000, payload }; return Response.json(payload, { headers })
  })
}
