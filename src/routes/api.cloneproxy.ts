import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/cloneproxy')({
  server: { handlers: {
    GET: async ({ request }) => { const url = new URL(request.url); if (!url.searchParams.has('action')) { const action = request.headers.get('x-cloneproxy-action') || 'config'; if (action) url.searchParams.set('action', action) } return (await import('../plugins/registry.server')).registeredCloneProxy.admin.api(new Request(url, request)) },
    POST: async ({ request }) => { const { guardCloneProxyWrite } = await import('../plugins/cloneproxy/lifecycle.server'); return guardCloneProxyWrite(request, req => import('../plugins/registry.server').then(({ registeredCloneProxy }) => registeredCloneProxy.admin.api(req))) },
  } },
})
