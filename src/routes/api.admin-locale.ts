import { createFileRoute } from '@tanstack/react-router'
const handler = async ({ request }: { request: Request }) => (await import('../server/admin-locale-api.server')).adminLocaleApi(request)
export const Route = createFileRoute('/api/admin-locale')({ server: { handlers: { GET: handler, POST: handler } } })
