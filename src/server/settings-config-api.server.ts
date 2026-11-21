import { DEFAULT_BRANDING } from "../lib/branding-defaults"
import { z } from "zod"
import { can, identity, run } from "./api.server"
import { db } from "./db.server"

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
const pageRoute = "admin.setting.config.index"
const writeRoute = "admin.setting.config.update"
const allowedLocalHosts = new Set(["job", "tgbot-job", "localhost", "127.0.0.1", "::1", "host.docker.internal"])
const settingKeys = ["job_url", "tronscan_api_keys", "trongrid_api_keys", "branding"] as const
type ConfigKey = typeof settingKeys[number]
function hasPermission(user: Awaited<ReturnType<typeof identity>>, route: string) {
  return can(user, "系统设置", pageRoute) && can(user, "配置信息", pageRoute) && can(user, "配置信息", route)
}
function validOrigin(request: Request, kind: "json" | "form" = "json") {
  const expected = process.env.PLATFORM_ORIGIN
  const contentType = request.headers.get("content-type") || ""
  try { return !!expected && request.headers.get("origin") === new URL(expected).origin && (kind === "json" ? contentType.startsWith("application/json") : contentType.startsWith("multipart/form-data")) } catch { return false }
}
function configValue(raw: unknown): Record<string, unknown> {
  try {
    let value: unknown = raw
    if (typeof value === "string") value = JSON.parse(value)
    if (typeof value === "string") value = JSON.parse(value)
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}
async function configRows() {
  const result = await db.query("SELECT config_key,config_val FROM t_sys_config WHERE config_key=ANY($1::varchar[]) ORDER BY rid", [settingKeys])
  const values = new Map<string, unknown>()
  for (const row of result.rows) values.set(row.config_key, row.config_val)
  return values
}
async function setting(key: ConfigKey) { return configValue((await configRows()).get(key)) }
async function loadSettings() {
  const values = await configRows()
  const job = configValue(values.get("job_url")), tronscan = configValue(values.get("tronscan_api_keys")), trongrid = configValue(values.get("trongrid_api_keys"))
  const branding = configValue(values.get("branding"))
  return {
    branding: { logoText: String(branding.logoText ?? DEFAULT_BRANDING.logoText), logoImageUrl: String(branding.logoImageUrl ?? DEFAULT_BRANDING.logoImageUrl), footerText: String(branding.footerText ?? DEFAULT_BRANDING.footerText), footerIconUrl: String(branding.footerIconUrl ?? DEFAULT_BRANDING.footerIconUrl), footerLinkUrl: String(branding.footerLinkUrl ?? DEFAULT_BRANDING.footerLinkUrl) },
    jobUrl: String(job.url || process.env.JOB_URL || "http://tgbot-job:9501"),
    tronscanConfigured: !!String(tronscan.keys || "").trim(),
    trongridConfigured: !!String(trongrid.keys || "").trim(),
  }
}
function safeServiceUrl(raw: string, label: string) {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error(`${label}地址格式无效`) }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`${label}地址格式无效`)
  if (url.protocol !== "https:" && !allowedLocalHosts.has(url.hostname.toLowerCase())) throw new Error(`${label}外部地址必须使用 HTTPS`)
  return url.origin
}
function safeJobUrl(raw: string) { return safeServiceUrl(raw, "Job") }
async function saveValue(client: import("pg").PoolClient, key: ConfigKey, value: Record<string, unknown>, adminId: string) {
  const encoded = JSON.stringify(value)
  const found = await client.query("SELECT rid FROM t_sys_config WHERE config_key=$1 ORDER BY rid LIMIT 1 FOR UPDATE", [key])
  if (found.rowCount) {
    await client.query("UPDATE t_sys_config SET config_val=$2,update_by=$3,update_time=now() WHERE rid=$1", [found.rows[0].rid, encoded, adminId])
  } else {
    const comments: Record<ConfigKey, string> = { job_url: "任务域名url", tronscan_api_keys: "TRONSCAN API Keys，逗号分隔", trongrid_api_keys: "TRONGRID API Keys，逗号分隔", branding: "后台品牌显示" }
    await client.query("INSERT INTO t_sys_config(config_key,config_val,comments,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$4,now())", [key, encoded, comments[key], adminId])
  }
}
async function audit(adminId: string, action: string) {
  await db.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,NULL)", [adminId, action])
}
async function requestJob(path: string) {
  const { jobUrl } = await loadSettings()
  let base: string
  try { base = safeJobUrl(jobUrl) } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Job 地址无效" } }
  try {
    const response = await fetch(`${base}/${path.replace(/^\/+/, "")}`, { method: "POST", headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return { ok: false, message: `Job 返回 HTTP ${response.status}` }
    const payload = await response.json() as { code?: number; msg?: string }
    if (payload.code !== 200) return { ok: false, message: `Job 接口返回错误：${String(payload.msg || "未知错误").slice(0, 200)}` }
    return { ok: true, message: "运行正常" }
  } catch { return { ok: false, message: "Job 无法连接或返回内容无效，请检查 Job 服务与地址" } }
}
export function settingsConfigApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    const url = new URL(request.url), action = url.searchParams.get("action") || "config"
    if (request.method === "GET" && action === "branding-image") {
      const relative=url.searchParams.get("path") || "";
      if (!/^news\/\d{8}\/[0-9a-f]+\.(png|jpg|gif|webp)$/.test(relative)) return new Response("Not found",{status:404});
      const { readFile }=await import("node:fs/promises"); const path=await import("node:path");
      try { const root=path.resolve(process.env.MEDIA_STORAGE_ROOT||"/legacy-storage/app/public"); const data=await readFile(path.join(root,relative)); const ext=relative.split(".").pop(); return new Response(data,{headers:{"Content-Type":ext==="jpg"?"image/jpeg":`image/${ext}`,"Cache-Control":"private, max-age=3600","X-Content-Type-Options":"nosniff"}}) } catch { return new Response("Not found",{status:404}) }
    }
    if (!hasPermission(user, pageRoute)) return Response.json({ message: "没有访问权限" }, { status: 403, headers })
    if (request.method === "GET") {
      if (action === "job-status") return Response.json(await requestJob("api/config/check_status"), { headers })
      if (action !== "config") return Response.json({ message: "操作不存在" }, { status: 404, headers })
      return Response.json(await loadSettings(), { headers })
    }
    if (request.method !== "POST") return Response.json({ message: "请求方式不支持" }, { status: 405, headers })
    const upload = action === "uploadfile" || action === "uploadfileNew"
    if (!validOrigin(request, upload ? "form" : "json")) return Response.json({ message: "请求来源无效" }, { status: 403, headers })
    if (!hasPermission(user, writeRoute)) return Response.json({ message: "没有操作权限" }, { status: 403, headers })
    if (upload) {
      try {
        const { boundedFormData, saveMessageImage } = await import("./media-storage.server")
        const form = await boundedFormData(request), file = form.get("file") || form.get("upfile")
        if (!(file instanceof File)) return Response.json({ code: 400, msg: "请选择图片", message: "请选择图片", data: "" }, { status: 400, headers })
        const saved = await saveMessageImage(file)
        const relative = new URL(saved.url).pathname.match(/^\/storage\/(news\/\d{8}\/[0-9a-f]+\.(?:png|jpg|gif|webp))$/)?.[1]
        const imageUrl = relative && !process.env.R2_MEDIA_GATEWAY_URL ? `/api/settings-config?action=branding-image&path=${encodeURIComponent(relative)}` : saved.url
        return Response.json({ code: 200, msg: "success", data: { url: imageUrl } }, { headers })
      } catch (error) {
        const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 400
        return Response.json({ code: status, msg: error instanceof Error ? error.message : "图片上传失败", message: error instanceof Error ? error.message : "图片上传失败", data: "" }, { status, headers })
      }
    }
    const body = await request.json() as Record<string, unknown>
    if (body.action === "save") {
      const data = z.object({ action: z.literal("save"), jobUrl: z.string().trim().min(1).max(255), tronscanApiKeys: z.string().trim().max(400), trongridApiKeys: z.string().trim().max(400), branding: z.object({logoText:z.string().max(100),logoImageUrl:z.string().max(500),footerText:z.string().max(200),footerIconUrl:z.string().trim().max(500).optional(),footerLinkUrl:z.string().trim().max(500).optional()}).strict().optional() }).strict().parse(body)
      for (const value of [data.branding?.footerIconUrl, data.branding?.footerLinkUrl]) {
        if (value && (/^[\/]{2}/.test(value) || /[\\\x00-\x1f\x7f]/.test(value))) return Response.json({ message: "底部图标或链接地址无效" }, { status: 400, headers })
        if (value && !/^\/(?!\/)/.test(value)) {
          try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error() }
          catch { return Response.json({ message: "底部图标或链接地址无效" }, { status: 400, headers }) }
        }
      }
      let jobUrl: string
      try { jobUrl = safeJobUrl(data.jobUrl) } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "Job 地址无效" }, { status: 400, headers }) }
      const client = await db.connect()
      try {
        await client.query("BEGIN")
        await saveValue(client, "job_url", { url: jobUrl }, user.id)
        if (data.branding) await saveValue(client, "branding", data.branding, user.id)
        if (data.tronscanApiKeys) await saveValue(client, "tronscan_api_keys", { keys: data.tronscanApiKeys }, user.id)
        if (data.trongridApiKeys) await saveValue(client, "trongrid_api_keys", { keys: data.trongridApiKeys }, user.id)
        await client.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,NULL)", [user.id, "system.config.update"])
        await client.query("COMMIT")
      } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
      return Response.json({ message: "系统配置已保存" }, { headers })
    }
    if (body.action === "clear-job-cache") {
      const result = await requestJob("api/config/clear_timing")
      if (result.ok) await audit(user.id, "system.config.clear_job_cache")
      return Response.json(result, { status: result.ok ? 200 : 502, headers })
    }
    return Response.json({ message: "操作不存在" }, { status: 400, headers })
  })
}
