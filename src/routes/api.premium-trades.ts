import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/premium-trades')({ server: { handlers: { GET: async ({request}) => guardManagedPluginWrite(request, 'premium', req => import('../server/premium-trade-api.server').then(({ premiumTradeApi }) => premiumTradeApi(req))), POST: async ({request}) => guardManagedPluginWrite(request, 'premium', req => import('../server/premium-trade-api.server').then(({ premiumTradeApi }) => premiumTradeApi(req))) } } })
