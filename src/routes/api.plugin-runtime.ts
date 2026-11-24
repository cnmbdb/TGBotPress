import { createFileRoute } from '@tanstack/react-router'

const handler = async ({ request }: { request: Request }) => (await import('../server/plugin-runtime-api.server')).pluginRuntimeApi(request)

export const Route = createFileRoute('/api/plugin-runtime')({
  server: { handlers: { GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler } },
})
