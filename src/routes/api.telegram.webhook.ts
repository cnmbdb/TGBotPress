import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/telegram/webhook')({ server: { handlers: {
  POST: async ({ request }) => (await import('../server/telegram-webhook.server')).telegramWebhookApi(request),
} } })
