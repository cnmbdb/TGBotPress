import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/transit-wallet')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-wallet-api.server').then(({ transitWalletApi }) => transitWalletApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-wallet-api.server').then(({ transitWalletApi }) => transitWalletApi(req))),
    },
  },
})
