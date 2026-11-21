import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/auth/logout')({ server: { handlers: { POST: async ({ request }) => { const api = await import('../server/api.server'); return api.run(() => api.logout(request)) } } } })
