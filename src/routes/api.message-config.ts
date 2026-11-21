import { createFileRoute } from '@tanstack/react-router'
export const Route=createFileRoute('/api/message-config')({server:{handlers:{
 GET:async({request})=>(await import('../server/message-config-api.server')).messageConfigApi(request),
 POST:async({request})=>(await import('../server/message-config-api.server')).messageConfigApi(request),
}}})
