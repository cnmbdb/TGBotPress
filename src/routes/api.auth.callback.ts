import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/auth/callback')({ server: { handlers: { GET: async ({ request }) => { const api = await import('../server/api.server'); return api.run(() => api.authCallback(request)) } } } })
