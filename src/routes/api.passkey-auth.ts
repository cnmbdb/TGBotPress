import { createFileRoute } from '@tanstack/react-router'
const disabled=()=>Response.json({message:'后台登录已切换到 Cloudflare Access'},{status:410,headers:{'Cache-Control':'no-store'}})
const handle=async({request}:{request:Request})=>process.env.PLATFORM_AUTH_MODE==='cloudflare-access'?disabled():(await import('../server/passkey-api.server')).passkeyAuthApi(request)
export const Route = createFileRoute('/api/passkey-auth')({ server: { handlers: {
  GET: handle,
  POST: handle,
} } })
