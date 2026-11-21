import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { digest } from './security'

const raw=process.env.TG_SETTINGS_PARITY_TEST_DB_URL
const dbUrl=raw?new URL(raw):null
const octets=dbUrl?.hostname.split('.').map(Number)
const privateHost=dbUrl?.hostname==='postgres'||(process.env.TG_SETTINGS_PARITY_TEST_ALLOW_PRIVATE_DB==='1'&&octets?.length===4&&(octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168)))
if(!raw||!dbUrl||!privateHost||!dbUrl.username.startsWith('settings_parity_test_')||!dbUrl.pathname.slice(1).startsWith('settings_parity_test_'))throw new Error('Settings parity integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=dbUrl.hostname;process.env.DB_PORT=dbUrl.port||'5432';process.env.DB_DATABASE=dbUrl.pathname.slice(1);process.env.DB_USERNAME=dbUrl.username;process.env.DB_PASSWORD=dbUrl.password
process.env.PLATFORM_ORIGIN='https://settings-parity.test'
const runtimeDir=await mkdtemp(join(tmpdir(),'settings-version-fixture-'))
const fakeDocker=join(runtimeDir,'docker')
const dockerLog=join(runtimeDir,'docker.log')
await writeFile(fakeDocker,'#!/bin/sh\nprintf "%s\\n" "$*" >> "$VERSION_TEST_DOCKER_LOG"\nexit 0\n')
await chmod(fakeDocker,0o755)
await writeFile(join(runtimeDir,'compose.yml'),'services: {}\n')
process.env.VERSION_TEST_DOCKER_LOG=dockerLog;process.env.PATH=`${runtimeDir}:${process.env.PATH}`
process.env.VERSION_MIN_FREE_DISK_GB='0.1';process.env.VERSION_BASE_PATH=runtimeDir;process.env.VERSION_COMPOSE_PROJECT_DIR=runtimeDir;process.env.VERSION_COMPOSE_FILES=join(runtimeDir,'compose.yml');process.env.VERSION_GIT_DIR=join(runtimeDir,'.git-metadata');process.env.VERSION_GITHUB_REPOSITORY='cnmbdb/TGBotPress';process.env.VERSION_GITHUB_BRANCH='main';process.env.VERSION_PLATFORM_IMAGE='ghcr.io/cnmbdb/tgbotpress:latest';process.env.VERSION_IMAGE_UPDATE_DRIVER='docker';process.env.APP_BUILD_COMMIT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';process.env.APP_BUILD_DATE='2026-10-29T00:00:00Z'
let manifestChecks=0
const originalFetch=globalThis.fetch
globalThis.fetch=async(input,init)=>{
 const url=String(input)
 if(url.includes('api.github.com/repos/')&&url.includes('/commits?'))return Response.json([])
 if(url.includes('api.github.com/repos/')&&url.includes('/commits/'))return Response.json({sha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',commit:{message:'Fixture version',committer:{date:'2026-10-28T00:00:00Z'}}})
 if(url.startsWith('https://ghcr.io/token?'))return Response.json({token:'fixture-token'})
 if(url.includes('/manifests/')){manifestChecks++;return new Response(JSON.stringify({config:{digest:'sha256:fixture'}}),{status:200,headers:{'content-type':'application/json','docker-content-digest':'sha256:manifest-fixture'}})}
 if(url.includes('/blobs/'))return new Response(null,{status:307,headers:{location:'https://pkg-containers.githubusercontent.com/fixture/image-config'}})
 if(url==='https://pkg-containers.githubusercontent.com/fixture/image-config')return Response.json({created:'2026-10-28T00:00:00Z',config:{Labels:{'org.opencontainers.image.revision':'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}}})
 return new Response('not mocked',{status:500})
}
const setup=new pg.Pool({connectionString:raw,max:4})
await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
await setup.query(await readFile(new URL('../../migrations/029-platform-version-image-check.sql',import.meta.url),'utf8'))
await setup.query('CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(30) NOT NULL,password varchar(255) NOT NULL,status smallint NOT NULL DEFAULT 1,white_ip text NOT NULL DEFAULT \'\',created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(64) NOT NULL,config_val text,comments text,create_by bigint,create_time timestamp,update_by bigint,update_time timestamp)')
await setup.query('CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\')')
await setup.query('CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',route varchar(255),pid integer)')
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(id bigserial PRIMARY KEY,admin_id bigint,action varchar(100) NOT NULL,resource_id bigint,created_at timestamp NOT NULL DEFAULT now())')
await setup.query("INSERT INTO t_admin(id,name,password,status) VALUES(1,'root-settings','fixture',1),(2,'editor-settings','fixture',1),(3,'reader-settings','fixture',1)")
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'超级管理员'),(2,'配置编辑员'),(3,'普通管理员')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'系统设置','admin.setting.config.index',0),(2,'配置信息','admin.setting.config.index',1),(3,'配置信息','admin.setting.config.update',2),(4,'应用升级','admin.setting.app_version.index',1),(5,'应用升级','admin.setting.app_version.update',4)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3)")
await setup.query("INSERT INTO t_model_has_permissions(permission_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',2),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',2)")
await setup.query("INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(2,1),(2,2),(2,3),(2,4),(2,5)")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\'),($3,3,13,now()+interval \'1 day\')',[digest('a'.repeat(64)),digest('b'.repeat(64)),digest('c'.repeat(64))])
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
const tokens=new Map([[1,'a'.repeat(64)],[2,'b'.repeat(64)],[3,'c'.repeat(64)]])
const {settingsConfigApi}=await import('./settings-config-api.server')
const {settingsVersionApi,refreshTanstackImageCheck}=await import('./settings-version.server')
function request(id:number,method='GET',body?:unknown,url='https://settings-parity.test/api/settings-config',origin='https://settings-parity.test'){
 const value=tokens.get(id)||''
 return new Request(url,{method,headers:{cookie:`tg_platform_session=${value}`,...(method==='POST'?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
}
async function call(api:(request:Request)=>Promise<Response>,id:number,method='GET',body?:unknown,url?:string,origin?:string){const response=await api(request(id,method,body,url||'https://settings-parity.test/api/settings-config',origin));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('system configuration masks secrets, saves only authorized values, and rejects insecure external service URLs',async()=>{
  const read=await call(settingsConfigApi,1)
  assert.equal(read.response.status,200)
  assert.equal(read.data.tronscanConfigured,false)
  assert.equal(read.data.licenseInfo.status,'unactivated')
  assert.equal((await call(settingsConfigApi,3)).response.status,403)
  const save=await call(settingsConfigApi,2,'POST',{action:'save',jobUrl:'http://job:9501',tronscanApiKeys:'fixture-secret-1,fixture-secret-2',trongridApiKeys:'fixture-secret-3'})
  assert.equal(save.response.status,200)
  assert.equal((await setup.query("SELECT config_val FROM t_sys_config WHERE config_key='tronscan_api_keys'")).rows[0].config_val,'{"keys":"fixture-secret-1,fixture-secret-2"}')
  const after=await call(settingsConfigApi,2)
  assert.equal(after.response.status,200)
  assert.equal(after.data.tronscanConfigured,true)
  assert.equal(JSON.stringify(after.data).includes('fixture-secret-1'),false)
  const insecure=await call(settingsConfigApi,2,'POST',{action:'save',jobUrl:'http://example.com',tronscanApiKeys:'',trongridApiKeys:''})
  assert.equal(insecure.response.status,400)
  assert.equal((await setup.query("SELECT config_val FROM t_sys_config WHERE config_key='job_url'")).rows[0].config_val,'{"url":"http://job:9501"}')
  assert.equal((await setup.query("SELECT action FROM t_platform_audit_log WHERE action='system.config.update'")).rows.length,1)
 })
 await test('version page read status is mocked safely and update actions require origin and permission gates',async()=>{
  const read=await call(settingsVersionApi,2,'GET',undefined,'https://settings-parity.test/api/settings-version')
  assert.equal(read.response.status,200)
  assert.equal(read.data.repository.current_sha,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(read.data.images.admin.latest_build_sha,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.equal(read.data.images.admin.name,'ghcr.io/cnmbdb/tgbotpress:latest')
  assert.equal(read.data.images.admin.service,'platform')
  assert.ok(read.data.images.admin.checked_at)
  assert.equal(read.data.images.job,undefined)
  assert.equal(read.data.update_checks.images.admin.ok,true)
  assert.equal(manifestChecks,1)
  const cached=await refreshTanstackImageCheck(undefined,{now:()=>Date.now()+24*60*60*1000})
  assert.equal(cached.skipped,true,'automatic checks reuse the three-day cached result')
  assert.equal(manifestChecks,1)
  const due=await refreshTanstackImageCheck(undefined,{now:()=>Date.now()+4*24*60*60*1000})
  assert.equal(due.skipped,false,'the next automatic poll is due after three days')
  assert.equal(manifestChecks,2)
  const update=await call(settingsVersionApi,2,'POST',{target:'images'},'https://settings-parity.test/api/settings-version')
  assert.equal(update.response.status,200)
  assert.equal(update.data.ok,true)
  assert.match(await readFile(dockerLog,'utf8'),/compose -f .* pull platform\ncompose -f .* up -d platform/)
  assert.equal((await call(settingsVersionApi,3,'GET',undefined,'https://settings-parity.test/api/settings-version')).response.status,403)
  assert.equal((await call(settingsVersionApi,3,'POST',{target:'images'},'https://settings-parity.test/api/settings-version')).response.status,403)
  const origin=await call(settingsVersionApi,1,'POST',{target:'images'},'https://settings-parity.test/api/settings-version','https://evil.test')
  assert.equal(origin.response.status,403)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_audit_log')).rows[0].n,1)
 })
}finally{globalThis.fetch=originalFetch;await setup.end();const{db}=await import('./db.server');await db.end();await rm(runtimeDir,{recursive:true,force:true})}
