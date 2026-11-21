import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const raw=process.env.TG_BINDASENDN_WORKER_TEST_DB_URL
const parsed=raw?new URL(raw):null
const safeDb=Boolean(raw&&parsed&&(parsed.hostname==='postgres'||process.env.TG_BINDASENDN_WORKER_TEST_ALLOW_PRIVATE_DB==='1'&&/^172\\.(1[6-9]|2\\d|3[01])\\./.test(parsed.hostname))&&parsed.username.startsWith('tg_bindasendn_test_')&&parsed.pathname.slice(1).startsWith('tg_bindasendn_test_'))
if(safeDb&&parsed)Object.assign(process.env,{DB_HOST:parsed.hostname,DB_PORT:parsed.port||'5432',DB_DATABASE:parsed.pathname.slice(1),DB_USERNAME:parsed.username,DB_PASSWORD:parsed.password,APP_ENV:'dev',PLATFORM_BIND_ASENDN_ACTIONS:'false',PLATFORM_TELEGRAM_ACTIONS:'false',TRON_SIGNER_URL:'http://signer.test',TRON_SIGNER_TOKEN:'x'.repeat(32)})
const pool=new pg.Pool({connectionString:raw??'postgres://127.0.0.1/disabled_test_database',max:3})
const txid='a'.repeat(64)
try {
 await test('绑A送N关闭动作时不访问数据库',async()=>{
  let calls=0
  const result=await (await import('./bindasendn-worker.server')).syncBindASendN({enabled:false,pool:{query:async()=>{calls++;throw Error('unexpected db access')},connect:async()=>{calls++;throw Error('unexpected db access')}} as never})
  assert.equal(result.skipped,true);assert.equal(calls,0)
 })
 await test('USDT 转账唯一建单、按能量换算委托并记录签名结果',{skip:!safeDb},async()=>{
  await pool.query('DROP TABLE IF EXISTS t_platform_bindasendn_action,t_energy_platform_order,t_energy_platform,t_energy_platform_bot,t_telegram_bot,t_bind_a_send_n_grant,t_bind_a_send_n_binding,t_bind_a_send_n_config CASCADE')
  await pool.query("CREATE TABLE t_bind_a_send_n_config(rid serial PRIMARY KEY,bot_rid int,is_enable smallint,energy_per_send int,activate_threshold numeric(14,2),daily_limit int,monthly_limit int,n_addr_daily_limit int,audit_threshold numeric(14,2),audit_enabled smallint,whitelist text,blacklist text,retry_count smallint,energy_platform_bot_rid int)")
  await pool.query("CREATE TABLE t_bind_a_send_n_binding(rid serial PRIMARY KEY,bot_rid int,tg_uid bigint,wallet_addr varchar(100),status smallint)")
  await pool.query("CREATE TABLE t_bind_a_send_n_grant(rid serial PRIMARY KEY,binding_rid int,bot_rid int,tg_uid bigint,a_addr varchar(100),n_addr varchar(100),tx_hash varchar(200),energy_amount int,grant_status smallint,audit_status smallint,retry_count smallint DEFAULT 0,fail_reason varchar(500),grant_time timestamp,update_time timestamp,create_time timestamp)")
  await pool.query("CREATE TABLE t_platform_bindasendn_action(grant_rid int PRIMARY KEY,state varchar(16) CHECK(state IN ('claimed','signing','succeeded','manual')),platform_rid int,tx_hash varchar(200),error_code varchar(80),created_at timestamp DEFAULT now(),updated_at timestamp DEFAULT now())")
  await pool.query("CREATE TABLE t_energy_platform(rid serial PRIMARY KEY,platform_uid text,platform_apikey text,permission_id int,platform_balance numeric,seq_sn int,status smallint)")
  await pool.query("CREATE TABLE t_energy_platform_bot(rid serial PRIMARY KEY,bot_rid int,receive_wallet text)")
  await pool.query("CREATE TABLE t_telegram_bot(rid int PRIMARY KEY,bot_token text)")
  await pool.query("CREATE TABLE t_energy_platform_order(rid serial PRIMARY KEY,energy_platform_rid int,energy_platform_bot_rid int,platform_name int,platform_uid text,receive_address text,platform_order_id text,energy_amount int,energy_day int,energy_time timestamp,source_type int,recovery_status int,use_trx numeric)")
  await pool.query("INSERT INTO t_bind_a_send_n_config(is_enable,energy_per_send,activate_threshold,daily_limit,monthly_limit,n_addr_daily_limit,audit_threshold,audit_enabled,retry_count) VALUES(1,65000,0,10,100,5,100,0,3)")
  await pool.query("INSERT INTO t_bind_a_send_n_binding(bot_rid,tg_uid,wallet_addr,status) VALUES(7,12345,'T'||repeat('1',33),1)")
  await pool.query("INSERT INTO t_energy_platform(platform_uid,platform_apikey,permission_id,platform_balance,seq_sn,status) VALUES('T9876543210987654321098765432101234','ciphertext',0,1000,1,0)")
  const sent:Array<{url:string;body:any}>=[]
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=String(input),body=init?.body?JSON.parse(String(init.body)):{}
   sent.push({url,body})
   if(url.startsWith('https://apilist.tronscanapi.com/'))return Response.json({data:[{to_address:'T'+'1'.repeat(33),from_address:'T1111111111111111111111111111111111',hash:txid,confirmed:true,token_transfer_info:{amount_str:'1250000',contract_address:'TR7NHqjeKQxGTCi8ckq9E3sMxjJ9MMyKwr'}}]})
   if(url.endsWith('/wallet/getaccountresource'))return Response.json({TotalEnergyLimit:'100000000000',TotalEnergyWeight:'100000000'})
   if(url.endsWith('/wallet/getcandelegatedmaxsize'))return Response.json({max_size:'1000000000'})
   if(url.endsWith('/api/internal/tron/sign'))return Response.json({code:200,data:{txid}})
   throw Error('unexpected network request')
  }
  const {syncBindASendN}=await import('./bindasendn-worker.server')
  const result=await syncBindASendN({enabled:true,pool,fetcher:fetcher as typeof fetch,logger:{error(){}}})
  assert.deepEqual(result,{skipped:false,scanned:1,grantsCreated:1,delegated:1,manual:0})
  const grant=(await pool.query('SELECT grant_status,energy_amount,tx_hash FROM t_bind_a_send_n_grant')).rows[0]
  assert.deepEqual([Number(grant.grant_status),Number(grant.energy_amount),grant.tx_hash],[1,65000,txid])
  assert.equal((await pool.query("SELECT state,tx_hash FROM t_platform_bindasendn_action")).rows[0].state,'succeeded')
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM t_energy_platform_order')).rows[0].n,1)
  assert.equal(sent.filter(call=>call.url.endsWith('/api/internal/tron/sign')).length,1)
  const signerBody=sent.find(call=>call.url.endsWith('/api/internal/tron/sign'))!.body
  assert.equal(signerBody.amount,'65.000000')
  const duplicate=await syncBindASendN({enabled:true,pool,fetcher:fetcher as typeof fetch,logger:{error(){}}})
  assert.equal(duplicate.grantsCreated,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM t_bind_a_send_n_grant')).rows[0].n,1)
 })
} finally { await pool.end() }

