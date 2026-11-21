import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw = process.env.TG_RECHARGE_ORDERS_TEST_DB_URL
const parsed = raw ? new URL(raw) : null
const parts = parsed?.hostname.split('.').map(Number)
const privateHost = parsed?.hostname === 'postgres' || (process.env.TG_RECHARGE_ORDERS_TEST_ALLOW_PRIVATE_DB === '1' && parts?.length === 4 && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)))
if (!raw || !parsed || !privateHost || !parsed.username.startsWith('tg_recharge_orders_test_') || !parsed.pathname.slice(1).startsWith('tg_recharge_orders_test_')) throw new Error('Recharge order integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST = parsed.hostname
process.env.DB_PORT = parsed.port || '5432'
process.env.DB_DATABASE = parsed.pathname.slice(1)
process.env.DB_USERNAME = parsed.username
process.env.DB_PASSWORD = parsed.password
process.env.PLATFORM_ORIGIN = 'https://recharge-orders.test'

const setup = new pg.Pool({ connectionString: raw, max: 4 })
await setup.query('CREATE TABLE t_admin(id bigint PRIMARY KEY,name varchar(30) NOT NULL,password varchar(100) NOT NULL,status smallint NOT NULL DEFAULT 1)')
await setup.query('CREATE TABLE t_admin_device_session(rid bigserial PRIMARY KEY,admin_id bigint NOT NULL,session_hash char(64) NOT NULL,login_time timestamp NOT NULL,last_seen_at timestamp NOT NULL,expires_at timestamp NOT NULL,revoked_at timestamp)')
await setup.query('CREATE TABLE t_platform_session(token_hash char(64) PRIMARY KEY,admin_id bigint NOT NULL,device_session_id bigint NOT NULL,expires_at timestamp NOT NULL)')
await setup.query('CREATE TABLE t_sys_config(rid bigserial PRIMARY KEY,config_key varchar(50) NOT NULL,config_val varchar(500) NOT NULL)')
await setup.query('CREATE TABLE t_platform_cloudflare_security(rid bigint PRIMARY KEY,config_ciphertext text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now())')
await setup.query('CREATE TABLE t_roles(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp)')
await setup.query('CREATE TABLE t_permissions(id bigserial PRIMARY KEY,name varchar(255) NOT NULL,guard_name varchar(255) NOT NULL DEFAULT \'web\',created_at timestamp,updated_at timestamp,route varchar(255),pid integer)')
await setup.query('CREATE TABLE t_model_has_roles(role_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_model_has_permissions(permission_id bigint NOT NULL,model_type varchar(255) NOT NULL,model_id bigint NOT NULL)')
await setup.query('CREATE TABLE t_role_has_permissions(permission_id bigint NOT NULL,role_id bigint NOT NULL)')
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation','{\"auth_code\":\"fixture\"}')")
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'full-reader','fixture'),(2,'other-menu-reader','fixture'),(3,'parent-only-reader','fixture')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const tokens = new Map<number,string>()
for (const [id, device] of [[1,11],[2,12],[3,13]] as const) {
 const value=randomBytes(32).toString('hex');tokens.set(id,value)
 await setup.query('INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval \'1 day\')',[digest(value),id,device])
}
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'全权限'),(2,'无权'),(3,'父级权限')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'群组用户',NULL,0),(2,'充值订单','admin.groupuser.rechargeorder.index',1),(3,'机器人列表','admin.telegram.telegrambot.index',0)")
await setup.query("INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(1,2),(2,3),(3,1)")
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3)")
await setup.query("CREATE TABLE t_telegram_bot(rid integer PRIMARY KEY,bot_token varchar(100) NOT NULL,bot_firstname varchar(100),bot_username varchar(100))")
await setup.query("INSERT INTO t_telegram_bot VALUES(1,'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123','主机器人','main_bot'),(2,'234567:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij_123','备用机器人','other_bot')")
await setup.query(`CREATE TABLE t_fms_recharge_order(rid integer PRIMARY KEY,bot_rid integer NOT NULL,recharge_tg_uid varchar(100) NOT NULL,recharge_tg_username varchar(100),recharge_coin_name varchar(50) NOT NULL,recharge_pay_price numeric(12,4) NOT NULL,need_pay_price numeric(12,4) NOT NULL,status smallint NOT NULL,comments varchar(255),create_time timestamp NOT NULL,update_time timestamp,expire_time timestamp NOT NULL,cancel_time timestamp,complete_time timestamp,tx_hash varchar(100))`)
await setup.query(`INSERT INTO t_fms_recharge_order(rid,bot_rid,recharge_tg_uid,recharge_tg_username,recharge_coin_name,recharge_pay_price,need_pay_price,status,comments,create_time,update_time,expire_time,cancel_time,complete_time,tx_hash) VALUES
 (12,1,'10001','alice','USDT',10.2500,10.5000,0,'pending',timestamp '2026-10-01 10:11:12',timestamp '2026-10-01 10:12:12',timestamp '2026-10-02 10:11:12',NULL,NULL,NULL),
 (11,1,'10002','bob','TRX',25,26,1,'paid',timestamp '2026-10-02 10:00:00',timestamp '2026-10-02 10:02:00',timestamp '2026-10-03 10:00:00',NULL,timestamp '2026-10-02 10:02:00','abc123'),
 (10,2,'20001','alice_alt','USDT',50,51,2,'expired',timestamp '2026-10-03 10:00:00',NULL,timestamp '2026-10-03 09:00:00',NULL,NULL,NULL),
 (9,2,'20002','carol','USDT',5,5.5,3,'cancelled',timestamp '2026-10-04 10:00:00',timestamp '2026-10-04 11:00:00',timestamp '2026-10-05 10:00:00',timestamp '2026-10-04 11:00:00',NULL,NULL)`)
await setup.query(`INSERT INTO t_fms_recharge_order(rid,bot_rid,recharge_tg_uid,recharge_tg_username,recharge_coin_name,recharge_pay_price,need_pay_price,status,comments,create_time,expire_time) SELECT n,3,'fixture-'||n,'fixture'||n,'USDT',1,1,0,'fixture',timestamp '2026-10-01 00:00:00',timestamp '2026-10-02 00:00:00' FROM generate_series(1,8) n`)

const { rechargeOrderApi } = await import('./recharge-order-api.server')
function request(admin:number, query='', method='GET') { return new Request('https://recharge-orders.test/api/recharge-orders'+query,{method,headers:{cookie:`tg_platform_session=${tokens.get(admin)}`}}) }
async function call(admin:number,query='',method='GET') { const response=await rechargeOrderApi(request(admin,query,method));return {response,data:await response.json() as Record<string,any>} }
try {
 await test('recharge order list matches legacy filters, status labels, bot join, fields and pagination',async()=>{
  const all=await call(1);assert.equal(all.response.status,200);assert.equal(all.data.total,12);assert.equal(all.data.page,1);assert.equal(all.data.pageSize,15);assert.deepEqual(all.data.rows.slice(0,4).map((row:any)=>row.status_label),['待支付','已充值','已过期','会员取消'])
  assert.equal(all.data.rows[0].bot_username,'main_bot');assert.equal(all.data.rows[0].recharge_pay_price,'10.2500');assert.equal(all.data.rows[0].create_time,'2026-10-01 10:11:12');assert.equal('bot_token' in all.data.rows[0],false)
  const username=await call(1,'?search=alice');assert.equal(username.data.total,2)
  const uid=await call(1,'?search=10002');assert.equal(uid.data.total,1);assert.equal(uid.data.rows[0].recharge_tg_username,'bob')
  const bot=await call(1,'?botRid=1');assert.equal(bot.data.total,2);assert.ok(bot.data.rows.every((row:any)=>row.bot_rid===1))
  const filtered=await call(1,'?search=alice&botRid=2');assert.equal(filtered.data.total,1);assert.equal(filtered.data.rows[0].recharge_tg_uid,'20001')
  const paged=await call(1,'?page=2&pageSize=10');assert.equal(paged.data.total,12);assert.equal(paged.data.rows.length,2);assert.equal(paged.data.rows[0].rid,2)
  const options=await call(1,'?action=options');assert.deepEqual(options.data.bots.map((bot:any)=>bot.rid),[2,1]);assert.equal('bot_token' in options.data.bots[0],false)
 })
 await test('recharge order API enforces leaf and parent permissions, authentication, method and query validation',async()=>{
  assert.equal((await call(2)).response.status,403)
  assert.equal((await call(3)).response.status,403)
  assert.equal((await rechargeOrderApi(new Request('https://recharge-orders.test/api/recharge-orders'))).status,401)
  assert.equal((await call(1,'','POST')).response.status,405)
  assert.equal((await call(1,'?pageSize=999')).response.status,400)
  assert.equal((await call(1,'?botRid=-1')).response.status,400)
 })
} finally { await setup.end() }
