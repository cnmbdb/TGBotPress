import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/groups')({ server: { handlers: {
  GET: async ({ request }) => (await import('../plugins/registry.server')).registeredGroupManagement.admin.guard(request, req => import('../server/group-api.server').then(({ groupApi }) => groupApi(req))),
  POST: async ({ request }) => (await import('../plugins/registry.server')).registeredGroupManagement.admin.guard(request, req => import('../server/group-api.server').then(({ groupApi }) => groupApi(req))),
} } })
