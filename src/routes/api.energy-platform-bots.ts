import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import {createFileRoute} from '@tanstack/react-router'
export const Route=createFileRoute('/api/energy-platform-bots')({server:{handlers:{GET:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-platform-bots-api.server').then(({ energyPlatformBotsApi }) => energyPlatformBotsApi(req))),POST:async({request})=>guardManagedPluginWrite(request, 'energy', req => import('../server/energy-platform-bots-api.server').then(({ energyPlatformBotsApi }) => energyPlatformBotsApi(req)))}}})
