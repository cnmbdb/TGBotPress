import {createFileRoute} from '@tanstack/react-router'
export const Route=createFileRoute('/api/keyboard-relations')({server:{handlers:{
 GET:async({request})=>(await import('../server/keyboard-relations-api.server')).keyboardRelationsApi(request),
 POST:async({request})=>(await import('../server/keyboard-relations-api.server')).keyboardRelationsApi(request),
}}})
