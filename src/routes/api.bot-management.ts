import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/bot-management')({ server: { handlers: {
  GET: async ({ request }) => (await import('../server/bots-api.server')).botManagement(request),
  POST: async ({ request }) => (await import('../server/bots-api.server')).botManagement(request),
} } })
