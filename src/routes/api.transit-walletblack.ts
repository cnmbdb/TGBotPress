import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/transit-walletblack')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-walletblack-api.server').then(({ transitWalletBlackApi }) => transitWalletBlackApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-walletblack-api.server').then(({ transitWalletBlackApi }) => transitWalletBlackApi(req))),
    },
  },
})
