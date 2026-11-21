import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/recharge-orders')({ server: { handlers: {
  GET: async ({ request }) => (await import('../plugins/registry.server')).registeredGroupManagement.admin.guard(request, req => import('../server/recharge-order-api.server').then(({ rechargeOrderApi }) => rechargeOrderApi(req))),
} } })
