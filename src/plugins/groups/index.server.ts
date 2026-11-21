import type { syncTelegramGroupMessages } from '../../server/moderation-group-updates.server'
import type { DatabaseConnection as Pool } from '../../server/database.types'
import { can, identity, run } from '../../server/api.server'
import { db } from '../../server/db.server'
import type { GroupPluginTask } from './tasks.server'
import { pluginAcceptsWrites } from '../module-lifecycle.server'
import { manifest } from '@tgbotpress/plugin-groups'

/** Group administration plugin adapter. The Telegram queue remains shared and drains normally. */
export const groupManagementPlugin = {
  id: 'groups',
  version: 1,
  manifest,
  menuRoutes: ['admin.groupuser.moderation.index', 'admin.groupuser.group.index', 'admin.groupuser.user.index', 'admin.groupuser.rechargeorder.index', 'admin.groupuser.rechargetrade.index'],
  apiRoutes: ['/api/moderation', '/api/groups', '/api/users', '/api/recharge-orders', '/api/recharge-trades'],
  dependencies: [],
  admin: { api: groupManagementApi, guard: guardGroupPluginApi },
  jobs: {
    groupMessages: {
      name: 'moderationgroupmessages',
      intervalMs: 1_000,
      run: (options: Parameters<typeof syncTelegramGroupMessages>[0]) =>
        import('../../server/moderation-group-updates.server').then(({ syncTelegramGroupMessages }) => syncTelegramGroupMessages(options)),
    },
    management: {
      name: 'groupspluginmessages',
      intervalMs: 1_000,
      run: (options: {pool?:Pick<Pool,'query'|'connect'>;logger?:Pick<Console,'error'>;shouldContinue?:()=>boolean;batchSize?:number}) =>
        import('./tasks.server').then(({syncGroupManagementTasks}) => syncGroupManagementTasks({...options,process:(task:GroupPluginTask)=>import('../../server/moderation-group-updates.server').then(({processGroupManagementPluginUpdate})=>processGroupManagementPluginUpdate({pool:options.pool??db,botRid:task.bot_rid,update:task.update_body,fetcher:fetch}))})),
    },
  },
  lifecycle: {
    status: (pool:Pick<Pool,'query'>) => import('./lifecycle.server').then(({groupsPluginStatus})=>groupsPluginStatus(pool)),
    transition: (pool:Pick<Pool,'query'|'connect'>,action:'disable'|'resume'|'uninstall'|'install') => import('./lifecycle.server').then(({changeGroupsPlugin})=>changeGroupsPlugin(pool,action)),
  },
} as const

/** Keep group-owned writes unavailable while draining/uninstalled; GET/read paths remain compatible. */
export function guardGroupPluginApi(request: Request, handler: (request: Request) => Promise<Response>) {
  return run(async () => {
    const isVerificationAction = new URL(request.url).searchParams.has('verify')
    if (request.method === 'POST' || isVerificationAction) {
      const client = await db.connect()
      try {
        await client.query("SELECT pg_advisory_lock(hashtextextended('plugin:groups:lifecycle',0))")
        const user = await identity(request)
        const canManage = can(user, '群组用户', 'admin.groupuser.moderation.index') || can(user, '群组列表', 'admin.groupuser.group.index') || can(user, '用户列表', 'admin.groupuser.user.index') || can(user, '充值订单', 'admin.groupuser.rechargeorder.index') || can(user, '充值交易', 'admin.groupuser.rechargetrade.index')
        if (!canManage) return Response.json({ message: '没有访问权限' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
        const result = await client.query<{state:string}>("SELECT state FROM t_platform_plugin_lifecycle WHERE plugin_id='groups'")
        const state = result.rows[0]?.state ?? 'active'
        if (!pluginAcceptsWrites(state)) return Response.json({ message: state === 'draining' ? '群组插件正在排空，暂不能写入群组业务' : '群组插件未安装，暂不能写入群组业务' }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
        return await handler(request)
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended('plugin:groups:lifecycle',0))").catch(()=>undefined)
        client.release()
      }
    }
    return handler(request)
  })
}

export function groupManagementApi(request: Request) {
  return guardGroupPluginApi(request, req => import('../../server/moderation-api.server').then(({ moderationApi }) => moderationApi(req)))
}
