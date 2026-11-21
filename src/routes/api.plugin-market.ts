import { createFileRoute } from '@tanstack/react-router'
const handler = async ({ request }: { request: Request }) => (await import('../server/plugin-market-api.server')).pluginMarketApi(request)
export const Route = createFileRoute('/api/plugin-market')({ server: { handlers: { GET: handler, POST: handler } } })
