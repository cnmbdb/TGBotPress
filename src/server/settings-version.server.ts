import { constants, existsSync } from "node:fs"
import { access, statfs } from "node:fs/promises"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { z } from "zod"
import { identity, run } from "./api.server"
import type { DatabaseConnection as Pool } from './database.types'
import { db } from "./db.server"

const execFile = promisify(execFileCallback)
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
const targets = ["repository", "images", "admin"] as const
type Target = (typeof targets)[number]
type Json = Record<string, any>

function env(name: string, fallback = "") {
  return (process.env[name] || fallback).trim()
}
function safeRepository(value: string) {
  return /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(value) ? value : "cnmbdb/TGBotPress"
}
function safeBranch(value: string) {
  return /^[a-zA-Z0-9._/-]+$/.test(value) ? value : "main"
}
function sha(value: unknown): string | null {
  const normalized = String(value || "").trim().toLowerCase()
  return /^[a-f0-9]{7,40}$/.test(normalized) ? normalized : null
}
function date(value: unknown): string | null {
  const parsed = new Date(String(value || ""))
  return Number.isNaN(parsed.valueOf()) ? null : new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(parsed).replaceAll("/", "-")
}
function repositoryFromUrl(value: string): string | null {
  const match = value.trim().match(/github\.com[:/]([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+?)(?:\.git)?$/)
  return match?.[1] || null
}
function parseImage(value: string) {
  const match = value.match(/^ghcr\.io\/([a-zA-Z0-9._/-]+)(?::([a-zA-Z0-9._-]+))?$/)
  return match ? { repository: match[1], tag: match[2] || "latest" } : null
}
function timeoutSignal() {
  const timeout = Math.max(1000, Math.min(Number(env("VERSION_REQUEST_TIMEOUT", "6")) * 1000 || 6000, 30000))
  return AbortSignal.timeout(timeout)
}
async function requestJson(url: string, init: RequestInit = {}): Promise<{ response: Response; data: any }> {
  const response = await fetch(url, { ...init, signal: timeoutSignal(), redirect: "error" })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { response, data }
}
async function git(args: string[], cwd: string, gitDir: string) {
  try {
    const { stdout } = await execFile("git", [`--git-dir=${gitDir}`, `--work-tree=${cwd}`, ...args], {
      cwd, timeout: 6000, maxBuffer: 64 * 1024, windowsHide: true,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}
async function canRun(command: string, args: string[] = ["--version"]) {
  try {
    await execFile(command, args, { timeout: 4000, maxBuffer: 16 * 1024, windowsHide: true })
    return true
  } catch {
    return false
  }
}
const AUTO_UPDATE_CONFIG_KEY = "platform_auto_update_enabled"
async function autoUpdateStatus() {
  try {
    const result = await db.query<{ config_val: string }>("SELECT config_val FROM t_sys_config WHERE config_key=$1 ORDER BY rid DESC LIMIT 1", [AUTO_UPDATE_CONFIG_KEY])
    const token_configured = Boolean(env("RAILWAY_API_TOKEN"))
    return { enabled: token_configured && result.rows[0]?.config_val === "true", token_configured }
  } catch {
    return { enabled: false, token_configured: Boolean(env("RAILWAY_API_TOKEN")) }
  }
}
async function setAutoUpdateEnabled(enabled: boolean) {
  const updated = await db.query("UPDATE t_sys_config SET config_val=$2 WHERE config_key=$1", [AUTO_UPDATE_CONFIG_KEY, enabled ? "true" : "false"])
  if (!updated.rowCount) await db.query("INSERT INTO t_sys_config(config_key,config_val,comments,create_time,update_time) VALUES($1,$2,$3,now(),now())", [AUTO_UPDATE_CONFIG_KEY, enabled ? "true" : "false", "TGBotPress 自动更新策略"])
}

function imageConfig() {
  return {
    admin: { label: "更新版本", name: env("VERSION_PLATFORM_IMAGE", "ghcr.io/cnmbdb/tgbotpress:latest"), service: "platform" },
  } as const
}
function railwayDriver() {
  const configured = env("VERSION_IMAGE_UPDATE_DRIVER", "auto").toLowerCase()
  if (configured === "railway" || configured === "docker") return configured
  return env("RAILWAY_PROJECT_ID") && env("RAILWAY_ENVIRONMENT_ID") ? "railway" : "docker"
}
function railwayServiceName(key: string) {
  return env(key === "admin" ? "RAILWAY_PLATFORM_SERVICE_NAME" : "RAILWAY_JOB_SERVICE_NAME",
    key === "admin" ? env("RAILWAY_SERVICE_NAME", "platform") : "tgbot-job")
}
function composeProjectDir() {
  return env("VERSION_COMPOSE_PROJECT_DIR", process.cwd())
}
function composeArgs() {
  const explicit = env("VERSION_COMPOSE_FILES", env("COMPOSE_FILE"))
  const files = explicit ? explicit.split(":").map(item => item.trim()).filter(Boolean)
    : ["docker-compose.yml", "docker-compose.yaml"].map(name => `${composeProjectDir()}/${name}`).filter(existsSync).slice(0, 1)
  return files.flatMap(file => ["-f", file])
}
async function runCommand(command: string, args: string[], cwd: string, timeout = 180000) {
  try {
    const { stdout, stderr } = await execFile(command, args, {
      cwd, timeout, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, COMPOSE_PROJECT_NAME: env("COMPOSE_PROJECT_NAME", "tgbotpress") },
    })
    return { exit_code: 0, output: [stdout, stderr].filter(Boolean).join("\n").trim() }
  } catch (error: any) {
    return { exit_code: typeof error?.code === "number" ? error.code : 1,
      output: [error?.stdout, error?.stderr, error?.message].filter(Boolean).join("\n").trim() }
  }
}
async function githubHeaders() {
  const result: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "TGBotPress-Version-Status",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const token = env("VERSION_GITHUB_TOKEN")
  if (token) result.Authorization = `Bearer ${token}`
  return result
}
async function githubCommit(repository: string, branch: string) {
  try {
    const url = `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`
    const { data } = await requestJson(url, { headers: await githubHeaders() })
    const message = String(data?.commit?.message || "").trim()
    return { sha: sha(data?.sha), subject: message.split("\n")[0] || null, date: date(data?.commit?.committer?.date || data?.commit?.author?.date), source: "github_api" }
  } catch {
    return { sha: null, subject: null, date: null, source: null }
  }
}
async function githubCommits(repository: string, branch: string) {
  try {
    const since = new Date(Date.now() - 60 * 86400000).toISOString()
    const rows: Json[] = []
    for (let page = 1; page <= 20; page++) {
      const url = new URL(`https://api.github.com/repos/${repository}/commits`)
      url.searchParams.set("sha", branch)
      url.searchParams.set("since", since)
      url.searchParams.set("per_page", "100")
      url.searchParams.set("page", String(page))
      const { data } = await requestJson(url.href, { headers: await githubHeaders() })
      if (!Array.isArray(data)) return []
      rows.push(...data)
      if (data.length < 100) break
    }
    return rows.map(item => {
      const message = String(item?.commit?.message || "").trim()
      const commitSha = sha(item?.sha)
      if (!commitSha) return null
      return {
        sha: commitSha, subject: message.split("\n")[0] || "暂无提交信息",
        date: date(item?.commit?.committer?.date || item?.commit?.author?.date),
        author: String(item?.commit?.author?.name || item?.author?.login || "").trim(),
        url: String(item?.html_url || ""),
      }
    }).filter(Boolean)
  } catch { return [] }
}
async function githubRepositoryStatus(basePath: string, gitDir: string, repository: string, branch: string) {
  const currentSha = existsSync(gitDir) ? await git(["rev-parse", "HEAD"], basePath, gitDir) : null
  const remoteUrl = existsSync(gitDir) ? await git(["config", "--get", "remote.origin.url"], basePath, gitDir) : null
  const checkoutRepository = remoteUrl ? repositoryFromUrl(remoteUrl) : null
  const sourceMatches = checkoutRepository ? checkoutRepository.toLowerCase() === repository.toLowerCase() : null
  const remoteCommit = await githubCommit(repository, branch)
  let remoteSha = remoteCommit.sha
  let remoteSource = remoteCommit.source
  let subject = remoteCommit.subject
  let commitDate = remoteCommit.date
  if (!remoteSha && sourceMatches === true) {
    remoteSha = sha(await git(["rev-parse", `refs/remotes/origin/${branch}`], basePath, gitDir))
    if (remoteSha) {
      remoteSource = "local_ref"
      const line = await git(["log", "-1", "--format=%s%x1f%cI", `refs/remotes/origin/${branch}`], basePath, gitDir)
      if (line?.includes("\x1f")) {
        const [message, at] = line.split("\x1f", 2)
        subject = message || null
        commitDate = date(at)
      }
    }
  }
  const activeSha = sha(currentSha || env("APP_BUILD_COMMIT"))
  const state = sourceMatches === false ? "source_mismatch" : activeSha && remoteSha ? (activeSha === remoteSha ? "current" : "update_available") : "unknown"
  return {
    name: repository, branch, url: `https://github.com/${repository}`, current_sha: activeSha, remote_sha: remoteSha,
    commit_subject: subject, commit_date: commitDate, checkout_repository: checkoutRepository,
    source_matches: sourceMatches, remote_source: remoteSource, recent_commits: await githubCommits(repository, branch),
    state, command: sourceMatches === false ? null : `git pull --ff-only origin ${branch}`, source_available: existsSync(gitDir),
  }
}
async function fetchJobBuild() {
  try {
    const { data } = await requestJson(env("VERSION_JOB_STATUS_URL", "http://job:9501/api/config/version"))
    return { commit: sha(data?.data?.commit), built_at: String(data?.data?.built_at || "").trim(), error: null }
  } catch {
    return { commit: null, built_at: "", error: "暂时无法连接 Job 版本接口" }
  }
}
async function selectPlatformManifest(manifests: any[]) {
  const architecture = process.arch === "arm64" ? "arm64" : "amd64"
  let linuxFallback: any = null
  let firstFallback: any = null
  for (const item of manifests) {
    if (!item?.digest) continue
    firstFallback ||= item
    const platform = item.platform || {}
    if (platform.os !== "linux") continue
    linuxFallback ||= item
    if (platform.architecture === architecture) return item
  }
  return linuxFallback || firstFallback
}
async function registryDigest(imageName: string) {
  const parsed = parseImage(imageName)
  if (!parsed) return { digest: null, created_at: null, build_commit: null, error: "镜像地址格式不受支持" }
  try {
    const tokenUrl = new URL("https://ghcr.io/token")
    tokenUrl.searchParams.set("scope", `repository:${parsed.repository}:pull`)
    const ghcrToken = env("VERSION_GHCR_TOKEN", env("VERSION_GITHUB_TOKEN"))
    const ghcrUser = env("VERSION_GHCR_USERNAME", parsed.repository.split("/")[0])
    const tokenHeaders: Record<string, string> = ghcrToken ? { Authorization: "Basic " + Buffer.from(ghcrUser + ":" + ghcrToken).toString("base64") } : {}
    const { data: tokenPayload } = await requestJson(tokenUrl.href, { headers: tokenHeaders })
    const bearer = String(tokenPayload?.token || "")
    if (!bearer) throw new Error("missing GHCR token")
    const accept = [
      "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json",
      "application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json",
    ].join(", ")
    const manifestBase = "https://ghcr.io/v2/" + parsed.repository + "/manifests/"
    const manifestUrl = manifestBase + encodeURIComponent(parsed.tag)
    const manifestResult = await requestJson(manifestUrl, { headers: { Authorization: `Bearer ${bearer}`, Accept: accept } })
    let manifest = manifestResult.data
    let digest = manifestResult.response.headers.get("docker-content-digest")
    if (Array.isArray(manifest?.manifests)) {
      const selected = await selectPlatformManifest(manifest.manifests)
      if (selected?.digest) manifest = (await requestJson(manifestBase + selected.digest, { headers: { Authorization: "Bearer " + bearer, Accept: accept } })).data
    }
    let createdAt: string | null = null
    let buildCommit: string | null = null
    const configDigest = String(manifest?.config?.digest || "")
    if (configDigest) {
      const blobUrl = `https://ghcr.io/v2/${parsed.repository}/blobs/${encodeURIComponent(configDigest)}`
      let blobResponse = await fetch(blobUrl, { headers: { Authorization: `Bearer ${bearer}` }, signal: timeoutSignal(), redirect: "manual" })
      if (blobResponse.status >= 300 && blobResponse.status < 400) {
        const location = blobResponse.headers.get("location")
        if (!location) throw new Error("missing GHCR blob redirect")
        const redirected = new URL(location, blobUrl)
        if (redirected.protocol !== "https:" || redirected.hostname !== "pkg-containers.githubusercontent.com") throw new Error("untrusted GHCR blob redirect")
        blobResponse = await fetch(redirected.href, { signal: timeoutSignal(), redirect: "error" })
      }
      if (!blobResponse.ok) throw new Error("GHCR blob request failed")
      const data = await blobResponse.json()
      createdAt = date(data?.created)
      const labels = data?.config?.Labels || {}
      buildCommit = sha(labels["org.opencontainers.image.revision"])
      if (!buildCommit && Array.isArray(data?.config?.Env)) {
        const item = data.config.Env.find((value: unknown) => typeof value === "string" && value.startsWith("APP_BUILD_COMMIT="))
        if (typeof item === "string") buildCommit = sha(item.slice("APP_BUILD_COMMIT=".length))
      }
    }
    return { digest, created_at: createdAt, build_commit: buildCommit, error: null }
  } catch {
    return { digest: null, created_at: null, build_commit: null, error: "暂时无法读取 GHCR" }
  }
}
export async function refreshTanstackImageCheck(pool: Pick<Pool, "query"> = db, options: { force?: boolean; now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const nowDate = new Date(now())
  const image = imageConfig().admin
  const claimSql = "INSERT INTO t_platform_version_image_check AS current (image_key,image_name,status,checking_until,next_check_at,updated_at) " +
    "VALUES('platform',$1,'checking',$4,$3,now()) ON CONFLICT(image_key) DO UPDATE SET image_name=EXCLUDED.image_name,status='checking',checking_until=EXCLUDED.checking_until,last_error_code=NULL,updated_at=now() " +
    "WHERE (current.next_check_at<=$4 OR $2::boolean) AND (current.status<>'checking' OR current.checking_until<=$3) RETURNING image_key"
  const claim = await pool.query<{ image_key: string }>(claimSql,[image.name,options.force===true,new Date(nowDate.getTime()+120_000),nowDate])
  if (!claim.rowCount) {
    const cached = await pool.query<{image_name:string;status:string;digest:string|null;build_commit:string|null;created_at:Date|string|null;checked_at:Date|string|null;last_error_code:string|null}>("SELECT image_name,status,digest,build_commit,created_at,checked_at,last_error_code FROM t_platform_version_image_check WHERE image_key='platform'")
    if (!cached.rowCount) throw new Error('platform_image_check_claim_failed')
    const row=cached.rows[0]
    return {...row,created_at:row.created_at?date(row.created_at):null,checked_at:row.checked_at?date(row.checked_at):null,skipped:true}
  }
  let registry: Awaited<ReturnType<typeof registryDigest>>
  try { registry=await registryDigest(image.name) } catch { registry={digest:null,created_at:null,build_commit:null,error:'暂时无法读取 GHCR'} }
  const failed=Boolean(registry.error)
  const nextCheck=new Date(nowDate.getTime()+(failed?15*60*1000:3*24*60*60*1000))
  await pool.query("UPDATE t_platform_version_image_check SET image_name=$2,status=$3,digest=COALESCE($4,digest),build_commit=COALESCE($5,build_commit),created_at=COALESCE($6::timestamptz,created_at),checked_at=$7,next_check_at=$8,checking_until=NULL,last_error_code=$9,updated_at=now() WHERE image_key=$1",['platform',image.name,failed?'failed':'ready',registry.digest,registry.build_commit,registry.created_at,nowDate,nextCheck,failed?'ghcr_registry_unavailable':null])
  return {image_name:image.name,status:failed?'failed':'ready',digest:registry.digest,build_commit:registry.build_commit,created_at:registry.created_at,checked_at:date(nowDate),last_error_code:failed?'ghcr_registry_unavailable':null,skipped:false}
}
async function imageStatus(key: "admin" | "job", image: { label: string; name: string; service: string }, jobBuild: Awaited<ReturnType<typeof fetchJobBuild>>, driver: string, registry: {digest:string|null;created_at:string|null;build_commit:string|null;error:string|null;checked_at:string|null}) {
  const adminBuild = { commit: sha(env("APP_BUILD_COMMIT")), built_at: env("APP_BUILD_DATE"), error: null as string | null }
  const build = key === "job" ? jobBuild : adminBuild
  let currentSha = build.commit
  let estimated = false
  const basePath = env("VERSION_BASE_PATH", "/app")
  const gitDir = env("VERSION_GIT_DIR", "/app/.git-metadata")
  if (!currentSha && key === "admin") {
    currentSha = sha(await git(["rev-parse", "HEAD"], basePath, gitDir))
    estimated = Boolean(currentSha)
  }
  return {
    label: image.label, name: image.name, service: image.service, current_sha: currentSha, checked_at: registry.checked_at,
    build_date: build.built_at || registry.created_at, estimated, latest_digest: registry.digest,
    latest_build_sha: registry.build_commit, registry_error: registry.error, status_error: build.error,
    state: !currentSha || !registry.build_commit ? "unknown" : currentSha === registry.build_commit ? "current" : "update_available",
    driver, command: `docker compose pull ${image.service} && docker compose up -d ${image.service}`,
  }
}
async function diskStatus(basePath: string) {
  const minimum = Math.max(1, Number(env("VERSION_MIN_FREE_DISK_GB", "2")) || 2) * 1024 ** 3
  try {
    const result = await statfs(basePath)
    const free = Number(result.bavail) * Number(result.bsize)
    const total = Number(result.blocks) * Number(result.bsize)
    return { path: basePath, free_bytes: free, total_bytes: total, free_gb: Math.round(free / 1024 ** 3 * 100) / 100, minimum_gb: minimum / 1024 ** 3, sufficient: free >= minimum }
  } catch {
    return { path: basePath, free_bytes: null, total_bytes: null, free_gb: null, minimum_gb: minimum / 1024 ** 3, sufficient: false }
  }
}
async function railwayGraphql(query: string, variables: Json = {}) {
  const token = env("RAILWAY_API_TOKEN")
  if (!token) throw new Error("未配置 RAILWAY_API_TOKEN")
  const url = env("RAILWAY_GRAPHQL_URL", "https://backboard.railway.app/graphql/v2")
  const { data } = await requestJson(url, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, "Project-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  })
  if (data?.errors?.[0]?.message) throw new Error(String(data.errors[0].message))
  return data?.data || {}
}
async function railwayServiceId(key: "admin" | "job") {
  const configured = env(key === "admin" ? "RAILWAY_PLATFORM_SERVICE_ID" : "RAILWAY_JOB_SERVICE_ID", key === "admin" ? env("RAILWAY_SERVICE_ID") : "")
  if (configured) return configured
  const projectId = env("RAILWAY_PROJECT_ID")
  if (!projectId) return ""
  const data = await railwayGraphql("query ProjectServices($projectId: String!) { project(id: $projectId) { services { edges { node { id name } } } } }", { projectId })
  const rows = data?.project?.services?.edges || []
  return String(rows.find((edge: any) => edge?.node?.name === railwayServiceName(key))?.node?.id || "")
}
async function railwayCheck(key: "admin" | "job") {
  if (!env("RAILWAY_API_TOKEN")) return { ok: false, message: "未配置 RAILWAY_API_TOKEN，无法触发 Railway 新部署" }
  if (!env("RAILWAY_PROJECT_ID")) return { ok: false, message: "缺少 RAILWAY_PROJECT_ID" }
  if (!env("RAILWAY_ENVIRONMENT_ID")) return { ok: false, message: "缺少 RAILWAY_ENVIRONMENT_ID" }
  try {
    const serviceId = await railwayServiceId(key)
    if (!serviceId) return { ok: false, message: `未在项目中找到 Railway 服务：${railwayServiceName(key)}` }
    return { ok: true, message: `将为 Railway 服务创建新部署（${railwayServiceName(key)}）`, service_id: serviceId }
  } catch {
    return { ok: false, message: "Railway 服务解析失败" }
  }
}
async function getComposeUpdateCheck() {
  const files = composeArgs()
  const docker = await canRun("docker", ["compose", "version"])
  const composeExists = files.length > 0 && files.every((_, index) => index % 2 === 1 ? existsSync(files[index]) : true)
  return docker && composeExists
}
async function updateCheck(kind: "repository" | "image", details: Json, disk: Json, railwayReady: Json | null, dockerReady: boolean, basePath: string, gitDir: string) {
  if (!disk.sufficient) return { ok: false, disk_ok: false, source_ok: false, message: "本机可用磁盘空间不足" }
  if (kind === "repository") {
    if (details.source_matches !== true) return { ok: false, disk_ok: true, source_ok: false, message: "当前源码来源与生产 GitHub 仓库不一致" }
    try {
      await access(basePath, constants.W_OK); await access(gitDir, constants.W_OK)
      return { ok: true, disk_ok: true, source_ok: true, message: "检查通过" }
    } catch {
      return { ok: false, disk_ok: true, source_ok: true, message: "当前运行目录或 Git 元数据目录不可写" }
    }
  }
  if (!parseImage(String(details.name || ""))) return { ok: false, disk_ok: true, source_ok: false, message: "镜像地址不是受支持的 GHCR 地址" }
  if (details.driver === "railway") {
    return { ok: Boolean(railwayReady?.ok), disk_ok: true, source_ok: Boolean(railwayReady?.ok), message: railwayReady?.message || "Railway 新部署不可用" }
  }
  if (!dockerReady) return { ok: false, disk_ok: true, source_ok: true, message: "当前环境未提供 Docker Compose 更新能力" }
  return { ok: true, disk_ok: true, source_ok: true, message: "检查通过" }
}
async function getStatus(forceImageCheck=false) {
  const repositoryName = safeRepository(env("VERSION_GITHUB_REPOSITORY", "cnmbdb/TGBotPress"))
  const branch = safeBranch(env("VERSION_GITHUB_BRANCH", "main"))
  const basePath = env("VERSION_BASE_PATH", "/app")
  const gitDir = env("VERSION_GIT_DIR", "/app/.git-metadata")
  const driver = railwayDriver()
  const repository = await githubRepositoryStatus(basePath, gitDir, repositoryName, branch)
  const jobBuild = { commit: null, built_at: "", error: null }
  const images: Json = {}
  const config = imageConfig()
  const checked=await refreshTanstackImageCheck(db,{force:forceImageCheck})
  const registry={digest:checked.digest,created_at:checked.created_at,build_commit:checked.build_commit,error:checked.last_error_code?"暂时无法读取 GHCR":null,checked_at:checked.checked_at}
  images.admin = await imageStatus("admin",config.admin,jobBuild,driver,registry)
  const disk = await diskStatus(basePath)
  const auto_update = await autoUpdateStatus()
  const dockerReady = driver === "docker" ? await getComposeUpdateCheck() : false
  const updateChecks: Json = { repository: await updateCheck("repository", repository, disk, null, false, basePath, gitDir), images: {} }
  for (const key of ["admin"] as const) {
    const railway = driver === "railway" ? await railwayCheck(key) : null
    updateChecks.images[key] = await updateCheck("image", images[key], disk, railway, dockerReady, basePath, gitDir)
  }
  return { checked_at: date(new Date()), repository, images, disk, auto_update, update_checks: updateChecks, all_images_command: "docker compose pull platform && docker compose up -d platform" }
}
export async function runTanstackAutoUpdate() {
  const config = await autoUpdateStatus()
  if (!config.enabled || !config.token_configured) return { skipped: true, reason: config.enabled ? "railway_token_missing" : "disabled" }
  const status = await getStatus(true)
  if (status.images.admin.state !== "update_available") return { skipped: true, reason: status.images.admin.state }
  return { skipped: false, ...(await redeployRailway("images")) }
}
async function runDockerUpdate(_target: "images" | "admin") {
  const args = ["compose", ...composeArgs()]
  const pulled = await runCommand("docker", [...args, "pull", "platform"], composeProjectDir())
  if (pulled.exit_code !== 0) return pulled
  return runCommand("docker", [...args, "up", "-d", "platform"], composeProjectDir())
}
async function redeployRailway(_target: "images" | "admin") {
  const keys: ("admin" | "job")[] = ["admin"]
  const messages: string[] = []
  let ok = true
  for (const key of keys) {
    const check = await railwayCheck(key)
    if (!check.ok || !check.service_id) {
      ok = false
      messages.push(`[失败] ${check.message}`)
      continue
    }
    try {
      const data = await railwayGraphql(
        "mutation DeployLatestImage($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }",
        { environmentId: env("RAILWAY_ENVIRONMENT_ID"), serviceId: check.service_id },
      )
      if (!data?.serviceInstanceDeployV2) throw new Error("Railway 未创建新部署")
      messages.push(`[成功] 已为 ${railwayServiceName(key)} 创建新部署`)
    } catch {
      ok = false
      messages.push(`[失败] Railway 服务部署失败（${railwayServiceName(key)}）`)
    }
  }
  return { ok, message: messages.join("；"), checks: {} }
}
async function performUpdate(target: Target) {
  const status = await getStatus()
  const targetChecks = target === "images"
    ? status.update_checks.images
    : target === "repository" ? { repository: status.update_checks.repository } : { [target]: status.update_checks.images[target] }
  if (Object.values(targetChecks).some((check: any) => !check?.ok)) {
    const failed = Object.values(targetChecks).find((check: any) => !check?.ok) as any
    return { ok: false, message: failed?.message || "更新前检查未通过", checks: targetChecks }
  }
  if (target !== "repository" && railwayDriver() === "railway") return redeployRailway(target === "images" ? "images" : target)
  if (target === "repository") {
    const basePath = env("VERSION_BASE_PATH", "/app")
    const gitDir = env("VERSION_GIT_DIR", "/app/.git-metadata")
    const branch = safeBranch(env("VERSION_GITHUB_BRANCH", "main"))
    const result = await runCommand("git", [`--git-dir=${gitDir}`, `--work-tree=${basePath}`, "pull", "--ff-only", "origin", branch], basePath)
    return { ok: result.exit_code === 0, message: result.exit_code === 0 ? "源码更新已完成" : (result.output || "源码更新失败"), checks: targetChecks }
  }
  const result = await runDockerUpdate(target)
  return {
    ok: result.exit_code === 0,
    message: result.exit_code === 0
      ? "版本更新完成"
      : (result.output || "镜像更新失败"),
    checks: targetChecks,
  }
}
const updateSchema = z.object({ target: z.enum(targets).or(z.literal("auto_update")), enabled: z.boolean().optional() }).strict()
export async function settingsVersionApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    const superAdmin = user.roles.includes("超级管理员")
    const pageAllowed = superAdmin || (user.permissions.includes("系统设置") && user.permissions.includes("应用升级"))
    if (!pageAllowed) return Response.json({ message: "没有访问权限" }, { status: 403, headers })
    if (request.method === "GET") return Response.json(await getStatus(new URL(request.url).searchParams.get("refresh")==="1"), { headers })
    if (request.method !== "POST") return Response.json({ message: "不支持的请求方式" }, { status: 405, headers })
    const origin = process.env.PLATFORM_ORIGIN
    if (!origin || request.headers.get("origin") !== new URL(origin).origin || !request.headers.get("content-type")?.startsWith("application/json")) {
      return Response.json({ message: "请求来源无效" }, { status: 403, headers })
    }
    const updateAllowed = superAdmin || (user.permissions.includes("系统设置") && user.permissions.includes("应用升级")) || user.routes.includes("admin.setting.app_version.update")
    if (!updateAllowed) {
      return Response.json({ message: "没有操作权限" }, { status: 403, headers })
    }
    const parsed = updateSchema.parse(await request.json())
    if (parsed.target === "auto_update") {
      if (parsed.enabled === undefined) return Response.json({ ok: false, message: "缺少自动更新开关状态" }, { status: 400, headers })
      if (parsed.enabled && !env("RAILWAY_API_TOKEN")) return Response.json({ ok: false, message: "未配置 RAILWAY_API_TOKEN，无法开启自动更新" }, { status: 400, headers })
      await setAutoUpdateEnabled(parsed.enabled)
      const tokenConfigured = Boolean(env("RAILWAY_API_TOKEN"))
      const message = parsed.enabled
        ? tokenConfigured ? "自动更新已开启，Railway 接口已准备就绪" : "未配置 RAILWAY_API_TOKEN，无法开启自动更新"
        : "自动更新已关闭"
      return Response.json({ ok: true, message }, { headers })
    }
    const result = await performUpdate(parsed.target)
    return Response.json(result, { status: result.ok ? 200 : 400, headers })
  })
}
