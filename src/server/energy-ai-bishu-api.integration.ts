import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import pg from 'pg'
import {digest} from './security'
const raw=process.env.TG_ENERGY_BISHU_TEST_DB_URL,p=raw?new URL(raw):null,ip=p?.hostname.split('.').map(Number)
if(!raw||!p||!(p.hostname==='postgres'||process.env.TG_ENERGY_BISHU_TEST_ALLOW_PRIVATE_DB==='1'&&ip?.length===4&&ip[0]===172&&ip[1]>=16&&ip[1]<=31)||!p.username.startsWith('tg_energy_bishu_test_')||!p.pathname.slice(1).startsWith('tg_energy_bishu_test_'))throw Error('Requires disposable sandbox PostgreSQL test database')
Object.assign(process.env,{DB_HOST:p.hostname,DB_PORT:p.port||'5432',DB_DATABASE:p.pathname.slice(1),DB_USERNAME:p.username,DB_PASSWORD:p.password,PLATFORM_ORIGIN:'https://bishu.test'})
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
'CREATE TABLE t_platform_audit_log(rid bigserial PRIMARY KEY,admin_id bigint,action text,resource_id bigint)',
'CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_firstname text,bot_username text)',
'CREATE TABLE t_energy_platform_bot(rid int PRIMARY KEY,bot_rid int NOT NULL,poll_group char(1) NOT NULL,is_open_bishu char(1) DEFAULT \'N\')',
"CREATE TABLE t_energy_ai_bishu(rid serial PRIMARY KEY,bot_rid int NOT NULL,tg_uid varchar(100) NOT NULL,wallet_addr varchar(100) NOT NULL,status smallint DEFAULT 0,current_bandwidth_quantity bigint DEFAULT 0,current_energy_quantity bigint DEFAULT 0,is_buy char(1) DEFAULT 'N',is_notice char(1) DEFAULT 'N',is_notice_admin char(1) DEFAULT 'N',total_buy_usdt numeric(14,2) DEFAULT 0,max_buy_quantity int DEFAULT 0,total_buy_quantity int DEFAULT 0,total_buy_energy_quantity bigint DEFAULT 0,comments varchar(2000),back_comments varchar(2000),create_by int NOT NULL,create_time timestamp NOT NULL,update_by int,update_time timestamp,energy_platform_rid int,bishu_stop_day int DEFAULT 0,is_active char(1) DEFAULT 'N',active_time timestamp,last_energy_time timestamp)"
])await pool.query(sql)
await pool.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await pool.query("INSERT INTO t_admin(id,name,password) VALUES(1,'energy-bishu-admin','x')")
await pool.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day')")
const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,1,11,now()+interval '1 day')",[digest(token)])
await pool.query("INSERT INTO t_roles(id,name) VALUES(1,'manager')")
await pool.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'能量管理',NULL,0),(2,'笔数能量',NULL,1),(3,'添加地址笔数','admin.energy.aibishu.add',2),(4,'修改笔数能量','admin.energy.aibishu.update',2),(5,'删除笔数能量','admin.energy.aibishu.delete',2),(6,'刷新笔数能量','admin.energy.aibishu.refresh',2)")
await pool.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1)")
await pool.query('INSERT INTO t_role_has_permissions VALUES(1,1),(2,1),(3,1),(4,1),(5,1),(6,1)')
await pool.query("INSERT INTO t_telegram_bot(rid,bot_firstname,bot_username) VALUES(8,'Bot Eight','bot_eight'),(9,'Bot Nine','bot_nine')")
await pool.query("INSERT INTO t_energy_platform_bot(rid,bot_rid,poll_group,is_open_bishu) VALUES(1,8,'A','Y'),(2,8,'B','N'),(3,9,'A','N')")
const wallet1='T'+'1'.repeat(33),wallet2='T'+'2'.repeat(33)
await pool.query("INSERT INTO t_energy_ai_bishu(rid,bot_rid,tg_uid,wallet_addr,status,is_buy,total_buy_usdt,max_buy_quantity,total_buy_quantity,total_buy_energy_quantity,bishu_stop_day,back_comments,comments,create_by,create_time,is_active) VALUES(1,8,'12345',$1,0,'B',12.50,20,3,655000,7,'admin memo','user memo',1,now(),'Y'),(2,9,'67890',$2,1,'Y',4.00,0,2,131000,0,'','second',1,now(),'N')",[wallet1,wallet2])
await pool.query("SELECT setval(pg_get_serial_sequence('t_energy_ai_bishu','rid'),2,true)")
const {energyAiBishuApi}=await import('./energy-ai-bishu-api.server')
async function call(method='GET',query='',body?:unknown,origin='https://bishu.test'){const headers:Record<string,string>={cookie:'tg_platform_session='+token};let requestBody:BodyInit|undefined;if(method==='POST'){headers.origin=origin;headers['content-type']='application/json';requestBody=JSON.stringify(body)}const response=await energyAiBishuApi(new Request('https://bishu.test/api/energy-ai-bishu'+query,{method,headers,body:requestBody}));return{response,data:await response.json() as Record<string,any>}}
try{
 await test('笔数能量筛选、分页、状态、套餐和操作权限',async()=>{
  const all=await call();assert.equal(all.response.status,200);assert.equal(all.data.total,2);assert.equal(all.data.rows.length,2);assert.equal(all.data.rows[0].status_label,'关闭');assert.equal(all.data.rows[1].status_label,'开启');assert.equal(all.data.rows[0].is_buy_label,'需要下单');assert.equal(all.data.rows.find((r:any)=>r.rid===1).package_open,true);assert.equal((await call('GET','?tg_uid=12345')).data.total,1);assert.equal((await call('GET','?wallet_addr='+wallet2)).data.total,1);assert.equal((await call('GET','?bot_rid=8')).data.total,1);assert.equal((await call('GET','?pageSize=10')).data.pageSize,10);assert.equal((await call('GET','?action=options')).data.bots.length,2);assert.equal(new Set(all.data.bots.map((bot:any)=>bot.rid)).size,2);assert.equal(all.data.bots.find((bot:any)=>bot.rid===8)?.is_open_bishu,true);assert.equal(all.data.canAdd,true);assert.equal(all.data.canEdit,true);assert.equal(all.data.canDelete,true);assert.equal(all.data.canRefresh,true)
 })
 await test('添加、编辑、重复钱包拒绝、来源校验、刷新删除与审计',async()=>{
  const add={action:'add',bot_rid:8,tg_uid:'777',wallet_addr:'T'+'3'.repeat(33),total_buy_usdt:'0',max_buy_quantity:5,total_buy_quantity:0,bishu_stop_day:2,back_comments:'new memo'}
  assert.equal((await call('POST','',add,'https://attacker.invalid')).response.status,403)
  assert.equal((await call('POST','',add)).response.status,200)
  const inserted=(await pool.query('SELECT * FROM t_energy_ai_bishu WHERE wallet_addr=$1',[add.wallet_addr])).rows[0];assert.equal(inserted.is_active,'N');assert.equal(Number(inserted.status),0);assert.equal(inserted.back_comments,'new memo')
  assert.equal((await call('POST','',{...add,bot_rid:8})).response.status,409)
  const update={action:'update',rid:1,bot_rid:9,tg_uid:'12345',wallet_addr:wallet1,status:2,max_buy_quantity:21,total_buy_quantity:4,bishu_stop_day:8,back_comments:'changed'}
  assert.equal((await call('POST','',update)).response.status,200)
  const changed=(await pool.query('SELECT bot_rid,status,max_buy_quantity,total_buy_quantity,bishu_stop_day,back_comments FROM t_energy_ai_bishu WHERE rid=1')).rows[0];assert.equal(Number(changed.bot_rid),9);assert.equal(Number(changed.status),2);assert.equal(Number(changed.max_buy_quantity),21);assert.equal(Number(changed.total_buy_quantity),4);assert.equal(Number(changed.bishu_stop_day),8);assert.equal(changed.back_comments,'changed')
  assert.equal((await call('POST','',{action:'refresh',rid:1})).response.status,200);assert.equal((await pool.query('SELECT is_buy FROM t_energy_ai_bishu WHERE rid=1')).rows[0].is_buy,'N')
  assert.equal((await call('POST','',{action:'delete',rid:2})).response.status,200);assert.equal((await call('POST','',{action:'delete',rid:999})).response.status,404)
  const actions=(await pool.query("SELECT action FROM t_platform_audit_log ORDER BY rid")).rows.map(r=>r.action);assert.deepEqual(actions,['energy.aibishu.add','energy.aibishu.update','energy.aibishu.refresh','energy.aibishu.delete'])
 })
}finally{await pool.end()}
