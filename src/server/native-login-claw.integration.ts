import assert from 'node:assert/strict'
import { test } from 'node:test'

const raw = process.env.TG_NATIVE_LOGIN_TEST_DB_URL
const parsed = raw ? new URL(raw) : null
if (!parsed || parsed.hostname !== 'postgres' || !parsed.username.startsWith('tg_native_login_test_') || !parsed.pathname.slice(1).startsWith('tg_native_login_test_')) throw new Error('Requires isolated sandbox PostgreSQL database')
Object.assign(process.env, { PLATFORM_DB_HOST: parsed.hostname, DB_PORT: parsed.port || '5432', DB_DATABASE: parsed.pathname.slice(1), DB_USERNAME: parsed.username, DB_PASSWORD: parsed.password, PLATFORM_ORIGIN: 'https://native-login.test' })
const { db } = await import('./db.server')
const { nativeLoginApi } = await import('./native-login-api.server')
try {
  await db.query("CREATE TABLE t_admin_security_settings(rid integer PRIMARY KEY,ip_whitelist_enabled boolean,ip_whitelist text,verification_enabled boolean,verification_method text,session_lifetime_minutes integer,passkey_config jsonb)")
  await db.query("CREATE TABLE t_platform_cloudflare_security(rid integer PRIMARY KEY,config_ciphertext text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())")
  await db.query("CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(100) UNIQUE,password varchar(255),status smallint DEFAULT 1,white_ip text DEFAULT '',security_email varchar(254),security_email_verified_at timestamp)")
  await db.query("CREATE TABLE t_platform_admin_login_rate(rate_key char(64) PRIMARY KEY,attempts integer,window_started_at timestamp)")
  await db.query("CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint,device_session_id bigint,expires_at timestamp)")
  await db.query("CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint,session_hash char(64),login_ip text,public_ip text,location text,device_type text,user_agent text,login_time timestamp,last_seen_at timestamp,expires_at timestamp,revoked_at timestamp)")
  await db.query("CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key text,config_val text)")
  await db.query("CREATE TABLE t_roles(id bigserial PRIMARY KEY,name text,guard_name text DEFAULT 'web')")
  await db.query("CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name text,route text,guard_name text DEFAULT 'web')")
  await db.query("CREATE TABLE t_model_has_roles(role_id bigint,model_type text,model_id bigint)")
  await db.query("CREATE TABLE t_model_has_permissions(permission_id bigint,model_type text,model_id bigint)")
  await db.query("CREATE TABLE t_role_has_permissions(permission_id bigint,role_id bigint)")
  await db.query("INSERT INTO t_platform_cloudflare_security(rid,config_ciphertext) VALUES(1,$1)",[JSON.stringify({domainEnabled:false,hostname:"",turnstileEnabled:false,turnstileSiteKey:"",turnstileSecret:""})])
  await db.query("INSERT INTO t_admin_security_settings VALUES(1,false,'',true,'claw',120,'{}')")
  await db.query("CREATE TABLE t_platform_admin_login_challenge(challenge_hash char(64) PRIMARY KEY,kind varchar(32) NOT NULL,value_hash char(64) NOT NULL DEFAULT '',attempts integer NOT NULL DEFAULT 0,created_at timestamp NOT NULL,expires_at timestamp NOT NULL)")
  await test('claw completion persists verified status across a new config request and rejects missing proof', async () => {
    const start = await nativeLoginApi(new Request('https://native-login.test/api/native-login?action=claw-start'))
    assert.equal(start.status,200)
    const startCookie = start.headers.get('set-cookie')?.split(';')[0]
    assert.ok(startCookie)
    await db.query("UPDATE t_platform_admin_login_challenge SET created_at=now()-interval '5 seconds' WHERE kind='claw-start'")
    const missing = await nativeLoginApi(new Request('https://native-login.test/api/native-login',{method:'POST',headers:{origin:'https://native-login.test','content-type':'application/json'},body:'{}'}))
    assert.equal(missing.status,422)
    assert.match((await missing.json() as {message:string}).message,/抓娃娃/)
    const complete = await nativeLoginApi(new Request('https://native-login.test/api/native-login',{method:'POST',headers:{origin:'https://native-login.test','content-type':'application/json',cookie:startCookie},body:'{}'}))
    assert.equal(complete.status,200)
    const verifiedCookie = complete.headers.get('set-cookie')?.split(';')[0]
    assert.ok(verifiedCookie)
    const config = await nativeLoginApi(new Request('https://native-login.test/api/native-login',{headers:{cookie:verifiedCookie}}))
    assert.equal(config.status,200)
    assert.equal((await config.json() as {clawVerified:boolean}).clawVerified,true)
    const noCookie = await nativeLoginApi(new Request('https://native-login.test/api/native-login'))
    assert.equal((await noCookie.json() as {clawVerified:boolean}).clawVerified,false)
  })

} finally { await db.end() }
