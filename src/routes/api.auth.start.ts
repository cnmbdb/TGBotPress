import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/auth/start')({ server: { handlers: { GET: async ({ request }) => { const api = await import('../server/api.server'); return api.run(() => api.authStart(request)) } } } })
