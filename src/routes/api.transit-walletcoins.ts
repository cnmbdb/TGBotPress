import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/transit-walletcoins')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-walletcoin-api.server').then(({ transitWalletCoinApi }) => transitWalletCoinApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'transit', req => import('../server/transit-walletcoin-api.server').then(({ transitWalletCoinApi }) => transitWalletCoinApi(req))),
    },
  },
})
