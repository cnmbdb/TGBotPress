import assert from "node:assert/strict"
import { test } from "node:test"
import pg from "pg"
import { readFile } from "node:fs/promises"
import { digest } from "./security"

const raw = process.env.TG_ADMIN_LOCALE_TEST_DB_URL
const parsed = raw ? new URL(raw) : null
const privateIp = parsed?.hostname.split(".").map(Number)
const privateHost = parsed?.hostname === "postgres" || (
  process.env.TG_ADMIN_LOCALE_TEST_ALLOW_PRIVATE_DB === "1" &&
  privateIp?.length === 4 &&
  (privateIp[0] === 10 ||
    (privateIp[0] === 172 && privateIp[1] >= 16 && privateIp[1] <= 31) ||
    (privateIp[0] === 192 && privateIp[1] === 168))
)
if (
  !raw ||
  !parsed ||
  !privateHost ||
  !parsed.username.startsWith("tg_admin_locale_test_") ||
  !parsed.pathname.slice(1).startsWith("tg_admin_locale_test_")
) {
  throw new Error("Admin locale integration requires a disposable private PostgreSQL database and role")
}

process.env.PLATFORM_DB_HOST = parsed.hostname
process.env.DB_PORT = parsed.port || "5432"
process.env.DB_DATABASE = parsed.pathname.slice(1)
process.env.DB_USERNAME = parsed.username
process.env.DB_PASSWORD = decodeURIComponent(parsed.password)
process.env.PLATFORM_ORIGIN = "https://admin-locale.test"

const setup = new pg.Pool({ connectionString: raw, max: 4 })
await setup.query("CREATE TABLE t_admin(id bigint PRIMARY KEY,name text NOT NULL,status smallint NOT NULL DEFAULT 1)")
await setup.query("CREATE TABLE t_admin_device_session(rid bigint PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamptz NOT NULL,last_seen_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked_at timestamptz)")
await setup.query("CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamptz NOT NULL)")
await setup.query("CREATE TABLE t_sys_config(config_key text NOT NULL,config_val text)")
await setup.query("CREATE TABLE t_roles(id bigint PRIMARY KEY,name text NOT NULL,guard_name text NOT NULL DEFAULT 'web')")
await setup.query("CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type text NOT NULL,model_id bigint NOT NULL)")
await setup.query("CREATE TABLE t_permissions(id bigint PRIMARY KEY,name text NOT NULL,route text,guard_name text NOT NULL DEFAULT 'web')")
await setup.query("CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type text NOT NULL,model_id bigint NOT NULL)")
await setup.query("CREATE TABLE t_role_has_permissions(role_id bigint NOT NULL,permission_id bigint NOT NULL)")
await setup.query(await readFile(new URL("../../migrations/030-platform-admin-locale.sql", import.meta.url), "utf8"))
await setup.query("INSERT INTO t_admin(id,name,status) VALUES (1,'admin-one',1),(2,'admin-two',1)")
const tokenOneDeviceA = "a".repeat(64)
const tokenOneDeviceB = "b".repeat(64)
const tokenTwo = "c".repeat(64)
await setup.query(
  "INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES (11,1,$1,now(),now(),now()+interval '1 day'),(12,1,$2,now(),now(),now()+interval '1 day'),(21,2,$3,now(),now(),now()+interval '1 day')",
  ["1".repeat(64), "2".repeat(64), "3".repeat(64)],
)
await setup.query(
  "INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES ($1,1,11,now()+interval '1 day'),($2,1,12,now()+interval '1 day'),($3,2,21,now()+interval '1 day')",
  [digest(tokenOneDeviceA), digest(tokenOneDeviceB), digest(tokenTwo)],
)

const { adminLocaleApi } = await import("./admin-locale-api.server")
function makeRequest(token: string, method: string, body?: unknown, origin = "https://admin-locale.test") {
  return new Request("https://admin-locale.test/api/admin-locale", {
    method,
    headers: {
      cookie: "tg_platform_session=" + token,
      ...(method === "POST" ? { origin, "content-type": "application/json" } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function call(token: string, method: string, body?: unknown, origin?: string) {
  const response = await adminLocaleApi(makeRequest(token, method, body, origin))
  return { response, data: await response.json() as Record<string, unknown> }
}

try {
  await test("admin locale persists per administrator and is shared across devices", async () => {
    const initial = await call(tokenOneDeviceA, "GET")
    assert.equal(initial.response.status, 200)
    assert.equal(initial.data.locale, "zh-CN")

    const saveEnglish = await call(tokenOneDeviceA, "POST", { locale: "en" })
    assert.equal(saveEnglish.response.status, 200)
    assert.equal(saveEnglish.data.locale, "en")

    const deviceB = await call(tokenOneDeviceB, "GET")
    assert.equal(deviceB.response.status, 200)
    assert.equal(deviceB.data.locale, "en")

    const saveJapanese = await call(tokenOneDeviceB, "POST", { locale: "ja" })
    assert.equal(saveJapanese.data.locale, "ja")
    assert.equal((await call(tokenOneDeviceA, "GET")).data.locale, "ja")
    assert.equal((await call(tokenTwo, "GET")).data.locale, "zh-CN")

    await call(tokenTwo, "POST", { locale: "ru" })
    assert.equal((await call(tokenOneDeviceA, "GET")).data.locale, "ja")
    assert.equal((await setup.query("SELECT locale FROM t_platform_admin_locale WHERE admin_id=1")).rows[0].locale, "ja")
    assert.equal((await setup.query("SELECT locale FROM t_platform_admin_locale WHERE admin_id=2")).rows[0].locale, "ru")
  })

  await test("admin locale rejects untrusted origins and unsupported locales", async () => {
    const badOrigin = await call(tokenOneDeviceA, "POST", { locale: "en" }, "https://wrong-origin.test")
    assert.equal(badOrigin.response.status, 403)
    const badLocale = await call(tokenOneDeviceA, "POST", { locale: "fr" })
    assert.equal(badLocale.response.status, 400)
    assert.equal((await call(tokenOneDeviceA, "GET")).data.locale, "ja")
  })
} finally {
  await setup.end()
  const { db } = await import("./db.server")
  await db.end()
}
