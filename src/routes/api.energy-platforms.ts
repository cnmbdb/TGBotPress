import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/energy-platforms')({
  server: { handlers: {
    GET: async ({ request }) => guardManagedPluginWrite(request, 'energy', req => import('../server/energy-platform-api.server').then(({ energyPlatformApi }) => energyPlatformApi(req))),
    POST: async ({ request }) => guardManagedPluginWrite(request, 'energy', req => import('../server/energy-platform-api.server').then(({ energyPlatformApi }) => energyPlatformApi(req))),
  } },
})
