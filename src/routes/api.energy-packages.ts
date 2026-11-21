import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/energy-packages')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'energy', req => import('../server/energy-package-api.server').then(({ energyPackageApi }) => energyPackageApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'energy', req => import('../server/energy-package-api.server').then(({ energyPackageApi }) => energyPackageApi(req))),
    },
  },
})
