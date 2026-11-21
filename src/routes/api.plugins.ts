import { createFileRoute } from '@tanstack/react-router'
const handler = async ({ request }: { request: Request }) => (await import('../server/plugin-status-api.server')).pluginStatusApi(request)
export const Route = createFileRoute('/api/plugins')({ server: { handlers: { GET: handler, POST: handler } } })
