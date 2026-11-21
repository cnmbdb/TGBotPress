import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/system-access")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("../server/system-access-api.server")).systemAccessApi(request),
      POST: async ({ request }) => (await import("../server/system-access-api.server")).systemAccessApi(request),
    },
  },
})
