import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/settings-version")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("../server/settings-version.server")).settingsVersionApi(request),
      POST: async ({ request }) => (await import("../server/settings-version.server")).settingsVersionApi(request),
    },
  },
})
