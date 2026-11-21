import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/transit-trades')({
  server: { handlers: {
    GET: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-trades-api.server').then(({ transitTradesApi }) => transitTradesApi(req))),
    POST: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-trades-api.server').then(({ transitTradesApi }) => transitTradesApi(req))),
  } },
})
