import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/shop-orders')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-orders-api.server').then(({ shopOrdersApi }) => shopOrdersApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-orders-api.server').then(({ shopOrdersApi }) => shopOrdersApi(req))),
    },
  },
})
