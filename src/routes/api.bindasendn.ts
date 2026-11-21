import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/bindasendn')({
  server: { handlers: {
    GET: async ({ request }) => guardManagedPluginWrite(request, 'energy', req => import('../server/bindasendn-api.server').then(({ bindASendNApi }) => bindASendNApi(req))),
    POST: async ({ request }) => guardManagedPluginWrite(request, 'energy', req => import('../server/bindasendn-api.server').then(({ bindASendNApi }) => bindASendNApi(req))),
  } },
})
