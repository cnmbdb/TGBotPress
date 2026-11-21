import {createFileRoute} from '@tanstack/react-router'
export const Route=createFileRoute('/api/moderation')({server:{handlers:{GET:async({request})=>(await import('../plugins/registry.server')).registeredGroupManagement.admin.api(request),POST:async({request})=>(await import('../plugins/registry.server')).registeredGroupManagement.admin.api(request)}}})
