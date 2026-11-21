import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/shop-cdkeys')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-cdkeys-api.server').then(({ shopCdkeysApi }) => shopCdkeysApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-cdkeys-api.server').then(({ shopCdkeysApi }) => shopCdkeysApi(req))),
    },
  },
})
