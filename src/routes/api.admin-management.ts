import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/admin-management")({
  server: {
    handlers: {
      GET: async ({ request }) => (await import("../server/admin-management-api.server")).adminManagementApi(request),
      POST: async ({ request }) => (await import("../server/admin-management-api.server")).adminManagementApi(request),
    },
  },
})
