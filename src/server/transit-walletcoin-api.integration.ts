import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw=process.env.TG_TRANSIT_WALLETCOINS_TEST_DB_URL, parsed=raw?new URL(raw):null, parts=parsed?.hostname.split('.').map(Number)
const privateHost=parsed?.hostname==='postgres'||(process.env.TG_TRANSIT_WALLETCOINS_TEST_ALLOW_PRIVATE_DB==='1'&&parts?.length===4&&(parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168)))
if(!raw||!parsed||!privateHost||!parsed.username.startsWith('tg_transit_walletcoins_test_')||!parsed.pathname.slice(1).startsWith('tg_transit_walletcoins_test_'))throw new Error('Transit wallet coin integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=parsed.hostname;process.env.DB_PORT=parsed.port||'5432';process.env.DB_DATABASE=parsed.pathname.slice(1);process.env.DB_USERNAME=parsed.username;process.env.DB_PASSWORD=parsed.password;process.env.PLATFORM_ORIGIN='https://walletcoins.test'
const setup=new pg.Pool({connectionString:raw,max:4})
await setup.query('CREATE TABLE t_admin(id bigint PRIMARY KEY,name varchar(30) NOT NULL,password varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query("CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',created_at timestamp,updated_at timestamp)")
await setup.query("CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT 'web',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)")
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_platform_audit_log(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,action varchar(100) NOT NULL,resource_id bigint,created_at timestamp NOT NULL DEFAULT now())')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'full-editor','fixture'),(2,'limited-editor','fixture'),(3,'other-page','fixture')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const tokens=new Map<number,string>();for(const[id,device]of[[1,11],[2,12],[3,13]]as const){const value=randomBytes(32).toString('hex');tokens.set(id,value);await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval \'1 day\')',[digest(value),id,device])}
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'币种完整权限'),(2,'仅查看和编辑'),(3,'其他闪兑页面')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'闪兑管理',NULL,0),(2,'闪兑币种','admin.transit.walletcoin.index',1),(3,'添加闪兑币种','admin.transit.walletcoin.add',2),(4,'修改闪兑币种','admin.transit.walletcoin.update',2),(5,'删除闪兑币种','admin.transit.walletcoin.delete',2),(6,'闪兑钱包','admin.transit.wallet.index',1)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(1,2),(1,3),(1,4),(1,5),(2,1),(2,2),(2,4),(3,1),(3,6)')
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3)")
await setup.query(`CREATE TABLE t_transit_wallet(rid integer PRIMARY KEY,receive_wallet varchar(200) NOT NULL,send_wallet varchar(200) NOT NULL,status smallint NOT NULL DEFAULT 1)`)
await setup.query("INSERT INTO t_transit_wallet VALUES(1,'receive-wallet-one','send-wallet-one',1),(2,'receive-wallet-two','send-wallet-two',1)")
await setup.query(`CREATE TABLE t_transit_wallet_coin(rid serial PRIMARY KEY,transit_wallet_id integer NOT NULL,in_coin_name varchar(20) NOT NULL,out_coin_name varchar(20) NOT NULL,is_realtime_rate smallint NOT NULL DEFAULT 1,profit_rate numeric(4,2) NOT NULL DEFAULT 1,exchange_rate numeric(8,2) NOT NULL DEFAULT 0,kou_out_amount numeric(8,2) NOT NULL DEFAULT 0,min_transit_amount integer NOT NULL,max_transit_amount integer NOT NULL,comments varchar(255),create_time timestamp,update_time timestamp)`)
await setup.query(`INSERT INTO t_transit_wallet_coin(rid,transit_wallet_id,in_coin_name,out_coin_name,is_realtime_rate,profit_rate,exchange_rate,kou_out_amount,min_transit_amount,max_transit_amount,comments,create_time) VALUES(1,1,'usdt','trx',3,.10,8.76,0,1,200,'seed',timestamp '2026-10-01 10:00:00'),(2,2,'trx','usdt',2,.20,1.25,2.5,5,500,'second',timestamp '2026-10-02 10:00:00')`)
await setup.query("SELECT setval(pg_get_serial_sequence('t_transit_wallet_coin','rid'),2)")
const{transitWalletCoinApi}=await import('./transit-walletcoin-api.server')
function request(admin:number,method='GET',query='',body?:unknown,origin='https://walletcoins.test',contentType='application/json'){return new Request('https://walletcoins.test/api/transit-walletcoins'+query,{method,headers:{cookie:`tg_platform_session=${tokens.get(admin)}`,...(method==='POST'?{origin,'content-type':contentType}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function call(admin:number,method='GET',query='',body?:unknown,origin?:string,contentType?:string){const response=await transitWalletCoinApi(request(admin,method,query,body,origin,contentType));return{response,data:await response.json() as Record<string,any>}}
const payload={transit_wallet_id:1,in_coin_name:'trx',out_coin_name:'usdt',is_realtime_rate:2,profit_rate:'0.15',exchange_rate:'6.50',kou_out_amount:'1.25',min_transit_amount:10,max_transit_amount:100,comments:'new config'}
try{
 await test('wallet coin read API returns joined values, rate labels, wallet options and filters',async()=>{
  const all=await call(1);assert.equal(all.response.status,200);assert.equal(all.data.total,2);assert.equal(all.data.rows[0].rid,2);assert.equal(all.data.rows[0].receive_wallet,'receive-wallet-two');assert.equal(all.data.rows[0].is_realtime_rate_label,'固定汇率');assert.equal(all.data.rows[1].is_realtime_rate_label,'实时 · 百分比');assert.equal(all.data.canAdd,true);assert.equal(all.data.canEdit,true);assert.equal(all.data.canDelete,true)
  const options=await call(1,'GET','?action=options');assert.deepEqual(options.data.wallets.map((w:any)=>w.rid),[2,1]);assert.equal('send_wallet_privatekey' in options.data.wallets[0],false)
  assert.equal((await call(1,'GET','?walletId=1')).data.total,1);assert.equal((await call(1,'GET','?search=send-wallet-two')).data.rows[0].rid,2)
  const editor=await call(2);assert.equal(editor.response.status,200);assert.equal(editor.data.canAdd,false);assert.equal(editor.data.canEdit,true);assert.equal(editor.data.canDelete,false)
  assert.equal((await call(3)).response.status,403)
 })
 await test('wallet coin create/update/delete enforce original validation, uniqueness, ownership and audit',async()=>{
  const created=await call(1,'POST','',{action:'create',...payload});assert.equal(created.response.status,200)
  const newRow=(await setup.query('SELECT * FROM t_transit_wallet_coin ORDER BY rid DESC LIMIT 1')).rows[0];const createdRid=newRow.rid;assert.equal(newRow.transit_wallet_id,1);assert.equal(newRow.in_coin_name,'trx');assert.equal(newRow.out_coin_name,'usdt');assert.equal(newRow.is_realtime_rate,2);assert.equal(newRow.profit_rate,'0.15');assert.equal(newRow.exchange_rate,'6.50');assert.equal(newRow.kou_out_amount,'1.25');assert.equal(newRow.min_transit_amount,10);assert.equal(newRow.max_transit_amount,100)
  assert.equal((await call(1,'POST','',{action:'create',...payload})).response.status,409)
  assert.equal((await call(1,'POST','',{action:'create',...payload,in_coin_name:'usdt',out_coin_name:'usdt'})).response.status,400)
  assert.equal((await call(1,'POST','',{action:'create',...payload,min_transit_amount:101,max_transit_amount:100})).response.status,400)
  assert.equal((await call(1,'POST','',{action:'create',...payload,transit_wallet_id:999})).response.status,404)
  await setup.query('DELETE FROM t_transit_wallet_coin WHERE rid=1')
  const changed={...payload,in_coin_name:'usdt',out_coin_name:'trx',comments:'updated'}
  assert.equal((await call(1,'POST','',{action:'update',rid:createdRid,...changed})).response.status,200)
  const updated=(await setup.query('SELECT in_coin_name,out_coin_name,comments FROM t_transit_wallet_coin WHERE rid=$1',[createdRid])).rows[0];assert.deepEqual(updated,{in_coin_name:'usdt',out_coin_name:'trx',comments:'updated'})
  assert.equal((await call(1,'POST','',{action:'update',rid:createdRid,...changed,transit_wallet_id:2})).response.status,400)
  assert.equal((await call(1,'POST','',{action:'update',rid:999,...changed})).response.status,404)
  assert.equal((await call(1,'POST','',{action:'delete',rid:createdRid})).response.status,200)
  assert.equal((await call(1,'POST','',{action:'delete',rid:createdRid})).response.status,404)
  assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action IN ('transit.walletcoin.create','transit.walletcoin.update','transit.walletcoin.delete')")).rows[0].n),3)
 })
 await test('wallet coin page, action and CSRF permissions reject unauthorized or invalid requests',async()=>{
  assert.equal((await call(2,'POST','',{action:'create',...payload})).response.status,403);assert.equal((await call(2,'POST','',{action:'delete',rid:1})).response.status,403)
  assert.equal((await call(1,'POST','',{action:'delete',rid:1},'https://attacker.test')).response.status,403)
  assert.equal((await call(1,'POST','',{action:'delete',rid:1},'https://walletcoins.test','text/plain')).response.status,403)
  assert.equal((await call(1,'PUT')).response.status,405);assert.equal((await call(1,'POST','',{action:'unknown'})).response.status,400)
  assert.equal((await transitWalletCoinApi(new Request('https://walletcoins.test/api/transit-walletcoins'))).status,401)
 })
}finally{await setup.end()}
