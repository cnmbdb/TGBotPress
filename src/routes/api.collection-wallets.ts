import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/collection-wallets')({ server: { handlers: {
  GET: async ({ request }) => guardManagedPluginWrite(request, 'collection', req => import('../server/collection-wallets-api.server').then(({ collectionWalletsApi }) => collectionWalletsApi(req))),
  POST: async ({ request }) => guardManagedPluginWrite(request, 'collection', req => import('../server/collection-wallets-api.server').then(({ collectionWalletsApi }) => collectionWalletsApi(req))),
} } })
