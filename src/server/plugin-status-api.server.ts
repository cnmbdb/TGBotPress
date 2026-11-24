import { can, identity, run } from './api.server'
import { db } from './db.server'
import { pluginCatalog } from '../plugins/catalog'
import { getCloneProxyLifecycleStatus, changeCloneProxyLifecycle, type CloneProxyLifecycleAction } from '../plugins/cloneproxy/lifecycle.server'
import { groupsPluginStatus, changeGroupsPlugin, type GroupPluginAction } from '../plugins/groups/lifecycle.server'
import { managedPluginStatus, changeManagedPlugin, managedModuleIds, type ManagedModuleId, type PluginLifecycleAction } from '../plugins/module-lifecycle.server'
import { enqueueBotPluginConfigRefresh, enqueuePluginConfigRefresh } from '../plugins/plugin-config-links.server'
import { pluginInstallRecords, recordBuiltinPluginInstall, recordPluginInstallFailure } from '../plugins/install-records.server'
import { trustedPackageForPlugin } from '../plugins/install-policy.server'
import { inspectNpmPluginPackage } from '../plugins/package-download.server'
import { validateThirdPartyManifest, type ThirdPartyPluginManifest } from '@tgbotpress/plugin-sdk'
import { installRemotePlugin } from '../plugins/remote-install.server'
import { pluginInstallRoot } from '../plugins/package-installer.server'
import { invalidateThirdPartyPluginRegistry, listThirdPartyPluginStatuses, setThirdPartyPluginBotEnabled, transitionThirdPartyPlugin } from '../plugins/third-party-runtime.server'

const headers = { 'Cache-Control': 'no-store' }
let statusCache: { userId: string; expiresAt: number; payload: { plugins: unknown[] } } | null = null
type User = Awaited<ReturnType<typeof identity>>
const hasModuleAccess = (user: User, plugin: typeof pluginCatalog[number]) => plugin.menuRoutes.some(route => can(user, '', route))
function stableJson(value: unknown): string {
  if(Array.isArray(value))return `[${value.map(stableJson).join(',')}]`
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value)??'null'
}

async function ensureThirdPartyPluginAvailable(packageName: string, manifest: ThirdPartyPluginManifest) {
  if(pluginCatalog.some(item=>item.id===manifest.id))throw new Error('plugin_id_reserved')
  const [installed,owner,lifecycle]=await Promise.all([
    db.query<{package_name:string;status:string}>('SELECT package_name,status FROM t_platform_plugin_install WHERE plugin_id=$1 LIMIT 1',[manifest.id]),
    db.query<{plugin_id:string}>("SELECT plugin_id FROM t_platform_plugin_install WHERE package_name=$1 AND status='installed' AND plugin_id<>$2 LIMIT 1",[packageName,manifest.id]),
    db.query<{state:string}>('SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id=$1 LIMIT 1',[manifest.id]),
  ])
  if(owner.rows[0])throw new Error('plugin_package_already_installed:'+owner.rows[0].plugin_id)
  if(installed.rows[0]&&installed.rows[0].package_name!==packageName)throw new Error('plugin_id_package_collision')
  if(installed.rows[0]?.status==='installed'||installed.rows[0]?.status==='staged')throw new Error('plugin_already_installed')
  if(lifecycle.rows[0]&&lifecycle.rows[0].state!=='uninstalled')throw new Error('plugin_lifecycle_conflict')
}

export function pluginStatusApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (request.method === 'POST') {
      const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
      if (!expected || request.headers.get('origin') !== expected || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
      const body = await request.json() as { plugin?: unknown; action?: unknown; source?: unknown; version?: unknown; integritySha512?: unknown; packageName?: unknown; confirmPermissions?: unknown; reviewedManifest?: unknown; botId?: unknown; enabled?: unknown }
      const plugin = pluginCatalog.find(item => item.id === body.plugin)
      const actions = ['disable','resume','uninstall','install','install_remote','inspect_remote','set_bot_enabled'] as const
      if (!actions.includes(String(body.action) as typeof actions[number])) return Response.json({ message: '插件操作无效' }, { status: 400, headers })
      if(body.action==='inspect_remote'&&body.source==='npmjs'){
        if(db.dialect!=='postgres')return Response.json({message:'第三方 npm 插件运行时目前要求 PostgreSQL'},{status:501,headers})
        if(!user.roles.includes('超级管理员'))return Response.json({message:'第三方插件只能由超级管理员检查'},{status:403,headers})
        if(typeof body.packageName!=='string'||typeof body.version!=='string')return Response.json({message:'请提供 npm 包名和固定版本号'},{status:400,headers})
        try {
          const inspection=await inspectNpmPluginPackage({packageName:body.packageName,version:body.version})
          await ensureThirdPartyPluginAvailable(body.packageName,inspection.manifest)
          return Response.json({ok:true,...inspection},{headers})
        } catch(error) {
          const code=error instanceof Error?error.message:'plugin_inspection_failed'
          if(code.startsWith('plugin_'))return Response.json({message:code},{status:/already_installed|collision|reserved|conflict/u.test(code)?409:422,headers})
          throw error
        }
      }
      if (body.action === 'install_remote' && body.source === 'npmjs') {
        if (db.dialect !== 'postgres') return Response.json({ message: '第三方 npm 插件运行时目前要求 PostgreSQL' }, { status: 501, headers })
        if (!user.roles.includes('超级管理员')) return Response.json({ message: '第三方插件只能由超级管理员安装' }, { status: 403, headers })
        if (typeof body.packageName !== 'string' || typeof body.version !== 'string') return Response.json({ message: '请提供 npm 包名和固定版本号' }, { status: 400, headers })
        if(body.confirmPermissions!==true||typeof body.integritySha512!=='string'||!body.reviewedManifest)return Response.json({message:'请先检查插件信息并确认所申请的权限'},{status:400,headers})
        const reviewedManifest=validateThirdPartyManifest(body.reviewedManifest)
        let discoveredPluginId: string | undefined
        try {
          const result = await installRemotePlugin({
            pool: db,
            packageName: body.packageName,
            version: body.version,
            source: 'npmjs',
            expectedManifest:reviewedManifest,
            expectedIntegritySha512:body.integritySha512,
            root: pluginInstallRoot(),
            authorizePlugin: async (pluginId, manifest) => {
              discoveredPluginId = pluginId
              await ensureThirdPartyPluginAvailable(body.packageName as string,manifest)
              if(stableJson(manifest)!==stableJson(reviewedManifest))throw new Error('plugin_npm_manifest_changed')
            },
            lifecycleInstall: async pluginId => {
              await db.query(`INSERT INTO t_platform_plugin_lifecycle(plugin_id,state,enabled_at,updated_at)
                VALUES($1,'active',now(),now()) ON CONFLICT(plugin_id) DO UPDATE SET state='active',disabled_at=NULL,enabled_at=now(),updated_at=now()`, [pluginId])
            },
          })
          invalidateThirdPartyPluginRegistry(db)
          statusCache = null
          return Response.json({ ok: true, pluginId: result.pluginId, version: result.manifest.version, state: 'active', message: '第三方插件已安装' }, { headers })
        } catch (error) {
          if (discoveredPluginId) await recordPluginInstallFailure(db, discoveredPluginId, body.packageName, body.version, error, 'npmjs').catch(() => undefined)
          const code=error instanceof Error?error.message:'plugin_install_failed'
          if(code.startsWith('plugin_'))return Response.json({message:code},{status:/already_installed|collision|reserved|conflict/u.test(code)?409:422,headers})
          throw error
        }
      }
      if (typeof body.plugin === 'string' && !plugin && ['disable','resume','uninstall','set_bot_enabled'].includes(String(body.action))) {
        if (db.dialect !== 'postgres') return Response.json({ message: '第三方 npm 插件运行时目前要求 PostgreSQL' }, { status: 501, headers })
        if (!user.roles.includes('超级管理员')) return Response.json({ message: '第三方插件只能由超级管理员管理' }, { status: 403, headers })
        try {
          if(body.action==='set_bot_enabled'){
            if(typeof body.botId!=='number'||typeof body.enabled!=='boolean')return Response.json({message:'机器人启用参数无效'},{status:400,headers})
            const result=await setThirdPartyPluginBotEnabled(db,body.plugin,body.botId,body.enabled)
            let configRefreshQueued=true
            try{await enqueueBotPluginConfigRefresh(db,[body.botId])}catch{configRefreshQueued=false}
            statusCache=null
            return Response.json({ok:true,...result,configRefreshQueued,message:configRefreshQueued?'机器人插件状态已更新':'机器人插件状态已更新，但 Telegram 命令菜单刷新暂未入队'},{headers})
          }
          const uninstallBots=body.action==='uninstall'?(await db.query<{bot_id:number}>('SELECT bot_id FROM t_platform_plugin_instance WHERE plugin_id=$1',[body.plugin])).rows.map(row=>row.bot_id):[]
          const state = await transitionThirdPartyPlugin(db, body.plugin, body.action as 'disable'|'resume'|'uninstall')
          let configRefreshQueued=true
          try{if(state==='uninstalled')await enqueueBotPluginConfigRefresh(db,uninstallBots);else await enqueuePluginConfigRefresh(db,body.plugin)}catch{configRefreshQueued=false}
          statusCache = null
          return Response.json({ ok: true, state, configRefreshQueued, message: configRefreshQueued?'插件状态已更新':'插件状态已更新，但 Telegram 命令菜单刷新暂未入队' }, { headers })
        } catch (error) {
          const code = error instanceof Error ? error.message : 'plugin_transition_failed'
          if (code.startsWith('plugin_')) return Response.json({ message: code }, { status: 409, headers })
          throw error
        }
      }
      if (!plugin) return Response.json({ message: '插件操作无效' }, { status: 400, headers })
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
            const result = await installRemotePlugin({ pool: db, pluginId: plugin.id, packageName: body.packageName, version: body.version, integritySha512: body.integritySha512, token: process.env.GITHUB_PACKAGES_TOKEN ?? '', root: pluginInstallRoot(), lifecycleInstall: async () => { await transition('install') } })
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
    const thirdParty = user.roles.includes('超级管理员') && db.dialect === 'postgres' ? await listThirdPartyPluginStatuses(db) : []
    const payload = { plugins: [...plugins.map(plugin => ({ ...plugin, install: installs.find(record => record.plugin_id === plugin.id) ?? null })), ...thirdParty] }; statusCache = { userId: user.id, expiresAt: Date.now() + 3_000, payload }; return Response.json(payload, { headers })
  })
}
