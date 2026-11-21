import { createFileRoute } from '@tanstack/react-router'
const handler = async ({ request }: { request: Request }) => (await import('../server/ets-binding-api.server')).etsBindingApi(request)
export const Route = createFileRoute('/api/ets-binding')({ server: { handlers: { GET: handler, POST: handler, DELETE: handler } } })
