import { createFileRoute } from '@tanstack/react-router'
export const Route=createFileRoute('/api/plugin-config-links')({server:{handlers:{POST:async({request})=>(await import('../server/plugin-config-links-api.server')).pluginConfigLinksApi(request)}}})
