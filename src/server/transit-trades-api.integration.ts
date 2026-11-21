import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { digest } from './security'

const raw = process.env.TG_TRANSIT_TRADES_TEST_DB_URL
const parsed = raw ? new URL(raw) : null
const parts = parsed?.hostname.split('.').map(Number)
const privateHost = parsed?.hostname === 'postgres' || (process.env.TG_TRANSIT_TRADES_TEST_ALLOW_PRIVATE_DB === '1' && parts?.length === 4 && (parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)))
if (!raw || !parsed || !privateHost || !parsed.username.startsWith('tg_transit_trades_test_') || !parsed.pathname.slice(1).startsWith('tg_transit_trades_test_')) throw new Error('Transit trades integration requires a disposable sandbox PostgreSQL database and role')
process.env.DB_HOST = parsed.hostname
process.env.DB_PORT = parsed.port || '5432'
process.env.DB_DATABASE = parsed.pathname.slice(1)
process.env.DB_USERNAME = parsed.username
process.env.DB_PASSWORD = parsed.password
process.env.PLATFORM_ORIGIN = 'https://transit-trades.test'
const setup = new pg.Pool({ connectionString: raw, max: 4 })
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
await setup.query("INSERT INTO t_sys_config(config_key,config_val) VALUES('license_activation',json_build_object('auth_code','fixture')::text)")
await setup.query("INSERT INTO t_admin(id,name,password) VALUES(1,'trade-admin','fixture'),(2,'trade-reissuer','fixture'),(3,'other-transit-page','fixture')")
await setup.query("INSERT INTO t_admin_device_session(rid,admin_id,session_hash,login_time,last_seen_at,expires_at) VALUES(11,1,repeat('a',64),now(),now(),now()+interval '1 day'),(12,2,repeat('b',64),now(),now(),now()+interval '1 day'),(13,3,repeat('c',64),now(),now(),now()+interval '1 day')")
const tokens = new Map<number, string>()
for (const [admin, device] of [[1, 11], [2, 12], [3, 13]] as const) {
  const value = randomBytes(32).toString('hex')
  tokens.set(admin, value)
  await setup.query("INSERT INTO t_platform_session(token_hash,admin_id,device_session_id,expires_at) VALUES($1,$2,$3,now()+interval '1 day')", [digest(value), admin, device])
}
await setup.query("INSERT INTO t_roles(id,name) VALUES(1,'完整交易权限'),(2,'闪兑补发员'),(3,'其他闪兑页面')")
await setup.query("INSERT INTO t_permissions(id,name,route,pid) VALUES(1,'闪兑管理',NULL,0),(2,'闪兑交易','admin.transit.trade.index',1),(3,'兑换补发','admin.transit.trade.reswap',2),(4,'禁止兑换','admin.transit.trade.stopswap',2),(5,'闪兑钱包','admin.transit.wallet.index',1)")
await setup.query('INSERT INTO t_role_has_permissions(role_id,permission_id) VALUES(1,1),(1,2),(1,3),(1,4),(2,1),(2,2),(2,3),(3,1),(3,5)')
await setup.query("INSERT INTO t_model_has_roles(role_id,model_type,model_id) VALUES(1,'App\\Models\\Admin\\Admin',1),(2,'App\\Models\\Admin\\Admin',2),(3,'App\\Models\\Admin\\Admin',3)")
await setup.query(`CREATE TABLE t_transit_wallet_trade_list (
  rid integer PRIMARY KEY,
  tx_hash varchar(100) NOT NULL,
  transferfrom_address varchar(200) NOT NULL,
  transferto_address varchar(200) NOT NULL,
  coin_name varchar(20) NOT NULL,
  amount varchar(100) NOT NULL,
  "timestamp" varchar(20) NOT NULL,
  process_status smallint NOT NULL DEFAULT 0,
  process_time timestamp,
  process_comments varchar(255),
  get_time timestamp,
  sendback_address varchar(200),
  sendback_amount varchar(100) NOT NULL DEFAULT '0',
  sendback_time timestamp,
  sendback_coin_name varchar(20),
  sendback_tx_hash varchar(100),
  sendback_contract_ret varchar(20),
  tg_notice_status_receive char(1) NOT NULL DEFAULT 'N',
  tg_notice_status_send char(1) NOT NULL DEFAULT 'N',
  current_exchange_rate numeric(8,2) NOT NULL DEFAULT 0,
  current_huan_yuzhi_amount numeric(14,2) NOT NULL DEFAULT 0
)`)
await setup.query(`INSERT INTO t_transit_wallet_trade_list(rid,tx_hash,transferfrom_address,transferto_address,coin_name,amount,"timestamp",process_status,process_time,process_comments,get_time,sendback_address,sendback_amount,sendback_time,sendback_coin_name,tg_notice_status_send)
VALUES
 (1,'hash-target','from-one','to-one','TRX','12.50','1793200000000',10,NULL,NULL,timestamp '2026-10-28 11:00:00','return-one','10.00',timestamp '2026-10-28 12:00:00','USDT','N'),
 (2,'hash-second','from-two','to-two','USDT','2.00','2026-10-28 12:00:00',1,NULL,NULL,NULL,NULL,'0',NULL,NULL,'N'),
 (3,'hash-complete','from-three','to-three','TRX','3.00','1793200000000',9,timestamp '2026-10-28 13:00:00','done',timestamp '2026-10-28 12:30:00',NULL,'0',NULL,NULL,'Y')`)
const { transitTradesApi } = await import('./transit-trades-api.server')
function request(admin: number, method = 'GET', query = '', body?: unknown, origin = 'https://transit-trades.test', contentType = 'application/json') {
  return new Request('https://transit-trades.test/api/transit-trades' + query, {
    method,
    headers: { cookie: 'tg_platform_session=' + tokens.get(admin), ...(method === 'POST' ? { origin, 'content-type': contentType } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function call(admin: number, method = 'GET', query = '', body?: unknown, origin?: string, contentType?: string) {
  const response = await transitTradesApi(request(admin, method, query, body, origin, contentType))
  return { response, data: await response.json() as Record<string, any> }
}
try {
  await test('trade listing authenticates, filters, paginates, maps status and returns action permissions', async () => {
    const all = await call(1)
    assert.equal(all.response.status, 200)
    assert.equal(all.data.total, 3)
    assert.equal(all.data.rows[0].rid, 3)
    assert.equal(all.data.rows[0].process_status_label, '转账成功')
    assert.equal(all.data.rows[0].can_reissue, false)
    assert.equal(all.data.rows[0].can_stop, false)
    assert.equal(all.data.rows[2].process_status_label, '余额不足')
    assert.equal(all.data.rows[2].can_reissue, true)
    assert.equal(all.data.rows[2].can_stop, true)
    assert.equal(all.data.rows[2].transferfrom_address, 'from-one')
    assert.match(all.data.rows[2].timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    assert.equal((await call(1, 'GET', '?tx_hash=second')).data.total, 1)
    assert.equal((await call(1, 'GET', '?transferfrom_address=from-three')).data.rows[0].rid, 3)
    assert.equal((await call(1, 'GET', '?transferto_address=to-two&pageSize=10&page=2')).data.rows.length, 0)
    const editor = await call(2)
    assert.equal(editor.data.canReissue, true)
    assert.equal(editor.data.canStop, false)
    assert.equal(editor.data.canDelete, true)
    assert.equal((await call(3)).response.status, 403)
  })
  await test('reissue, stop and batch deletion preserve trade state rules and audit writes', async () => {
    assert.equal((await call(1, 'POST', '', { action: 'reswap', rid: 1 })).response.status, 200)
    let row = (await setup.query('SELECT process_status,tg_notice_status_send FROM t_transit_wallet_trade_list WHERE rid=1')).rows[0]
    assert.equal(Number(row.process_status), 1)
    assert.equal(row.tg_notice_status_send, 'N')
    assert.equal((await call(1, 'POST', '', { action: 'reswap', rid: 1 })).response.status, 409)
    assert.equal((await call(1, 'POST', '', { action: 'stopswap', rid: 2 })).response.status, 200)
    row = (await setup.query('SELECT process_status,tg_notice_status_send,process_comments FROM t_transit_wallet_trade_list WHERE rid=2')).rows[0]
    assert.equal(Number(row.process_status), 5)
    assert.equal(row.tg_notice_status_send, 'Y')
    assert.equal(row.process_comments, '人工禁止兑换')
    assert.equal((await call(1, 'POST', '', { action: 'stopswap', rid: 3 })).response.status, 409)
    assert.equal((await call(1, 'POST', '', { action: 'reswap', rid: 999 })).response.status, 404)
    const deleted = await call(1, 'POST', '', { action: 'batch_delete', ids: [3, 3, 999] })
    assert.equal(deleted.response.status, 200)
    assert.equal(deleted.data.message, '已删除 1 条记录')
    assert.equal((await call(1, 'POST', '', { action: 'batch_delete', ids: [] })).response.status, 400)
    assert.equal(Number((await setup.query("SELECT count(*)::int n FROM t_platform_audit_log WHERE action LIKE 'transit.trade.%'")).rows[0].n), 3)
  })
  await test('action grants, origin checks, method handling and authentication are enforced', async () => {
    assert.equal((await call(2, 'POST', '', { action: 'reswap', rid: 1 })).response.status, 409)
    assert.equal((await call(2, 'POST', '', { action: 'stopswap', rid: 2 })).response.status, 403)
    assert.equal((await call(2, 'POST', '', { action: 'batch_delete', ids: [2] })).response.status, 200)
    assert.equal((await call(1, 'POST', '', { action: 'batch_delete', ids: [1] }, 'https://attacker.test')).response.status, 403)
    assert.equal((await call(1, 'POST', '', { action: 'batch_delete', ids: [1] }, 'https://transit-trades.test', 'text/plain')).response.status, 415)
    assert.equal((await call(1, 'PUT')).response.status, 405)
    assert.equal((await call(1, 'POST', '', { action: 'other' })).response.status, 400)
    assert.equal((await transitTradesApi(new Request('https://transit-trades.test/api/transit-trades'))).status, 401)
  })
} finally {
  await setup.end()
}
