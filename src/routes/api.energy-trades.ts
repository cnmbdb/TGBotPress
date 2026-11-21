import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route=createFileRoute('/api/energy-trades')({server:{handlers:{GET:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-trade-api.server').then(({ energyTradeApi }) => energyTradeApi(req))),POST:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-trade-api.server').then(({ energyTradeApi }) => energyTradeApi(req)))}}})
