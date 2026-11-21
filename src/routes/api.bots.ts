import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/bots')({ server: { handlers: {
 GET: async ({ request }) => { const api = await import('../server/api.server'); return api.run(() => api.bots(request)) },
 POST: async ({ request }) => { const api = await import('../server/api.server'); return api.run(() => api.updateBot(request)) },
} } })
