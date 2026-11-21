import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/shop-goods')({
  server: {
    handlers: {
      GET: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-goods-api.server').then(({ shopGoodsApi }) => shopGoodsApi(req))),
      POST: async ({ request }) => guardManagedPluginWrite(request, 'shop', req => import('../server/shop-goods-api.server').then(({ shopGoodsApi }) => shopGoodsApi(req))),
    },
  },
})
