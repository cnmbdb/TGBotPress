import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { digest } from './security'

const raw=process.env.TG_PASSKEY_TEST_DB_URL
const url=raw?new URL(raw):null
const octets=url?.hostname.split('.').map(Number)
const privateHost=url?.hostname==='postgres'||(process.env.TG_PASSKEY_TEST_ALLOW_PRIVATE_DB==='1'&&octets?.length===4&&(octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168)))
if(!raw||!url||!privateHost||!url.username.startsWith('passkey_test_')||!url.pathname.slice(1).startsWith('passkey_test_'))throw new Error('Passkey integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=url.hostname;process.env.DB_PORT=url.port||'5432';process.env.DB_DATABASE=url.pathname.slice(1);process.env.DB_USERNAME=url.username;process.env.DB_PASSWORD=url.password;process.env.PLATFORM_ORIGIN='https://passkey.test'
const setup=new pg.Pool({connectionString:raw,max:4,options:'-c timezone=Asia/Shanghai'})
await setup.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
await setup.query('CREATE TABLE t_admin(id bigserial PRIMARY KEY,name varchar(30) NOT NULL UNIQUE,password varchar(255) NOT NULL,status smallint NOT NULL DEFAULT 1,white_ip text NOT NULL DEFAULT \'\',passkey_user_handle varchar(64),created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_admin_login_log(rid bigserial PRIMARY KEY,admin_name varchar(30),login_time timestamp,admin_id bigint,login_location varchar(255),login_ip varchar(64),public_ip varchar(64),device_type varchar(32),user_agent text,session_hash char(64))')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_ip varchar(64),public_ip varchar(64),location varchar(255),device_type varchar(32),user_agent text,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(64) NOT NULL,config_val text)')
await setup.query('CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\')')
await setup.query('CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',route varchar(255),pid integer)')
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_admin_security_settings(rid integer PRIMARY KEY,passkey_config jsonb,ip_whitelist_enabled boolean NOT NULL DEFAULT false,ip_whitelist text NOT NULL DEFAULT \'\',session_lifetime_minutes integer NOT NULL DEFAULT 120,updated_at timestamp)')
await setup.query('CREATE TABLE t_admin_passkey(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,name varchar(80) NOT NULL,credential_id text NOT NULL UNIQUE,public_key text NOT NULL,user_handle varchar(64) NOT NULL,rp_id varchar(253) NOT NULL,sign_count bigint NOT NULL DEFAULT 0,backup_eligible boolean NOT NULL DEFAULT false,created_at timestamp NOT NULL DEFAULT now(),last_used_at timestamp,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_passkey_flow(token_hash char(64) PRIMARY KEY,purpose varchar(16) NOT NULL,admin_id bigint,session_hash char(64),origin text NOT NULL,settings_hash char(64) NOT NULL,challenge varchar(200) NOT NULL,user_handle varchar(64),password_hash varchar(255),created_at timestamp NOT NULL DEFAULT now(),expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_platform_passkey_reauth_attempt(admin_id bigint PRIMARY KEY,attempts integer NOT NULL DEFAULT 0,locked_until timestamp,updated_at timestamp NOT NULL DEFAULT now())')
await setup.query('CREATE TABLE t_sys_admin_opt_log(rid bigserial PRIMARY KEY,admin_id bigint,opt_module varchar(100),opt_ref_sn char(64),opt_time timestamp,opt_content text)')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
const password=await bcrypt.hash('AdminPass!234',4)
await setup.query('INSERT INTO t_admin(id,name,password,status) VALUES(1,$1,$2,1),(2,$3,$2,1)',['root-passkey',password,'reader-passkey'])
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'超级管理员'),(2,'Passkey 查看员')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'系统设置','admin.setting.security.index',0)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2)")
await setup.query("INSERT INTO t_model_has_permissions(permission_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',2)")
await setup.query("INSERT INTO t_admin_security_settings(rid,passkey_config) VALUES(1,'{}')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,$1,now(),now(),now()+interval '1 day'),(12,2,$2,now(),now(),now()+interval '1 day')",[digest('a'.repeat(64)),digest('b'.repeat(64))])
await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\')',[digest('a'.repeat(64)),digest('b'.repeat(64))])
const b64=(value:Buffer)=>value.toString('base64url')
function cborBytes(value:Buffer){return Buffer.concat([Buffer.from([0x58,value.length]),value])}
function makeAuthenticatorData(challenge:string,origin:string,credentialId:Buffer,key:any,registration:boolean){
 const jwk=key?.publicKey.export({format:'jwk'}) as JsonWebKey
 const x=Buffer.from(String(jwk.x),'base64url'),y=Buffer.from(String(jwk.y),'base64url')
 const cose=Buffer.concat([Buffer.from([0xa5,0x01,0x02,0x03,0x26,0x20,0x01,0x21,0x58,0x20]),x,Buffer.from([0x22,0x58,0x20]),y])
 const rpHash=createHash('sha256').update(new URL(origin).hostname).digest()
 const counter=Buffer.alloc(4);counter.writeUInt32BE(registration?0:1)
 const prefix=Buffer.concat([rpHash,Buffer.from([registration?0x45:0x05]),counter])
 if(!registration)return prefix
 const length=Buffer.alloc(2);length.writeUInt16BE(credentialId.length)
 return Buffer.concat([prefix,Buffer.alloc(16),length,credentialId,cose])
}
function attestationObject(authData:Buffer){
 return Buffer.concat([Buffer.from([0xa3,0x63]),Buffer.from('fmt'),Buffer.from([0x64]),Buffer.from('none'),Buffer.from([0x67]),Buffer.from('attStmt'),Buffer.from([0xa0,0x68]),Buffer.from('authData'),cborBytes(authData)])
}
const tokens=new Map([[1,'a'.repeat(64)],[2,'b'.repeat(64)]])
const {passkeyManagementApi,passkeyAuthApi}=await import('./passkey-api.server')
function request(id:number,body?:unknown,origin='https://passkey.test'){return new Request('https://passkey.test/api/passkey-management',{method:body?'POST':'GET',headers:{cookie:`tg_platform_session=${tokens.get(id)||''}`,...(body?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})}
async function call(api:(request:Request)=>Promise<Response>,id:number,body?:unknown,origin?:string){const response=await api(request(id,body,origin));return{response,data:await response.json() as Record<string,any>}}
try {
 await test('Passkey settings, reauthentication, registration and login option flows enforce role, origin and one-time challenge gates',async()=>{
  const initial=await call(passkeyManagementApi,1)
  assert.equal(initial.response.status,200)
  assert.equal(initial.data.settings.enabled,false)
  assert.equal((await call(passkeyManagementApi,2)).data.canManage,false)
  const settings={enabled:true,rp_name:'TG Ultra',rp_id:'passkey.test',origins:['https://passkey.test'],user_verification:'required',attachment:'',allow_insecure_origin:false}
  assert.equal((await call(passkeyManagementApi,2,{action:'save-settings',password:'AdminPass!234',settings})).response.status,403)
  assert.equal((await call(passkeyManagementApi,1,{action:'save-settings',password:'bad',settings})).response.status,422)
  assert.equal((await setup.query('SELECT attempts FROM t_platform_passkey_reauth_attempt WHERE admin_id=1')).rows[0].attempts,1)
  assert.equal((await call(passkeyManagementApi,1,{action:'save-settings',password:'AdminPass!234',settings},'https://evil.test')).response.status,403)
  const saved=await call(passkeyManagementApi,1,{action:'save-settings',password:'AdminPass!234',settings})
  assert.equal(saved.response.status,200)
  assert.equal(saved.data.settings.enabled,true)
  assert.equal((await call(passkeyAuthApi,0)).data.enabled,true)
  const wrongRp={...settings,rp_id:'evil.test'}
  assert.equal((await call(passkeyManagementApi,1,{action:'save-settings',password:'AdminPass!234',settings:wrongRp})).response.status,422)
  const registration=await call(passkeyManagementApi,1,{action:'register-options',password:'AdminPass!234'})
  assert.equal(registration.response.status,200)
  assert.ok(registration.data.options.challenge)
  assert.ok(registration.data.flow_token)
  assert.ok((await setup.query('SELECT passkey_user_handle FROM t_admin WHERE id=1')).rows[0].passkey_user_handle)
  const badRegistration=await call(passkeyManagementApi,1,{action:'register-finish',flow_token:registration.data.flow_token,credential:{id:'fixture',rawId:'fixture',type:'public-key',response:{}}})
  assert.equal(badRegistration.response.status,422)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_admin_passkey')).rows[0].n,0)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_passkey_flow WHERE purpose=\'register\'')).rows[0].n,0)
  const registration2=await call(passkeyManagementApi,1,{action:'register-options',password:'AdminPass!234'})
  assert.equal(registration2.response.status,200)
  const credentialId=randomBytes(32),credentialIdB64=b64(credentialId),keyPair=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
  const clientData=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:registration2.data.options.challenge,origin:'https://passkey.test'}))
  const registrationAuthData=makeAuthenticatorData(registration2.data.options.challenge,'https://passkey.test',credentialId,keyPair,true)
  const registrationCredential={id:credentialIdB64,rawId:credentialIdB64,type:'public-key',response:{clientDataJSON:b64(clientData),attestationObject:b64(attestationObject(registrationAuthData)),transports:['internal']}}
  try { await verifyRegistrationResponse({response:registrationCredential as any,expectedChallenge:registration2.data.options.challenge,expectedOrigin:'https://passkey.test',expectedRPID:'passkey.test',requireUserVerification:true}) } catch(error) { assert.fail(error instanceof Error ? error.message : String(error)) }
  const registrationFinish=await call(passkeyManagementApi,1,{action:'register-finish',flow_token:registration2.data.flow_token,name:'Fixture key',credential:registrationCredential})
  assert.equal(registrationFinish.response.status,200,registrationFinish.data.message)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_admin_passkey WHERE credential_id=$1 AND revoked_at IS NULL',[credentialIdB64])).rows[0].n,1)
  const auth=await call(passkeyAuthApi,0,{action:'options'})
  assert.equal(auth.response.status,200)
  assert.ok(auth.data.options.challenge)
  assert.ok(auth.data.flow_token)
  const authClientData=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:auth.data.options.challenge,origin:'https://passkey.test'}))
  const authData=makeAuthenticatorData(auth.data.options.challenge,'https://passkey.test',credentialId,keyPair,false)
  const handle=(await setup.query('SELECT passkey_user_handle FROM t_admin WHERE id=1')).rows[0].passkey_user_handle
  const signedData=Buffer.concat([authData,createHash('sha256').update(authClientData).digest()])
  const signature=sign('sha256',signedData,keyPair.privateKey)
  const login=await call(passkeyAuthApi,0,{action:'finish',flow_token:auth.data.flow_token,credential:{id:credentialIdB64,rawId:credentialIdB64,type:'public-key',response:{clientDataJSON:b64(authClientData),authenticatorData:b64(authData),signature:b64(signature),userHandle:handle}}})
  assert.equal(login.response.status,200,login.data.message)
  assert.match(login.response.headers.get('set-cookie')||'',/tg_platform_session=/)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_session WHERE admin_id=1')).rows[0].n,2)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_admin_login_log WHERE admin_id=1')).rows[0].n,1)
  assert.equal((await setup.query('SELECT count(*)::int AS n FROM t_platform_passkey_flow WHERE purpose=\'login\'')).rows[0].n,0)
  assert.equal((await call(passkeyAuthApi,0,{action:'options'},'https://evil.test')).response.status,403)
  await setup.query("INSERT INTO t_admin_passkey(admin_id,name,credential_id,public_key,user_handle,rp_id) VALUES(1,'old key','credential-old','b64:AQ','fixture-handle','passkey.test')")
  const revoked=await call(passkeyManagementApi,1,{action:'revoke',rid:1,password:'AdminPass!234'})
  assert.equal(revoked.response.status,200)
  assert.ok((await setup.query('SELECT revoked_at FROM t_admin_passkey WHERE rid=1')).rows[0].revoked_at)
  assert.equal((await setup.query("SELECT count(*)::int AS n FROM t_sys_admin_opt_log WHERE admin_id=1")).rows[0].n,4)
 })
} finally {
 await setup.end()
 const {db}=await import('./db.server')
 await db.end()
}
