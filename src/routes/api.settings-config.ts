import { createFileRoute } from "@tanstack/react-router"
export const Route = createFileRoute("/api/settings-config")({ server: { handlers: {
  GET: async ({ request }) => (await import("../server/settings-config-api.server")).settingsConfigApi(request),
  POST: async ({ request }) => (await import("../server/settings-config-api.server")).settingsConfigApi(request),
} } })
