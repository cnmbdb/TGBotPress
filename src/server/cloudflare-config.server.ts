import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import { db } from "./db.server"
import { identity, run } from "./api.server"

const headers = { "Cache-Control": "no-store" }
const schema = z.object({
  domainEnabled: z.boolean(),
  hostname: z.string().trim().max(253),
  turnstileEnabled: z.boolean(),
  turnstileSiteKey: z.string().trim().max(256),
  turnstileSecret: z.string().trim().max(512).optional(),
}).strict()
type Config = z.infer<typeof schema>
type Stored = Omit<Config, "turnstileSecret"> & { turnstileSecret: string }
function key() {
  const source = process.env.APP_KEY || process.env.APP_SECRET || ""
  if (source.length < 32) throw new Error("APP_KEY must contain at least 32 characters")
  return createHash("sha256").update(source).digest()
}
function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv)
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".")
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split(".")
  const decipher = createDecipheriv("aes-256-gcm", key(), iv ? Buffer.from(iv, "base64url") : Buffer.alloc(0))
  decipher.setAuthTag(tag ? Buffer.from(tag, "base64url") : Buffer.alloc(0))
  return Buffer.concat([decipher.update(data ? Buffer.from(data, "base64url") : Buffer.alloc(0)), decipher.final()]).toString("utf8")
}
let cachedConfig: { value: Stored; until: number } | undefined
const defaults: Stored = { domainEnabled:false, hostname:"", turnstileEnabled:false, turnstileSiteKey:"", turnstileSecret:"" }
async function readStored(): Promise<Stored> {
  if (cachedConfig && cachedConfig.until > Date.now()) return cachedConfig.value
  const q = await db.query<{config_ciphertext:string}>("SELECT config_ciphertext FROM t_platform_cloudflare_security WHERE rid=1")
  if (!q.rowCount) { cachedConfig = { value: defaults, until: Date.now() + 2000 }; return defaults }
  try {
    const raw = JSON.parse(q.rows[0].config_ciphertext) as Partial<Stored>
    const value = { ...defaults, ...raw, turnstileSecret: raw.turnstileSecret ? decrypt(raw.turnstileSecret) : "" }
    cachedConfig = { value, until: Date.now() + 2000 }
    return value
  } catch { return defaults }
}
function validHost(host:string) {
  try { return new URL("https://" + host).hostname === host && !host.includes("/") } catch { return false }
}
export async function cloudflareConfigApi(request:Request) {
  return run(async()=>{
    const user=await identity(request)
    if(!user.roles.includes("超级管理员")) return Response.json({message:"只有超级管理员可以管理 Cloudflare 设置"},{status:403,headers})
    if(request.method==="GET") {
      const v=await readStored()
      return Response.json({...v,turnstileSecret:"",turnstileSecretConfigured:!!v.turnstileSecret},{headers})
    }
    if(request.method!=="POST") return Response.json({message:"请求方法不支持"},{status:405,headers})
    const expected=process.env.PLATFORM_ORIGIN?new URL(process.env.PLATFORM_ORIGIN).origin:""
    if(!expected||request.headers.get("origin")!==expected||!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({message:"请求来源无效"},{status:403,headers})
    const raw=await request.text()
    if(raw.length>8192) return Response.json({message:"配置内容过长"},{status:413,headers})
    const input=schema.parse(JSON.parse(raw)), prior=await readStored()
    const next:Stored={...input,turnstileSecret:input.turnstileSecret||prior.turnstileSecret}
    if(next.domainEnabled&&!validHost(next.hostname)) return Response.json({message:"请输入有效的后台域名"},{status:422,headers})
    if(next.turnstileEnabled&&(!next.turnstileSiteKey||!next.turnstileSecret)) return Response.json({message:"Turnstile Site Key 和 Secret 必须配置完整"},{status:422,headers})
    const ciphertext=JSON.stringify({...next,turnstileSecret:next.turnstileSecret?encrypt(next.turnstileSecret):""})
    await db.query("INSERT INTO t_platform_cloudflare_security(rid,config_ciphertext,updated_at) VALUES(1,$1,now()) ON CONFLICT(rid) DO UPDATE SET config_ciphertext=EXCLUDED.config_ciphertext,updated_at=now()",[ciphertext])
    cachedConfig={value:next,until:Date.now()+2000}
    return Response.json({message:"Cloudflare 配置已保存",turnstileSecretConfigured:!!next.turnstileSecret},{headers})
  })
}
export async function getCloudflareConfig():Promise<Stored>{return readStored()}
export function clearCloudflareConfigCacheForTests(){cachedConfig=undefined}
