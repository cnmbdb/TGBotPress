import { createFileRoute } from "@tanstack/react-router"
const handler=async({request}:{request:Request})=>(await import("../server/cloudflare-config.server")).cloudflareConfigApi(request)
export const Route=createFileRoute("/api/cloudflare-security")({server:{handlers:{GET:handler,POST:handler}}})
