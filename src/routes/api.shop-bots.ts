import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/shop-bots')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-bot-api.server').then(({ shopBotApi }) => shopBotApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-bot-api.server').then(({ shopBotApi }) => shopBotApi(req))),
    },
  },
})
