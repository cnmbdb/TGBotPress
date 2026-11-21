import type { DatabaseConnection as Pool } from './database.types'
import { db } from './db.server'
import { energyStakeSun } from './energy-special.server'

type Database = Pick<Pool, 'query' | 'connect'>
type Logger = Pick<Console, 'error'>
type Options = { pool?: Database; fetcher?: typeof fetch; logger?: Logger; shouldContinue?: () => boolean; enabled?: boolean }
type Config = { is_enable: number; energy_per_send: number; activate_threshold: string; daily_limit: number; monthly_limit: number; n_addr_daily_limit: number; audit_threshold: string; audit_enabled: number; whitelist: string | null; blacklist: string | null; retry_count: number; energy_platform_bot_rid: number | null }
type Binding = { rid: number; bot_rid: number; tg_uid: string; wallet_addr: string }
type Grant = { rid: number; binding_rid: number; bot_rid: number; tg_uid: string; a_addr: string; n_addr: string; tx_hash: string; energy_amount: number; audit_status: number; retry_count: number }
type Json = Record<string, unknown>
const STOP = { skipped: true, scanned: 0, grantsCreated: 0, delegated: 0, manual: 0 }
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8ckq9E3sMxjJ9MMyKwr'
const headers = (key?: string) => ({ Accept: 'application/json', ...(key?.trim() ? { 'TRON-PRO-API-KEY': key.trim() } : {}) })
const object = (value: unknown): Json | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : null
async function json(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit): Promise<Json> {
  const response = await fetcher(input, init)
  const body = object(await response.json().catch(() => null))
  if (!response.ok || !body) throw new Error('provider_response_invalid')
  return body
}
function amountUsdt(raw: unknown): string | null {
  const text = String(raw ?? '')
  if (!/^\d+$/.test(text) || text.length > 40 || BigInt(text) <= 0n) return null
  const value = BigInt(text)
  return String(value / 1_000_000n) + '.' + String(value % 1_000_000n).padStart(6, '0')
}
function cents(value: unknown): bigint | null {
  const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d{1,6}))?$/)
  return match ? BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0')) : null
}
function configFrom(row: Record<string, unknown>): Config {
  return {
    is_enable: Number(row.is_enable), energy_per_send: Number(row.energy_per_send), activate_threshold: String(row.activate_threshold ?? '0'),
    daily_limit: Number(row.daily_limit), monthly_limit: Number(row.monthly_limit), n_addr_daily_limit: Number(row.n_addr_daily_limit),
    audit_threshold: String(row.audit_threshold ?? '0'), audit_enabled: Number(row.audit_enabled),
    whitelist: row.whitelist == null ? null : String(row.whitelist), blacklist: row.blacklist == null ? null : String(row.blacklist),
    retry_count: Number(row.retry_count), energy_platform_bot_rid: row.energy_platform_bot_rid == null ? null : Number(row.energy_platform_bot_rid),
  }
}
async function getConfig(pool: Database) {
  const result = await pool.query('SELECT * FROM t_bind_a_send_n_config WHERE bot_rid IS NULL ORDER BY rid DESC LIMIT 1')
  return result.rows[0] ? configFrom(result.rows[0]) : null
}
async function scanAddress(fetcher: typeof fetch, binding: Binding) {
  const url = new URL('https://apilist.tronscanapi.com/api/transaction')
  url.searchParams.set('address', binding.wallet_addr)
  url.searchParams.set('contract_address', USDT_CONTRACT)
  url.searchParams.set('limit', '20')
  url.searchParams.set('sort', '-timestamp')
  url.searchParams.set('count', 'true')
  const key = process.env.TRONSCAN_API_KEY
  const body = await json(fetcher, url, { headers: headers(key), redirect: 'error', signal: AbortSignal.timeout(12_000) })
  return Array.isArray(body.data) ? body.data.map(object).filter((row): row is Json => row !== null) : []
}
function parseTransfer(tx: Json, wallet: string) {
  const info = object(tx.token_transfer_info)
  const to = String(tx.to_address ?? '')
  const from = String(tx.from_address ?? '')
  const hash = String(tx.hash ?? '')
  const amount = amountUsdt(info?.amount_str)
  const contract = String(info?.contract_address ?? info?.tokenId ?? '')
  if (to !== wallet || !from || from === to || !/^[a-f0-9]{64}$/i.test(hash) || !amount) return null
  if (contract && contract !== USDT_CONTRACT) return null
  if (tx.confirmed === false || tx.confirmed === 0) return null
  return { from, to, hash, amount }
}
async function createGrant(pool: Database, binding: Binding, tx: { from: string; to: string; hash: string; amount: string }, config: Config) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['bindasendn-user:'+binding.tg_uid])
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['bindasendn-address:'+tx.to])
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['bindasendn-tx:'+tx.hash+':'+tx.to])
    const existing = await client.query('SELECT rid FROM t_bind_a_send_n_grant WHERE tx_hash=$1 AND n_addr=$2 LIMIT 1', [tx.hash,tx.to])
    if (existing.rowCount) { await client.query('COMMIT'); return false }
    const limits = await client.query<{ daily: string; monthly: string; addressDaily: string }>(
      'SELECT (SELECT count(*) FROM t_bind_a_send_n_grant WHERE tg_uid=$1 AND grant_time>=date_trunc(\'day\',now()))::text AS daily,'+
      '(SELECT count(*) FROM t_bind_a_send_n_grant WHERE tg_uid=$1 AND grant_time>=date_trunc(\'month\',now()))::text AS monthly,'+
      '(SELECT count(*) FROM t_bind_a_send_n_grant WHERE n_addr=$2 AND grant_time>=date_trunc(\'day\',now()))::text AS "addressDaily"',
      [binding.tg_uid,tx.to],
    )
    const count = limits.rows[0]
    if ((config.daily_limit > 0 && Number(count.daily) >= config.daily_limit) ||
      (config.monthly_limit > 0 && Number(count.monthly) >= config.monthly_limit) ||
      (config.n_addr_daily_limit > 0 && Number(count.addressDaily) >= config.n_addr_daily_limit)) {
      await client.query('COMMIT'); return false
    }
    const whitelist = (config.whitelist ?? '').split(',').map(v=>v.trim()).filter(Boolean)
    const blacklist = (config.blacklist ?? '').split(',').map(v=>v.trim()).filter(Boolean)
    if ((whitelist.length && !whitelist.includes(tx.to)) || blacklist.includes(tx.to)) { await client.query('COMMIT'); return false }
    const amount = cents(tx.amount), threshold = cents(config.audit_threshold)
    if (amount === null || threshold === null) { await client.query('ROLLBACK'); return false }
    const needsAudit = config.audit_enabled === 1 && amount >= threshold
    await client.query(
      'INSERT INTO t_bind_a_send_n_grant(binding_rid,bot_rid,tg_uid,a_addr,n_addr,tx_hash,energy_amount,grant_status,audit_status,retry_count,grant_time,update_time,create_time) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,0,now(),NULL,now())',
      [binding.rid,binding.bot_rid,binding.tg_uid,tx.from,tx.to,tx.hash,config.energy_per_send,needsAudit?1:0],
    )
    await client.query('COMMIT')
    return true
  } catch (error) { await client.query('ROLLBACK').catch(()=>undefined); throw error }
  finally { client.release() }
}
function signerConfig() {
  const token = process.env.TRON_SIGNER_TOKEN?.trim(), base = process.env.TRON_SIGNER_URL?.trim()
  if (!token || token.length < 32 || !base) throw new Error('signer_not_configured')
  const url = new URL(base), env = (process.env.APP_ENV || 'production').toLowerCase()
  if (url.protocol !== 'https:' && !['local','dev','development'].includes(env)) throw new Error('signer_https_required')
  return { token,url }
}
function trx(sun: bigint) { return String(sun / 1_000_000n) + '.' + String(sun % 1_000_000n).padStart(6,'0') }
async function delegatedSun(fetcher: typeof fetch, from: string, energy: number) {
  const resource = await json(fetcher,'https://api.trongrid.io/wallet/getaccountresource',{
    method:'POST',headers:{...headers(process.env.TRONGRID_API_KEY),'Content-Type':'application/json'},
    body:JSON.stringify({address:from,visible:true}),redirect:'error',signal:AbortSignal.timeout(12_000),
  })
  const totalEnergyLimit=BigInt(String(resource.TotalEnergyLimit??0)), totalEnergyWeight=BigInt(String(resource.TotalEnergyWeight??0))
  const amount=energyStakeSun(BigInt(energy),totalEnergyWeight,totalEnergyLimit)
  const maximum=await json(fetcher,'https://api.trongrid.io/wallet/getcandelegatedmaxsize',{
    method:'POST',headers:{...headers(process.env.TRONGRID_API_KEY),'Content-Type':'application/json'},
    body:JSON.stringify({owner_address:from,type:1,visible:true}),redirect:'error',signal:AbortSignal.timeout(12_000),
  })
  if(BigInt(String(maximum.max_size??0))<amount)throw new Error('insufficient_delegatable_energy')
  return amount
}
async function claimGrant(pool: Database, rid: number) {
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const result=await client.query<Grant>('SELECT rid,binding_rid,bot_rid,tg_uid::text,a_addr,n_addr,tx_hash,energy_amount,audit_status,retry_count FROM t_bind_a_send_n_grant WHERE rid=$1 AND grant_status=0 AND audit_status IN (0,2) FOR UPDATE SKIP LOCKED',[rid])
    const grant=result.rows[0]
    if(!grant){await client.query('ROLLBACK');return null}
    const action=await client.query("INSERT INTO t_platform_bindasendn_action(grant_rid,state,updated_at) VALUES($1,'claimed',now()) ON CONFLICT(grant_rid) DO UPDATE SET updated_at=now() WHERE t_platform_bindasendn_action.state='claimed' AND t_platform_bindasendn_action.updated_at<=now()-interval '60 seconds' RETURNING grant_rid",[rid])
    if(!action.rowCount){await client.query('ROLLBACK');return null}
    await client.query('UPDATE t_bind_a_send_n_grant SET update_time=now() WHERE rid=$1',[rid])
    await client.query('COMMIT')
    return grant
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
}
async function loadSigningPlatform(pool: Database, config: Config) {
  if(config.energy_platform_bot_rid!==null){
    const result=await pool.query('SELECT p.rid,p.platform_uid,p.platform_apikey,p.permission_id FROM t_energy_platform_bot b JOIN t_energy_platform p ON p.platform_uid=b.receive_wallet WHERE b.rid=$1 AND p.status=0 AND p.platform_apikey IS NOT NULL LIMIT 1',[config.energy_platform_bot_rid])
    return result.rows[0]??null
  }
  const result=await pool.query('SELECT rid,platform_uid,platform_apikey,permission_id FROM t_energy_platform WHERE status=0 AND platform_apikey IS NOT NULL AND platform_balance>0 ORDER BY seq_sn DESC LIMIT 1')
  return result.rows[0]??null
}
async function signGrant(fetcher: typeof fetch, grant: Grant, platform: Record<string,unknown>, sun: bigint) {
  const token=process.env.TRON_SIGNER_TOKEN?.trim(),base=process.env.TRON_SIGNER_URL?.trim()
  if(!token||token.length<32||!base)throw new Error('signer_not_configured')
  const url=new URL(base),env=(process.env.APP_ENV||'production').toLowerCase()
  if(url.protocol!=='https:'&&!['local','dev','development'].includes(env))throw new Error('signer_https_required')
  const response=await fetcher(new URL('/api/internal/tron/sign',url),{
    method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({operation:'delegate_resource',private_key_ciphertext:String(platform.platform_apikey),from_address:String(platform.platform_uid),to_address:grant.n_addr,amount:trx(sun),resource_type:'ENERGY',permission_id:Number(platform.permission_id??0)}),
    redirect:'error',signal:AbortSignal.timeout(30_000),
  })
  const body=object(await response.json().catch(()=>null)),data=object(body?.data),txid=String(data?.txid??'')
  if(!response.ok||body?.code!==200||!/^[a-f0-9]{64}$/i.test(txid))throw new Error('signer_result_ambiguous')
  return txid
}
async function finishGrant(pool: Database, grant: Grant, platform: Record<string,unknown>, txid: string) {
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("UPDATE t_platform_bindasendn_action SET state='succeeded',tx_hash=$2,updated_at=now() WHERE grant_rid=$1 AND state='signing'",[grant.rid,txid])
    await client.query('UPDATE t_bind_a_send_n_grant SET grant_status=1,update_time=now(),fail_reason=NULL WHERE rid=$1 AND grant_status=0',[grant.rid])
    await client.query('INSERT INTO t_energy_platform_order(energy_platform_rid,energy_platform_bot_rid,platform_name,platform_uid,receive_address,platform_order_id,energy_amount,energy_day,energy_time,source_type,recovery_status,use_trx) VALUES($1,$2,3,$3,$4,$5,$6,0,now(),5,1,0)',
      [Number(platform.rid),Number(platform.bot_rid??0),String(platform.platform_uid),grant.n_addr,txid,grant.energy_amount])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
}
async function markManual(pool: Database, rid: number, code: string) {
  await pool.query("UPDATE t_platform_bindasendn_action SET state='manual',error_code=$2,updated_at=now() WHERE grant_rid=$1 AND state='signing'",[rid,code.slice(0,80)])
  await pool.query('UPDATE t_bind_a_send_n_grant SET grant_status=3,fail_reason=$2,update_time=now() WHERE rid=$1 AND grant_status=0',[rid,'需要人工核对：'+code.slice(0,100)])
}
async function markRetryable(pool: Database, rid: number, code: string, maxRetries: number) {
  await pool.query("UPDATE t_platform_bindasendn_action SET error_code=$2,updated_at=now() WHERE grant_rid=$1 AND state='claimed'",[rid,code.slice(0,80)])
  await pool.query('UPDATE t_bind_a_send_n_grant SET retry_count=retry_count+1,grant_status=CASE WHEN retry_count<$3 THEN 0 ELSE 2 END,fail_reason=$2,update_time=now() WHERE rid=$1 AND grant_status=0',[rid,'签名前失败，可安全重试：'+code.slice(0,100),maxRetries])
}
async function dispatchGrant(pool: Database, fetcher: typeof fetch, logger: Logger, grant: Grant, config: Config) {
  let signerInvoked=false
  try {
    const binding=await pool.query('SELECT status FROM t_bind_a_send_n_binding WHERE rid=$1',[grant.binding_rid])
    if(Number(binding.rows[0]?.status)!==1)throw new Error('binding_inactive')
    const platform=await loadSigningPlatform(pool,config)
    if(!platform)throw new Error('energy_platform_unavailable')
    const sun=await delegatedSun(fetcher,String(platform.platform_uid),grant.energy_amount)
    const claim=await pool.query("UPDATE t_platform_bindasendn_action SET state='signing',platform_rid=$2,updated_at=now() WHERE grant_rid=$1 AND state='claimed' RETURNING grant_rid",[grant.rid,platform.rid])
    if(!claim.rowCount)return
    signerInvoked=true
    const txid=await signGrant(fetcher,grant,platform,sun)
    await finishGrant(pool,grant,{...platform,bot_rid:config.energy_platform_bot_rid},txid)
    if(process.env.PLATFORM_TELEGRAM_ACTIONS==='true'){
      try {
        const bot=await pool.query('SELECT bot_token FROM t_telegram_bot WHERE rid=$1',[grant.bot_rid])
        const token=String(bot.rows[0]?.bot_token??'')
        if(token)await fetcher('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:grant.tg_uid,text:'✅ 绑A送N 能量发放成功！\\n\\nN地址：<code>'+grant.n_addr+'</code>\\n能量：<b>'+grant.energy_amount+'</b>\\n触发Tx：<code>'+grant.tx_hash.slice(0,20)+'...</code>',parse_mode:'HTML',allow_sending_without_reply:true}),redirect:'error',signal:AbortSignal.timeout(12_000)})
      }catch{logger.error('bindasendn notification failed: '+grant.rid)}
    }
  }catch(error){
    const message=error instanceof Error?error.message:'worker_error'
    logger.error('bindasendn grant processing failed: '+grant.rid+' '+message)
    if(signerInvoked)await markManual(pool,grant.rid,message)
    else await markRetryable(pool,grant.rid,message,config.retry_count)
  }
}
export async function syncBindASendN(options: Options = {}) {
  const pool=options.pool??db,fetcher=options.fetcher??fetch,logger=options.logger??console
  if(!(options.enabled??process.env.PLATFORM_BIND_ASENDN_ACTIONS==='true'))return STOP
  const config=await getConfig(pool)
  if(!config||config.is_enable!==1)return{...STOP,skipped:true}
  await pool.query("UPDATE t_platform_bindasendn_action SET state='manual',error_code='signer_result_unknown',updated_at=now() WHERE state='signing' AND updated_at<=now()-interval '5 minutes'")
  await pool.query("UPDATE t_bind_a_send_n_grant g SET grant_status=3,fail_reason='需要人工核对：签名结果未知',update_time=now() FROM t_platform_bindasendn_action a WHERE a.grant_rid=g.rid AND a.state='manual' AND g.grant_status=0")
  let scanned=0,grantsCreated=0,delegated=0,manual=0
  const bindings=await pool.query<Binding>("SELECT rid,bot_rid,tg_uid::text,wallet_addr FROM t_bind_a_send_n_binding WHERE status=1 AND length(wallet_addr)=34 ORDER BY rid LIMIT 100")
  for(const binding of bindings.rows){
    if(options.shouldContinue&&!options.shouldContinue())break
    try{
      const transactions=await scanAddress(fetcher,binding)
      for(const tx of transactions){
        scanned++
        const transfer=parseTransfer(tx,binding.wallet_addr)
        if(transfer&&await createGrant(pool,binding,transfer,config))grantsCreated++
      }
    }catch(error){logger.error('bindasendn address scan failed: '+binding.rid)}
  }
  const pending=await pool.query<{rid:number}>("SELECT rid FROM t_bind_a_send_n_grant WHERE grant_status=0 AND audit_status IN (0,2) AND (update_time IS NULL OR update_time<=now()-interval '60 seconds') ORDER BY rid LIMIT 10")
  for(const row of pending.rows){
    if(options.shouldContinue&&!options.shouldContinue())break
    const grant=await claimGrant(pool,Number(row.rid))
    if(!grant)continue
    await dispatchGrant(pool,fetcher,logger,grant,config)
    const state=await pool.query('SELECT state FROM t_platform_bindasendn_action WHERE grant_rid=$1',[grant.rid])
    if(state.rows[0]?.state==='succeeded')delegated++
    if(state.rows[0]?.state==='manual')manual++
  }
  return{skipped:false,scanned,grantsCreated,delegated,manual}
}
