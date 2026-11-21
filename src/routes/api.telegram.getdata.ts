import { createFileRoute } from '@tanstack/react-router'

// Keep the webhook path used by existing Telegram bot records and PHP parity.
// Both public endpoints share the same secret validation and durable intake.
export const Route = createFileRoute('/api/telegram/getdata')({ server: { handlers: {
  POST: async ({ request }) => (await import('../server/telegram-webhook.server')).telegramWebhookApi(request),
} } })
