import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/transit-userwallet')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-userwallet-api.server').then(({ transitUserWalletApi }) => transitUserWalletApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-userwallet-api.server').then(({ transitUserWalletApi }) => transitUserWalletApi(req))),
    },
  },
})
