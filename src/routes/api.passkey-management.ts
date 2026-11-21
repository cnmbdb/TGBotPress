import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/api/passkey-management')({ server: { handlers: {
  GET: async ({ request }) => (await import('../server/passkey-api.server')).passkeyManagementApi(request),
  POST: async ({ request }) => (await import('../server/passkey-api.server')).passkeyManagementApi(request),
} } })
