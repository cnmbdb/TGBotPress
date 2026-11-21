import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import {createFileRoute} from '@tanstack/react-router'
export const Route=createFileRoute('/api/energy-orders')({server:{handlers:{GET:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-orders-api.server').then(({ energyOrdersApi }) => energyOrdersApi(req))),POST:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-orders-api.server').then(({ energyOrdersApi }) => energyOrdersApi(req)))}}})
