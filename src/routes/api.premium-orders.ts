import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/premium-orders')({ server: { handlers: { GET: async ({ request }) => guardManagedPluginWrite(request, 'premium', req => import('../server/premium-order-api.server').then(({ premiumOrderApi }) => premiumOrderApi(req))) } } })
