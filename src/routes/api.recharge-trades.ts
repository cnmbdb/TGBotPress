import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/recharge-trades')({ server: { handlers: {
  GET: async ({ request }) => (await import('../plugins/registry.server')).registeredGroupManagement.admin.guard(request, req => import('../server/recharge-trade-api.server').then(({ rechargeTradeApi }) => rechargeTradeApi(req))),
  POST: async ({ request }) => (await import('../plugins/registry.server')).registeredGroupManagement.admin.guard(request, req => import('../server/recharge-trade-api.server').then(({ rechargeTradeApi }) => rechargeTradeApi(req))),
} } })
