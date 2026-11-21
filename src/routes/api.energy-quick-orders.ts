import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import {createFileRoute} from '@tanstack/react-router'
export const Route=createFileRoute('/api/energy-quick-orders')({server:{handlers:{GET:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-quick-api.server').then(({ energyQuickApi }) => energyQuickApi(req))),POST:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-quick-api.server').then(({ energyQuickApi }) => energyQuickApi(req)))}}})
