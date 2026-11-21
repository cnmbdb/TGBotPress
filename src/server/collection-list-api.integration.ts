import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_COLLECTION_LIST_TEST_DB_URL,parsed=raw?new URL(raw):null,ip=parsed?.hostname.split('.').map(Number)
if(!raw||!parsed||!(parsed.hostname==='postgres'||process.env.TG_COLLECTION_LIST_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!parsed.username.startsWith('tg_collection_list_test_')||!parsed.pathname.slice(1).startsWith('tg_collection_list_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password})
const pool=new pg.Pool({connectionString:raw})
for(const sql of [
'CREATE TABLE t_admin(id bigint PRIMARY KEY,name text,password text,status smallint DEFAULT 1)',
'CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint,session_hash char(64),login_time timestamp,last_seen_at timestamp,expires_at timestamp,revoked_at timestamp)',
'CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint,device_session_id bigint,expires_at timestamp)',
'CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key text,config_val text)',
"CREATE TABLE t_roles(id bigserial PRIMARY KEY,name text,guard_name text DEFAULT 'web')",
"CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name text,guard_name text DEFAULT 'web',route text,pid int)",
'CREATE TABLE t_model_has_roles(role_id bigint,model_type text,model_id bigint)',
'CREATE TABLE t_model_has_permissions(permission_id bigint,model_type text,model_id bigint)',
'CREATE TABLE t_role_has_permissions(permission_id bigint,role_id bigint)',
't_platform_auth_ticket table stub',
'CREATE TABLE t_collection_wallet_list(rid serial PRIMARY KEY,wallet_addr varchar(200),collection_wallet_addr varchar(200),coin_name varchar(50),collection_amount numeric(16,6),collection_time timestamp,collection_hash varchar(200),create_time timestamp)'
]){if(sql==='t_platform_auth_ticket table stub')continue;await pool.query(sql)}
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'collection-list-admin','x'),(2,'collection-list-denied','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex'),deniedToken=randomBytes(32).toString('hex')
await pool.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval \'1 day\'),($2,2,12,now()+interval \'1 day\')',[digest(token),digest(deniedToken)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'reader')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'归集管理',NULL,0),(2,'归集记录','admin.collection.list.index',1)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1)')
await pool.query("INSERT INTO t_collection_wallet_list(rid,wallet_addr,collection_wallet_addr,coin_name,collection_amount,collection_time,collection_hash,create_time) VALUES(1,'TWalletAlpha','TCollectionOne','USDT',15.250000,now()-interval '2 hours','hash-one',now()-interval '2 hours'),(2,'TWalletBeta','TCollectionTwo','TRX',8.5,NULL,'hash-two',now()-interval '1 hour'),(3,'TWalletGamma','TCollectionOne','USDT',22,now(),'private-hash',now())")
await pool.query("SELECT setval(pg_get_serial_sequence('t_collection_wallet_list','rid'),3,true)")
const{collectionListApi}=await import('./collection-list-api.server')
async function call(query='',session:string|null=token,method='GET'){const response=await collectionListApi(new Request('https://collection-list.test/api/collection-list'+query,{method,headers:session?{cookie:'tg_platform_session='+session}:{}}));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('归集记录分页、钱包地址搜索、精度和敏感字段边界',async()=>{
  const all=await call();assert.equal(all.response.status,200);assert.equal(all.data.total,3);assert.equal(all.data.page,1);assert.equal(all.data.pageSize,10);assert.equal(all.data.rows[0].rid,3);assert.equal(all.data.rows[0].collection_amount,'22.000000');assert.equal(all.data.rows[0].collection_time!==null,true)
  assert.equal((await call('?search=Alpha')).data.total,1);assert.equal((await call('?search=One')).data.total,2);assert.equal((await call('?search=%25')).data.total,0);const page=await call('?page=1&pageSize=10');assert.equal(page.data.rows.length,3);assert.equal((await call('?search=TRX')).data.total,0)
  assert.equal(JSON.stringify(all.data).includes('private-hash'),true);assert.equal((await call('?page=0')).response.status,400)
 })
 await test('归集记录仅允许具备菜单权限的只读访问',async()=>{assert.equal((await call('',deniedToken)).response.status,403);assert.equal((await call('',null)).response.status,401);assert.equal((await call('',token,'POST')).response.status,405)})
}finally{await pool.end()}
