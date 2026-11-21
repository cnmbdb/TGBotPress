import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/monitor-wallets')({ server: { handlers: {
  GET: async ({ request }) => guardManagedPluginWrite(request, 'monitor', req => import('../server/monitor-wallets-api.server').then(({ monitorWalletsApi }) => monitorWalletsApi(req))),
  POST: async ({ request }) => guardManagedPluginWrite(request, 'monitor', req => import('../server/monitor-wallets-api.server').then(({ monitorWalletsApi }) => monitorWalletsApi(req))),
} } })
