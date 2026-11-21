import { guardManagedPluginWrite } from '../plugins/module-lifecycle.server'
import { createFileRoute } from '@tanstack/react-router'
export const Route=createFileRoute('/api/premium-packages')({server:{handlers:{GET:async({request})=>guardManagedPluginWrite(request, 'premium', req => import('../server/premium-packages-api.server').then(({ premiumPackagesApi }) => premiumPackagesApi(req))),POST:async({request})=>guardManagedPluginWrite(request, 'premium', req => import('../server/premium-packages-api.server').then(({ premiumPackagesApi }) => premiumPackagesApi(req)))}}})
