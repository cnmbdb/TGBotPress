import { z } from "zod"
import { can, identity, run } from "./api.server"
import { db } from "./db.server"

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
const LICENSE_API_ORIGIN = "https://5h1-api.aloure-web.top"
const pageRoute = "admin.setting.config.index"
const writeRoute = "admin.setting.config.update"
const allowedLocalHosts = new Set(["job", "tgbot-job", "localhost", "127.0.0.1", "::1", "host.docker.internal"])
const settingKeys = ["job_url", "tronscan_api_keys", "trongrid_api_keys", "api_web_url", "license_activation"] as const
type ConfigKey = typeof settingKeys[number]
type License = { auth_code?: string; max_bots?: number; expires_at?: string | null; activated_at?: string; api_username?: string }
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
  return {
    jobUrl: String(job.url || process.env.JOB_URL || "http://tgbot-job:9501"),
    tronscanConfigured: !!String(tronscan.keys || "").trim(),
    trongridConfigured: !!String(trongrid.keys || "").trim(),
    apiSiteUrl: LICENSE_API_ORIGIN,
    apiSiteUrlEditable: false,
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
function safeApiUrl(raw: string) { return safeServiceUrl(raw, "API 授权系统") }
async function saveValue(client: import("pg").PoolClient, key: ConfigKey, value: Record<string, unknown>, adminId: string) {
  const encoded = JSON.stringify(value)
  const found = await client.query("SELECT rid FROM t_sys_config WHERE config_key=$1 ORDER BY rid LIMIT 1 FOR UPDATE", [key])
  if (found.rowCount) {
    await client.query("UPDATE t_sys_config SET config_val=$2,update_by=$3,update_time=now() WHERE rid=$1", [found.rows[0].rid, encoded, adminId])
  } else {
    const comments: Record<ConfigKey, string> = { job_url: "任务域名url", tronscan_api_keys: "TRONSCAN API Keys，逗号分隔", trongrid_api_keys: "TRONGRID API Keys，逗号分隔", api_web_url: "API连接url", license_activation: "授权激活信息" }
    await client.query("INSERT INTO t_sys_config(config_key,config_val,comments,create_by,create_time,update_by,update_time) VALUES($1,$2,$3,$4,now(),$4,now())", [key, encoded, comments[key], adminId])
  }
}
async function saveSetting(key: ConfigKey, value: Record<string, unknown>, adminId: string) {
  const client = await db.connect()
  try { await client.query("BEGIN"); await saveValue(client, key, value, adminId); await client.query("COMMIT") }
  catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
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
type Remote = { status: number; payload: Record<string, unknown> }
async function callLicenseApi(base: string, path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<Remote> {
  const url = new URL(path, `${base}/`)
  if (method === "GET") url.searchParams.set("site_url", base)
  const response = await fetch(url, { method, redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await response.text()
  if (text.length > 64_000) throw new Error("授权服务返回内容过大")
  let payload: Record<string, unknown>
  try { payload = JSON.parse(text) as Record<string, unknown> } catch { throw new Error("授权服务返回格式无效") }
  return { status: response.status, payload }
}
async function loadLicenseInfo(adminId: string) {
  const values = await configRows(), license = configValue(values.get("license_activation")) as License
  const apiSiteUrl = LICENSE_API_ORIGIN
  const info: { status: "active" | "unactivated"; maxBots: number; expiresAt: string | null; message: string; apiUser: { username: string; balance: string | null } | null } = {
    status: "unactivated", maxBots: 0, expiresAt: null, message: "", apiUser: license.api_username ? { username: license.api_username, balance: null } : null,
  }
  if (!apiSiteUrl) { info.message = "请先配置 API 网站地址"; return info }
  if (!license.auth_code) { info.message = "请先激活授权"; return info }
  let base: string
  try { base = safeApiUrl(apiSiteUrl) } catch { info.message = "API 授权系统地址无效"; return info }
  try {
    const result = await callLicenseApi(base, "/api/license/verify", "POST", { api_base_url: base, auth_code: license.auth_code })
    if (result.status < 200 || result.status >= 300 || result.payload.success !== true) {
      info.message = String(result.payload.message || "授权验证失败").slice(0, 180)
      return info
    }
    info.status = "active"
    info.maxBots = Number(result.payload.max_bots || 0)
    info.expiresAt = result.payload.expires_at == null ? null : String(result.payload.expires_at)
    info.message = "已激活"
    const username = String(result.payload.api_username || license.api_username || "")
    const balance = result.payload.api_balance == null ? null : String(result.payload.api_balance)
    if (username) info.apiUser = { username, balance }
    if (!username || balance === null) {
      try {
        const userResult = await callLicenseApi(base, "/api/license/api-user-by-site", "GET")
        const payload = userResult.payload, data = payload.data as Record<string, unknown> | undefined, apiUser = data?.apiUser as Record<string, unknown> | undefined
        if (userResult.status >= 200 && userResult.status < 300 && payload.code === 200 && apiUser) {
          const resolvedName = String(apiUser.username || username)
          const resolvedBalance = apiUser.balance == null ? balance : String(apiUser.balance)
          if (resolvedName) info.apiUser = { username: resolvedName, balance: resolvedBalance }
          if (!license.api_username && resolvedName) {
            license.api_username = resolvedName
            await saveSetting("license_activation", license as Record<string, unknown>, adminId)
          }
        }
      } catch { /* status remains available without balance details */ }
    }
  } catch { info.message = "无法连接 API 授权系统，请检查地址与网络" }
  return info
}
async function refreshBalance(adminId: string) {
  const values = await configRows(), license = configValue(values.get("license_activation")) as License
  const apiSiteUrl = LICENSE_API_ORIGIN
  if (!apiSiteUrl) return { ok: false, message: "请先配置 API 网站地址", username: license.api_username || "", balance: null }
  if (!license.auth_code) return { ok: false, message: "请先激活授权", username: license.api_username || "", balance: null }
  let base: string
  try { base = safeApiUrl(apiSiteUrl) } catch { return { ok: false, message: "API 授权系统地址无效", username: license.api_username || "", balance: null } }
  try {
    const result = await callLicenseApi(base, "/api/license/api-user-by-site", "GET")
    const data = result.payload.data as Record<string, unknown> | undefined, user = data?.apiUser as Record<string, unknown> | undefined
    if (result.status < 200 || result.status >= 300 || result.payload.code !== 200 || !user) return { ok: false, message: String(result.payload.msg || result.payload.message || "API 未返回用户信息").slice(0, 180), username: license.api_username || "", balance: null }
    const username = String(user.username || license.api_username || ""), balance = user.balance == null ? null : String(user.balance)
    if (!license.api_username && username) await saveSetting("license_activation", { ...license, api_username: username }, adminId)
    return { ok: true, message: "余额已刷新", username, balance }
  } catch { return { ok: false, message: "无法连接 API 授权系统，请检查地址与网络", username: license.api_username || "", balance: null } }
}
async function activateLicense(authCode: string, adminId: string, request: Request) {
  let base: string
  try { base = safeApiUrl(LICENSE_API_ORIGIN) } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "API 地址无效" }, { status: 400, headers }) }
  await saveSetting("api_web_url", { url: base }, adminId)
  let result: Remote
  try {
    const robotSite = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : new URL(request.url).origin
    result = await callLicenseApi(base, "/api/license/verify", "POST", { api_base_url: base, auth_code: authCode, robot_site: robotSite })
  } catch { return Response.json({ message: "API 连接失败，请检查授权系统地址和网络" }, { status: 502, headers }) }
  if (result.status === 404) return Response.json({ message: "授权接口不存在 (404)，请填写 API 授权系统的网站地址" }, { status: 400, headers })
  if (result.status < 200 || result.status >= 300 || result.payload.success !== true) return Response.json({ message: String(result.payload.message || `API 返回 HTTP ${result.status}`).slice(0, 180) }, { status: 400, headers })
  let username = String(result.payload.api_username || ""), balance = result.payload.api_balance == null ? null : String(result.payload.api_balance)
  if (!username) {
    try {
      const lookup = await callLicenseApi(base, "/api/license/api-user-by-site", "GET")
      const data = lookup.payload.data as Record<string, unknown> | undefined, user = data?.apiUser as Record<string, unknown> | undefined
      if (lookup.status >= 200 && lookup.status < 300 && lookup.payload.code === 200 && user) { username = String(user.username || ""); if (balance === null && user.balance != null) balance = String(user.balance) }
    } catch { /* optional account summary */ }
  }
  const license: License = { auth_code: authCode, max_bots: Number(result.payload.max_bots || 0), expires_at: result.payload.expires_at == null ? null : String(result.payload.expires_at), activated_at: new Date().toISOString(), api_username: username }
  await saveSetting("license_activation", license as Record<string, unknown>, adminId)
  await audit(adminId, "system.config.license.activate")
  return Response.json({ message: "激活成功", apiUser: username ? { username, balance } : null }, { headers })
}

export function settingsConfigApi(request: Request) {
  return run(async () => {
    const user = await identity(request, { allowUnlicensed: true })
    const url = new URL(request.url), action = url.searchParams.get("action") || "config"
    if (!hasPermission(user, pageRoute)) return Response.json({ message: "没有访问权限" }, { status: 403, headers })
    if (request.method === "GET") {
      if (action === "job-status") return Response.json(await requestJob("api/config/check_status"), { headers })
      if (action === "license-balance") return Response.json(await refreshBalance(user.id), { headers })
      if (action !== "config") return Response.json({ message: "操作不存在" }, { status: 404, headers })
      return Response.json({ ...(await loadSettings()), licenseInfo: await loadLicenseInfo(user.id) }, { headers })
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
        return Response.json({ code: 200, msg: "success", data: { url: saved.url } }, { headers })
      } catch (error) {
        const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 400
        return Response.json({ code: status, msg: error instanceof Error ? error.message : "图片上传失败", message: error instanceof Error ? error.message : "图片上传失败", data: "" }, { status, headers })
      }
    }
    const body = await request.json() as Record<string, unknown>
    if (body.action === "save") {
      const data = z.object({ action: z.literal("save"), jobUrl: z.string().trim().min(1).max(255), tronscanApiKeys: z.string().trim().max(400), trongridApiKeys: z.string().trim().max(400) }).strict().parse(body)
      let jobUrl: string
      try { jobUrl = safeJobUrl(data.jobUrl) } catch (error) { return Response.json({ message: error instanceof Error ? error.message : "Job 地址无效" }, { status: 400, headers }) }
      const client = await db.connect()
      try {
        await client.query("BEGIN")
        await saveValue(client, "job_url", { url: jobUrl }, user.id)
        if (data.tronscanApiKeys) await saveValue(client, "tronscan_api_keys", { keys: data.tronscanApiKeys }, user.id)
        if (data.trongridApiKeys) await saveValue(client, "trongrid_api_keys", { keys: data.trongridApiKeys }, user.id)
        await client.query("INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,NULL)", [user.id, "system.config.update"])
        await client.query("COMMIT")
      } catch (error) { await client.query("ROLLBACK"); throw error } finally { client.release() }
      return Response.json({ message: "系统配置已保存" }, { headers })
    }
    if (body.action === "activate") {
      const data = z.object({ action: z.literal("activate"), apiSiteUrl: z.string().trim().max(255).optional(), authCode: z.string().trim().min(1).max(255) }).strict().parse(body)
      return activateLicense(data.authCode, user.id, request)
    }
    if (body.action === "deactivate") {
      await db.query("DELETE FROM t_sys_config WHERE config_key='license_activation'")
      await audit(user.id, "system.config.license.deactivate")
      return Response.json({ message: "已解除授权" }, { headers })
    }
    if (body.action === "clear-job-cache") {
      const result = await requestJob("api/config/clear_timing")
      if (result.ok) await audit(user.id, "system.config.clear_job_cache")
      return Response.json(result, { status: result.ok ? 200 : 502, headers })
    }
    return Response.json({ message: "操作不存在" }, { status: 400, headers })
  })
}
