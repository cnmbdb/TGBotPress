import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_DASHBOARD_TEST_DB_URL, parsed=raw?new URL(raw):null, octets=parsed?.hostname.split('.').map(Number)
const privateHost=parsed?.hostname==='postgres'||(process.env.TG_DASHBOARD_TEST_ALLOW_PRIVATE_DB==='1'&&octets?.length===4&&((octets[0]===10)||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168)))
if(!raw||!parsed||!privateHost||!parsed.username.startsWith('tg_dashboard_test_')||!parsed.pathname.slice(1).startsWith('tg_dashboard_test_'))throw Error('Dashboard integration requires a disposable sandbox PostgreSQL database and role')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password})
const setup=new pg.Pool({connectionString:raw,max:4})
await setup.query('CREATE TABLE t_admin(id bigint PRIMARY KEY,name varchar(30),password varchar(100),status smallint DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint,session_hash char(64),login_time timestamp,last_seen_at timestamp,expires_at timestamp,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint,device_session_id bigint,expires_at timestamp)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50),config_val varchar(500))')
await setup.query("CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255),guard_name varchar(255) DEFAULT 'web',created_at timestamp,updated_at timestamp)")
await setup.query("CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255),guard_name varchar(255) DEFAULT 'web',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)")
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint,model_type varchar(255),model_id bigint)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint,model_type varchar(255),model_id bigint)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint,role_id bigint)')
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'licensed','x'),(2,'unlicensed','x'),(3,'unauthorized','x')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const tokens=new Map<number,string>()
for(const [admin,device] of [[1,11],[2,12],[3,13]] as const){const t=randomBytes(32).toString('hex');tokens.set(admin,t);await setup.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",[digest(t),admin,device])}
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'dashboard'),(2,'config')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'仪表盘','admin.home',0),(2,'系统设置','admin.setting.config.index',1),(3,'配置信息','admin.setting.config.index',2)")
await setup.query("INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(2,2),(2,3)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(1,'App\\Models\\Admin\\Admin',2),(2,'App\\Models\\Admin\\Admin',3)")
await setup.query('INSERT INTO t_sys_config(config_key,config_val) VALUES($1,$2)', ['license_activation', JSON.stringify({auth_code:'fixture'})])
const {me,run}=await import('./api.server')
async function call(admin:number,query=''){return run(()=>me(new Request('https://dashboard.test/api/me'+query,{headers:{cookie:'tg_platform_session='+tokens.get(admin)}})))}
try{
 await test('dashboard profile reports licensing while preserving protected legacy behavior',async()=>{let r=await call(1,'?allowUnlicensed=dashboard');let d=await r.json() as Record<string,any>;assert.equal(r.status,200);assert.equal(d.licensed,true);assert.equal(d.name,'licensed');await setup.query("UPDATE t_sys_config SET config_val='{}' WHERE config_key='license_activation'");r=await call(2,'?allowUnlicensed=dashboard');d=await r.json() as Record<string,any>;assert.equal(r.status,200);assert.equal(d.licensed,false);assert.equal((await call(2)).status,403);assert.equal((await call(3,'?allowUnlicensed=dashboard')).status,403);assert.equal((await call(3,'?allowUnlicensed=config')).status,200)})
}finally{await setup.end()}
