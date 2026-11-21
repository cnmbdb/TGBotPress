import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/settings-security")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("../server/admin-security.server")).adminSecurityApi(request),
      POST: async ({ request }) => (await import("../server/admin-security.server")).adminSecurityApi(request),
    },
  },
})
