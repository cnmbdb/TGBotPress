import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  server: {
    handlers: {
      GET: () => {
        return new Response(null, {
          status: 302,
          headers: { Location: '/console/home', 'Cache-Control': 'no-store' },
        })
      },
    },
  },
})
