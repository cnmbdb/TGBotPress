import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'

export const Route=createFileRoute('/api/energy-ai-bishu')({
 server:{handlers:{
  GET:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-ai-bishu-api.server').then(({ energyAiBishuApi }) => energyAiBishuApi(req))),
  POST:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-ai-bishu-api.server').then(({ energyAiBishuApi }) => energyAiBishuApi(req))),
 }},
})
