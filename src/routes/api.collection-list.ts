import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/collection-list')({ server: { handlers: {
  GET: async ({ request }) => guardManagedPluginWrite(request, 'collection', req => import('../server/collection-list-api.server').then(({ collectionListApi }) => collectionListApi(req))),
} } })
