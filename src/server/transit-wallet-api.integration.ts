import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, generateKeyPairSync, constants, privateDecrypt } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw=process.env.TG_TRANSIT_WALLET_TEST_DB_URL, parsed=raw?new URL(raw):null, parts=parsed?.hostname.split('.').map(Number)
const privateHost=parsed?.hostname==='postgres'||(process.env.TG_TRANSIT_WALLET_TEST_ALLOW_PRIVATE_DB==='1'&&parts?.length===4&&(parts[0]===10||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168)))
if(!raw||!parsed||!privateHost||!parsed.username.startsWith('tg_transit_wallet_test_')||!parsed.pathname.slice(1).startsWith('tg_transit_wallet_test_'))throw new Error('Transit wallet integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST=parsed.hostname;process.env.DB_PORT=parsed.port||'5432';process.env.DB_DATABASE=parsed.pathname.slice(1);process.env.DB_USERNAME=parsed.username;process.env.DB_PASSWORD=parsed.password;process.env.PLATFORM_ORIGIN='https://transit-wallet.test'
const keys=generateKeyPairSync('rsa',{modulusLength:2048});process.env.TRON_RSA_PUBLIC_KEY=keys.publicKey.export({type:'spki',format:'pem'}).toString()
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
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'full-wallet-admin','fixture'),(2,'wallet-editor','fixture'),(3,'other-wallet-page','fixture')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const tokens=new Map<number,string>();for(const[id,device]of[[1,11],[2,12],[3,13]]as const){const value=randomBytes(32).toString('hex');tokens.set(id,value);await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval \'1 day\')',[digest(value),id,device])}
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'完整钱包权限'),(2,'钱包编辑'),(3,'其他闪兑页面')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES (1,'闪兑管理',NULL,0),(2,'闪兑钱包','admin.transit.wallet.index',1),(3,'添加闪兑钱包','admin.transit.wallet.add',2),(4,'修改闪兑钱包','admin.transit.wallet.update',2),(5,'删除闪兑钱包','admin.transit.wallet.delete',2),(6,'修改私钥','admin.transit.wallet.updateprikey',2),(7,'修改状态','admin.transit.wallet.change_status',2),(8,'闪兑币种','admin.transit.walletcoin.index',1)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(1,2),(1,3),(1,4),(1,5),(1,6),(1,7),(2,1),(2,2),(2,4),(3,1),(3,8)')
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3)")
await setup.query(`CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token varchar(100),bot_firstname varchar(100),bot_username varchar(100),recharge_wallet_addr varchar(200))`)
await setup.query("INSERT INTO t_telegram_bot VALUES(1,'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123','通知机器人','notice_bot','bot-deposit-address')")
await setup.query(`CREATE TABLE t_energy_platform_bot(rid integer PRIMARY KEY,receive_wallet varchar(200))`);await setup.query("INSERT INTO t_energy_platform_bot VALUES(1,'energy-deposit-address')")
await setup.query(`CREATE TABLE t_premium_platform(rid integer PRIMARY KEY,receive_wallet varchar(200))`);await setup.query("INSERT INTO t_premium_platform VALUES(1,'premium-deposit-address')")
await setup.query(`CREATE TABLE t_transit_wallet(rid serial PRIMARY KEY,chain_type varchar(10) NOT NULL,receive_wallet varchar(200) NOT NULL,send_wallet varchar(200) NOT NULL,send_wallet_privatekey varchar(2000),show_notes varchar(500),status smallint NOT NULL DEFAULT 1,tg_notice_obj_receive varchar(200),tg_notice_obj_send varchar(200),get_tx_time timestamp,create_time timestamp,update_time timestamp,bot_rid integer,auto_stock_min_trx integer NOT NULL DEFAULT 0,auto_stock_per_usdt integer NOT NULL DEFAULT 0)`)
await setup.query("INSERT INTO t_transit_wallet(rid,chain_type,receive_wallet,send_wallet,send_wallet_privatekey,show_notes,status,tg_notice_obj_receive,tg_notice_obj_send,get_tx_time,create_time,bot_rid) VALUES(1,'trc','wallet-receive-one','wallet-send-one','encrypted-fixture','wallet one',1,'receive-room','send-room',timestamp '2026-10-01 10:00:00',timestamp '2026-10-01 09:00:00',1),(2,'trc','wallet-receive-two','wallet-send-two',NULL,'wallet two',0,NULL,NULL,NULL,timestamp '2026-10-02 09:00:00',NULL)")
await setup.query("SELECT setval(pg_get_serial_sequence('t_transit_wallet','rid'),2)")
await setup.query('CREATE TABLE t_transit_wallet_coin(rid serial PRIMARY KEY,transit_wallet_id integer NOT NULL)');await setup.query('INSERT INTO t_transit_wallet_coin(transit_wallet_id) VALUES(1)')
await setup.query("SELECT setval(pg_get_serial_sequence('t_transit_wallet_coin','rid'),1)")
const{transitWalletApi}=await import('./transit-wallet-api.server')
function request(admin:number,method='GET',query='',body?:unknown,origin='https://transit-wallet.test',contentType='application/json'){return new Request('https://transit-wallet.test/api/transit-wallet'+query,{method,headers:{cookie:`tg_platform_session=${tokens.get(admin)}`,...(method==='POST'?{origin,'content-type':contentType}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
async function call(admin:number,method='GET',query='',body?:unknown,origin?:string,contentType?:string){const response=await transitWalletApi(request(admin,method,query,body,origin,contentType));return{response,data:await response.json() as Record<string,any>}}
const wallet={bot_rid:1,chain_type:'trc',receive_wallet:'wallet-receive-new',send_wallet:'wallet-send-new',show_notes:'created wallet',tg_notice_obj_receive:'room-in',tg_notice_obj_send:'room-out',get_tx_time:'2026-10-10T08:30'}
try{
 await test('wallet listing joins bot labels, hides token and private key, exposes key presence, status and filter options',async()=>{
  const all=await call(1);assert.equal(all.response.status,200);assert.equal(all.data.total,2);assert.equal(all.data.rows[0].rid,2);assert.equal(all.data.rows[0].bot_username,null);assert.equal(all.data.rows[0].enabled,true);assert.equal(all.data.rows[0].private_key_configured,false);assert.equal(all.data.rows[1].bot_username,'notice_bot');assert.equal(all.data.rows[1].enabled,false);assert.equal(all.data.rows[1].private_key_configured,true);assert.equal('send_wallet_privatekey' in all.data.rows[1],false);assert.equal('bot_token' in all.data.rows[1],false);assert.equal(all.data.canManageKey,true);assert.equal(all.data.canChangeStatus,true)
  assert.equal((await call(1,'GET','?receive=wallet-receive-two')).data.total,1);assert.equal((await call(1,'GET','?send=wallet-send-one')).data.rows[0].rid,1);assert.equal((await call(1,'GET','?page=2&pageSize=10')).data.rows.length,0)
  assert.deepEqual((await call(1,'GET','?action=options')).data.bots.map((b:any)=>b.rid),[1]);assert.equal('bot_token' in (await call(1,'GET','?action=options')).data.bots[0],false)
  const limited=await call(2);assert.equal(limited.response.status,200);assert.equal(limited.data.canEdit,true);assert.equal(limited.data.canAdd,false);assert.equal(limited.data.canDelete,false);assert.equal(limited.data.canManageKey,false);assert.equal(limited.data.canChangeStatus,true)
  assert.equal((await call(3)).response.status,403)
 })
 await test('wallet create/update enforce duplicate and cross-service address collisions, bot and timestamp validation',async()=>{
  const created=await call(1,'POST','',{action:'create',...wallet});assert.equal(created.response.status,200);const row=(await setup.query('SELECT * FROM t_transit_wallet ORDER BY rid DESC LIMIT 1')).rows[0];const rid=row.rid;assert.equal(row.receive_wallet,'wallet-receive-new');assert.equal(row.bot_rid,1);assert.equal(row.get_tx_time.toISOString().slice(0,16),'2026-10-10T08:30');assert.equal(row.status,1)
  assert.equal((await call(1,'POST','',{action:'create',...wallet,receive_wallet:'wallet-receive-one'})).response.status,409)
  for(const address of ['bot-deposit-address','energy-deposit-address','premium-deposit-address'])assert.equal((await call(1,'POST','',{action:'create',...wallet,receive_wallet:address})).response.status,409)
  assert.equal((await call(1,'POST','',{action:'create',...wallet,receive_wallet:'invalid-bot-wallet',bot_rid:999})).response.status,400)
  assert.equal((await call(1,'POST','',{action:'create',...wallet,receive_wallet:'invalid-time-wallet',get_tx_time:'2026-02-31T10:00'})).response.status,400)
  const changed={...wallet,receive_wallet:'wallet-receive-updated',send_wallet:'wallet-send-updated',show_notes:'updated',get_tx_time:''}
  assert.equal((await call(1,'POST','',{action:'update',rid,...changed})).response.status,200);const updated=(await setup.query('SELECT receive_wallet,send_wallet,show_notes,get_tx_time FROM t_transit_wallet WHERE rid=$1',[rid])).rows[0];assert.equal(updated.receive_wallet,'wallet-receive-updated');assert.equal(updated.send_wallet,'wallet-send-updated');assert.equal(updated.show_notes,'updated');assert.equal(updated.get_tx_time,null)
  assert.equal((await call(1,'POST','',{action:'update',rid:999,...changed})).response.status,404)
 })
 await test('wallet status toggles, private key uses RSA OAEP-SHA1 encrypted storage, and referenced wallets cannot be deleted',async()=>{
  assert.equal((await call(1,'POST','',{action:'status',rid:1,enabled:true})).response.status,200);assert.equal(Number((await setup.query('SELECT status FROM t_transit_wallet WHERE rid=1')).rows[0].status),0)
  assert.equal((await call(1,'POST','',{action:'status',rid:1,enabled:false})).response.status,200);assert.equal(Number((await setup.query('SELECT status FROM t_transit_wallet WHERE rid=1')).rows[0].status),1)
  assert.equal((await call(1,'POST','',{action:'private-key',rid:1,send_wallet_privatekey:'private key fixture 123'})).response.status,200)
  const cipher=String((await setup.query('SELECT send_wallet_privatekey FROM t_transit_wallet WHERE rid=1')).rows[0].send_wallet_privatekey);assert.match(cipher,/^v2:/);const decoded=privateDecrypt({key:keys.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha1'},Buffer.from(cipher.slice(3),'base64')).toString();assert.equal(decoded,'private key fixture 123')
  assert.equal((await call(1,'POST','',{action:'private-key',rid:1,send_wallet_privatekey:' '})).response.status,400)
  assert.equal((await call(1,'POST','',{action:'status',rid:999,enabled:true})).response.status,404);assert.equal((await call(1,'POST','',{action:'private-key',rid:999,send_wallet_privatekey:'private'})).response.status,404)
  assert.equal((await call(1,'POST','',{action:'delete',rid:1})).response.status,409)
  assert.equal((await call(1,'POST','',{action:'delete',rid:2})).response.status,200);assert.equal((await call(1,'POST','',{action:'delete',rid:2})).response.status,404)
  assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'transit.wallet.%'")).rows[0].n),6)
 })
 await test('wallet mutations require per-action grants, valid origin and authenticated page access',async()=>{
  assert.equal((await call(2,'POST','',{action:'create',...wallet})).response.status,403);assert.equal((await call(2,'POST','',{action:'status',rid:1,enabled:true})).response.status,200);assert.equal((await call(2,'POST','',{action:'private-key',rid:1,send_wallet_privatekey:'fixture'})).response.status,403);assert.equal((await call(2,'POST','',{action:'delete',rid:1})).response.status,403)
  assert.equal((await call(1,'POST','',{action:'delete',rid:1},'https://attacker.test')).response.status,403);assert.equal((await call(1,'POST','',{action:'delete',rid:1},'https://transit-wallet.test','text/plain')).response.status,403);assert.equal((await call(1,'PUT')).response.status,405);assert.equal((await call(1,'POST','',{action:'unknown'})).response.status,400);assert.equal((await transitWalletApi(new Request('https://transit-wallet.test/api/transit-wallet'))).status,401)
 })
}finally{await setup.end()}
