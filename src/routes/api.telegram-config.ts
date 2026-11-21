import { createFileRoute } from '@tanstack/react-router'
export const Route=createFileRoute('/api/telegram-config')({server:{handlers:{
 GET:async({request})=>(await import('../server/telegram-config-api.server')).telegramConfigApi(request),
 POST:async({request})=>(await import('../server/telegram-config-api.server')).telegramConfigApi(request),
}}})
