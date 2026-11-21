import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/monitor-bots')({ server: { handlers: {
  GET: async ({ request }) => guardManagedPluginWrite(request, 'monitor', req => import('../server/monitor-bots-api.server').then(({ monitorBotsApi }) => monitorBotsApi(req))),
  POST: async ({ request }) => guardManagedPluginWrite(request, 'monitor', req => import('../server/monitor-bots-api.server').then(({ monitorBotsApi }) => monitorBotsApi(req))),
} } })
