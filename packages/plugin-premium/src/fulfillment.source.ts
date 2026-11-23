import type { DatabaseConnection } from './host-types.js'
import { telegramPremiumStarPrice } from './index.js'

export type PremiumFulfillmentDatabase = Pick<DatabaseConnection, 'query' | 'connect'>
export type PremiumFulfillmentLogger = Pick<Console, 'info' | 'error'>
export type PremiumRunPayment = (amount: string, ref: string, months: number, mnemonic: string) => Promise<string>
export type PremiumFulfillmentOptions = {
  pool: PremiumFulfillmentDatabase
  decryptSecret: (value: string | null) => string
  runPayment: PremiumRunPayment
  preflight: (mnemonic: string) => Promise<boolean>
  fetcher?: typeof fetch
  logger?: PremiumFulfillmentLogger
  shouldContinue?: () => boolean
  enabled?: boolean
  allowTelegramStars?: boolean
  batchSize?: number
}

type Trade = { rid: number; transferfrom_address: string; transferto_address: string; amount: string; platform_order_rid: number | null }
type DueOrder = { rid: number; bot_rid: number; premium_platform_rid: number; recipient: string | null; premium_package_month: number; fulfillment_method: 'fragment_ton'|'telegram_stars'; need_pay_stars: number; premium_tg_user_id: string|null }
type Platform = { rid: number; platform_name: number; platform_hash: string | null; platform_cookie: string | null; platform_phrase: string | null; bot_token?: string|null }
type FragmentTransaction = { payload?: unknown; amount?: unknown }
type FragmentResponse = { ok?: unknown; req_id?: unknown; error?: unknown; transaction?: { messages?: FragmentTransaction[] } }
type TelegramApiResponse = { ok?: boolean; result?: unknown; description?: string }

const headers = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36', Referer: 'https://fragment.com/' }

async function fragmentRequest(fetcher: typeof fetch, hash: string, cookie: string, params: Record<string, string | number>): Promise<FragmentResponse> {
  const url = new URL('https://fragment.com/api')
  for (const [key, value] of Object.entries({ hash, ...params })) url.searchParams.set(key, String(value))
  const response = await fetcher(url, { headers: { ...headers, Cookie: cookie }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`FRAGMENT_HTTP_${response.status}`)
  const body: unknown = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('FRAGMENT_INVALID_RESPONSE')
  return body as FragmentResponse
}

function refFromPayload(payload: string): string {
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64').toString('utf8')
  const ref = /#([A-Za-z0-9]{9})/.exec(decoded)?.[1]
  if (!ref) throw new Error('FRAGMENT_PAYMENT_REF_MISSING')
  return ref
}

async function matchTrade(pool: PremiumFulfillmentDatabase, rid: number) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const locked = await client.query<Trade>("SELECT t.rid,t.transferfrom_address,t.transferto_address,t.amount::text,t.platform_order_rid FROM t_premium_wallet_trade_list t WHERE t.rid=$1 AND t.process_status=1 AND t.coin_name='usdt' FOR UPDATE SKIP LOCKED", [rid])
    const trade = locked.rows[0]
    if (!trade) { await client.query('ROLLBACK'); return 'skipped' }
    const platformResult = await client.query<{ rid: number }>('SELECT rid FROM t_premium_platform WHERE receive_wallet=$1 ORDER BY rid LIMIT 1', [trade.transferto_address])
    const platformRid = platformResult.rows[0]?.rid
    if (!platformRid) { await client.query('ROLLBACK'); return 'skipped' }
    const order = trade.platform_order_rid
      ? await client.query<{ rid: number; status: number }>("SELECT rid,status FROM t_premium_platform_order WHERE rid=$1 AND premium_platform_rid=$2 AND status IN (0,1) FOR UPDATE SKIP LOCKED", [trade.platform_order_rid, platformRid])
      : await client.query<{ rid: number; status: number }>('SELECT rid,status FROM t_premium_platform_order WHERE premium_platform_rid=$1 AND need_pay_usdt=$2::numeric AND status=0 ORDER BY rid LIMIT 1 FOR UPDATE SKIP LOCKED', [platformRid, trade.amount])
    const matchedOrder = order.rows[0]
    if (!matchedOrder) {
      await client.query("UPDATE t_premium_wallet_trade_list SET process_status=7,process_comments='金额无对应订单',process_time=now(),premium_platform_rid=$2 WHERE rid=$1", [rid, platformRid])
      await client.query('COMMIT')
      return 'unmatched'
    }
    if (Number(matchedOrder.status) === 0) await client.query('UPDATE t_premium_platform_order SET status=1,update_time=now() WHERE rid=$1 AND status=0', [matchedOrder.rid])
    await client.query("UPDATE t_premium_wallet_trade_list SET process_status=9,process_comments='SUCCESS',process_time=now(),premium_platform_rid=$2,platform_order_rid=$3 WHERE rid=$1", [rid, platformRid, matchedOrder.rid])
    await client.query('COMMIT')
    return 'matched'
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function completeOrder(pool: PremiumFulfillmentDatabase, rid: number, txHash: string|null) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const payment = await client.query("UPDATE t_platform_premium_payment SET state='succeeded',tx_hash=$2,error_code=NULL,updated_at=now() WHERE order_rid=$1 AND state='submitting' RETURNING order_rid", [rid, txHash])
    if (payment.rowCount !== 1) throw new Error('PREMIUM_PAYMENT_LEDGER_STATE_CHANGED')
    const order = await client.query("UPDATE t_premium_platform_order SET status=2,comments='开通成功',complete_time=now(),update_time=now(),tg_notice_user='Y',tg_notice_admin='Y',tx_hash=$2 WHERE rid=$1 AND status=6 RETURNING rid", [rid, txHash])
    if (order.rowCount !== 1) throw new Error('PREMIUM_ORDER_STATE_CHANGED')
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function failOrder(pool: PremiumFulfillmentDatabase, rid: number, message: string, manual: boolean) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("UPDATE t_premium_platform_order SET comments=$2,status=5,update_time=now(),tg_notice_admin='Y' WHERE rid=$1 AND status IN (1,6)", [rid, message.slice(0, 240)])
    if (manual) await client.query("UPDATE t_platform_premium_payment SET state='manual',error_code='TON_RESULT_UNCONFIRMED',updated_at=now() WHERE order_rid=$1 AND state IN ('prepared','submitting')", [rid])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function waitForStars(pool: PremiumFulfillmentDatabase, rid: number, reason: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const previous=await client.query<{error_code:string|null}>('SELECT error_code FROM t_platform_premium_payment WHERE order_rid=$1 FOR UPDATE',[rid])
    const notifyAdmin=previous.rows[0]?.error_code!==reason
    await client.query("UPDATE t_platform_premium_payment SET state='waiting_stars',error_code=$2,updated_at=now() WHERE order_rid=$1 AND state='prepared'", [rid, reason])
    const comment=reason==='BOT_STARS_INSUFFICIENT'?'机器人 Stars 余额不足，补充后将自动重试':'机器人 Stars 余额暂不可用，系统将自动重试'
    await client.query("UPDATE t_premium_platform_order SET status=1,comments=$2,update_time=now(),tg_notice_admin=CASE WHEN $3 THEN 'Y' ELSE tg_notice_admin END WHERE rid=$1 AND status=6", [rid,comment,notifyAdmin])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function failStarsOrder(pool: PremiumFulfillmentDatabase, rid: number, code: string, message: string) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("UPDATE t_platform_premium_payment SET state='manual',error_code=$2,updated_at=now() WHERE order_rid=$1 AND state IN ('prepared','submitting')", [rid, code])
    await client.query("UPDATE t_premium_platform_order SET status=5,comments=$2,update_time=now(),tg_notice_user='Y',tg_notice_admin='Y' WHERE rid=$1 AND status=6", [rid, message.slice(0, 240)])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

async function telegramStarsCall(fetcher: typeof fetch, token: string, method: 'getMyStarBalance'|'giftPremiumSubscription', payload?: Record<string, unknown>) {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/u.test(token)) throw new Error('TELEGRAM_BOT_TOKEN_INVALID')
  const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
    ...(payload ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
    redirect: 'error', signal: AbortSignal.timeout(12_000),
  })
  const body = await response.json().catch(() => null) as TelegramApiResponse|null
  if (!response.ok || body?.ok !== true) return { ok: false, description: body?.description ?? 'Telegram API request failed' }
  return { ok: true, result: body.result }
}

async function fulfillStarsOrder(pool: PremiumFulfillmentDatabase, order: DueOrder, fetcher: typeof fetch, shouldContinue: () => boolean, logger: PremiumFulfillmentLogger) {
  const client = await pool.connect()
  let platform: Platform|undefined
  try {
    await client.query('BEGIN')
    const locked = await client.query<DueOrder>('SELECT rid,bot_rid,premium_platform_rid,recipient,premium_package_month,fulfillment_method,need_pay_stars,premium_tg_user_id::text AS premium_tg_user_id FROM t_premium_platform_order WHERE rid=$1 AND fulfillment_method=\'telegram_stars\' AND status=1 FOR UPDATE SKIP LOCKED', [order.rid])
    const current = locked.rows[0]
    if (!current) { await client.query('ROLLBACK'); return 'skipped' }
    const expectedStars = telegramPremiumStarPrice(current.premium_package_month)
    if (!current.premium_tg_user_id || !Number.isSafeInteger(Number(current.premium_tg_user_id)) || Number(current.premium_tg_user_id)<=0 || !expectedStars || expectedStars!==Number(current.need_pay_stars)) {
      await client.query("UPDATE t_premium_platform_order SET status=5,comments='Telegram Stars 订单数据无效，需人工核查',update_time=now(),tg_notice_user='Y',tg_notice_admin='Y' WHERE rid=$1", [current.rid])
      await client.query('COMMIT')
      return 'failed'
    }
    const found=await client.query<Platform>('SELECT p.rid,p.platform_name,b.bot_token FROM t_premium_platform p JOIN t_telegram_bot b ON b.rid=p.bot_rid WHERE p.rid=$1 AND p.bot_rid=$2 AND p.status=0 FOR UPDATE OF p',[current.premium_platform_rid,current.bot_rid])
    platform=found.rows[0]
    if(!platform||Number(platform.platform_name)!==3||!platform.bot_token){
      await client.query("UPDATE t_premium_platform_order SET status=5,comments='Telegram Stars 机器人平台不可用',update_time=now(),tg_notice_user='Y',tg_notice_admin='Y' WHERE rid=$1",[current.rid])
      await client.query('COMMIT')
      return 'failed'
    }
    const payment=await client.query<{state:string}>('SELECT state FROM t_platform_premium_payment WHERE order_rid=$1 FOR UPDATE',[current.rid])
    if(payment.rows[0]&&payment.rows[0].state!=='waiting_stars'){
      await client.query("UPDATE t_premium_platform_order SET status=5,comments='Telegram Stars 扣款结果待人工核查',update_time=now(),tg_notice_admin='Y' WHERE rid=$1",[current.rid])
      await client.query("UPDATE t_platform_premium_payment SET state='manual',error_code='PREVIOUS_STARS_ATTEMPT_REQUIRES_REVIEW',updated_at=now() WHERE order_rid=$1 AND state IN ('prepared','submitting')",[current.rid])
      await client.query('COMMIT')
      return 'manual'
    }
    if(payment.rowCount){
      await client.query("UPDATE t_platform_premium_payment SET state='prepared',updated_at=now() WHERE order_rid=$1 AND state='waiting_stars'",[current.rid])
    }else{
      await client.query("INSERT INTO t_platform_premium_payment(order_rid,state,payment_method,target_user_id,star_count) VALUES($1,'prepared','telegram_stars',$2,$3)",[current.rid,current.premium_tg_user_id,expectedStars])
    }
    await client.query("UPDATE t_premium_platform_order SET status=6,comments='检查 Telegram Stars 余额',update_time=now() WHERE rid=$1 AND status=1",[current.rid])
    await client.query('COMMIT')
    order=current
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  if(!platform?.bot_token)return 'failed'
  try{
    if(!shouldContinue())return 'skipped'
    let balance:Awaited<ReturnType<typeof telegramStarsCall>>
    try{balance=await telegramStarsCall(fetcher,platform.bot_token,'getMyStarBalance')}
    catch{await waitForStars(pool,order.rid,'STAR_BALANCE_CHECK_FAILED');return 'waiting'}
    if(!balance.ok||!balance.result||typeof balance.result!=='object'||!Number.isSafeInteger(Number((balance.result as {amount?:unknown}).amount))){
      await waitForStars(pool,order.rid,'STAR_BALANCE_CHECK_FAILED')
      return 'waiting'
    }
    const available=Number((balance.result as {amount:number}).amount),required=Number(order.need_pay_stars)
    if(available<required){await waitForStars(pool,order.rid,'BOT_STARS_INSUFFICIENT');return 'waiting'}
    const submitting=await pool.connect()
    try{
      const changed=await submitting.query("UPDATE t_platform_premium_payment SET state='submitting',updated_at=now() WHERE order_rid=$1 AND state='prepared' RETURNING order_rid",[order.rid])
      if(changed.rowCount!==1)return 'manual'
    }finally{submitting.release()}
    const gift=await telegramStarsCall(fetcher,platform.bot_token,'giftPremiumSubscription',{user_id:Number(order.premium_tg_user_id),month_count:order.premium_package_month,star_count:required,text:`会员订单 #${order.rid}`})
    if(!gift.ok||gift.result!==true){
      await failStarsOrder(pool,order.rid,'TELEGRAM_STARS_GIFT_REJECTED','Telegram Stars 官方开通失败，需人工核查')
      logger.error(`Premium Stars order ${order.rid} gift request was rejected`)
      return 'manual'
    }
    await completeOrder(pool,order.rid,null)
    logger.info(`Premium Stars order ${order.rid} completed`)
    return 'succeeded'
  }catch(error){
    await failStarsOrder(pool,order.rid,'TELEGRAM_STARS_RESULT_UNCONFIRMED','Telegram Stars 开通结果不确定，需人工核查')
    logger.error(`Premium Stars order ${order.rid} requires manual reconciliation: ${error instanceof Error?error.name:'unknown error'}`)
    return 'manual'
  }
}

async function fulfillOrder(pool: PremiumFulfillmentDatabase, order: DueOrder, fetcher: typeof fetch, options: PremiumFulfillmentOptions, shouldContinue: () => boolean, logger: PremiumFulfillmentLogger) {
  const client = await pool.connect()
  let platform: Platform | undefined
  try {
    await client.query('BEGIN')
    const locked = await client.query<DueOrder>('SELECT rid,bot_rid,premium_platform_rid,recipient,premium_package_month FROM t_premium_platform_order WHERE rid=$1 AND status=1 FOR UPDATE SKIP LOCKED', [order.rid])
    if (!locked.rowCount) { await client.query('ROLLBACK'); return 'skipped' }
    const existing = await client.query<{ state: string }>('SELECT state FROM t_platform_premium_payment WHERE order_rid=$1 FOR UPDATE', [order.rid])
    if (existing.rowCount) {
      await client.query("UPDATE t_premium_platform_order SET status=5,comments='TON 付款状态待人工核查',update_time=now(),tg_notice_admin='Y' WHERE rid=$1 AND status=1", [order.rid])
      await client.query("UPDATE t_platform_premium_payment SET state='manual',error_code='PREVIOUS_ATTEMPT_REQUIRES_REVIEW',updated_at=now() WHERE order_rid=$1 AND state IN ('prepared','submitting')", [order.rid])
      await client.query('COMMIT')
      return 'manual'
    }
    const found = await client.query<Platform>('SELECT rid,platform_name,platform_hash,platform_cookie,platform_phrase FROM t_premium_platform WHERE rid=$1 AND bot_rid=$2 AND status=0 FOR UPDATE', [order.premium_platform_rid, order.bot_rid])
    platform = found.rows[0]
    if (!platform) {
      await client.query("UPDATE t_premium_platform_order SET status=5,comments='无可用会员平台',update_time=now(),tg_notice_admin='Y' WHERE rid=$1", [order.rid])
      await client.query('COMMIT')
      return 'failed'
    }
    await client.query("INSERT INTO t_platform_premium_payment(order_rid,state) VALUES($1,'prepared')", [order.rid])
    await client.query("UPDATE t_premium_platform_order SET status=6,comments='开通中',update_time=now() WHERE rid=$1 AND status=1", [order.rid])
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  if (!platform) return 'failed'
  let signerInvoked = false
  try {
    if (!shouldContinue()) return 'skipped'
    if (Number(platform.platform_name) === 3 || !order.recipient) throw new Error('PREMIUM_FRAGMENT_ORDER_PLATFORM_MISMATCH')
    const cookie = options.decryptSecret(platform.platform_cookie), mnemonic = options.decryptSecret(platform.platform_phrase)
    if (!cookie) throw new Error('会员平台未配置 Cookie')
    if (!mnemonic) throw new Error('会员平台未配置助记词')
    if (!platform.platform_hash) throw new Error('会员平台缺少 Fragment 配置')
    if (!await options.preflight(mnemonic)) throw new Error('TON 网关预检失败')
    const init = await fragmentRequest(fetcher, platform.platform_hash, cookie, { recipient: order.recipient, months: order.premium_package_month, payment_method: 'ton', method: 'initGiftPremiumRequest' })
    if (init.ok !== true || !init.req_id) throw new Error(`FRAGMENT_INIT_FAILED:${String(init.error ?? 'missing req_id')}`)
    const device = JSON.stringify({ platform: 'iphone', appName: 'Tonkeeper', appVersion: '4.9.0', maxProtocolVersion: 2, features: ['SendTransaction', { name: 'SendTransaction', maxMessages: 4 }] })
    const gift = await fragmentRequest(fetcher, platform.platform_hash, cookie, { device, transaction: 1, id: String(init.req_id), show_sender: 1, method: 'getGiftPremiumLink' })
    const message = gift.transaction?.messages?.[0], payload = typeof message?.payload === 'string' ? message.payload : '', rawAmount = message?.amount
    if (gift.ok !== true || !payload || (typeof rawAmount !== 'number' && typeof rawAmount !== 'string') || !/^\d{1,32}$/.test(String(rawAmount)) || BigInt(String(rawAmount)) <= 0n) throw new Error('FRAGMENT_TRANSACTION_INVALID')
    const amount = (BigInt(String(rawAmount)) / 1_000_000_000n).toString() + '.' + (BigInt(String(rawAmount)) % 1_000_000_000n).toString().padStart(9, '0')
    const ref = refFromPayload(payload)
    if (!shouldContinue()) return 'skipped'
    const submitting = await pool.connect()
    try { await submitting.query("UPDATE t_platform_premium_payment SET state='submitting',updated_at=now() WHERE order_rid=$1 AND state='prepared'", [order.rid]) } finally { submitting.release() }
    signerInvoked = true
    const txHash = await options.runPayment(amount, ref, order.premium_package_month, mnemonic)
    await completeOrder(pool, order.rid, txHash)
    logger.info(`Premium order ${order.rid} completed`)
    return 'succeeded'
  } catch (error) {
    const message = error instanceof Error ? error.message : '会员开通失败'
    await failOrder(pool, order.rid, signerInvoked ? 'TON 付款结果不确定，需人工核查' : message, signerInvoked)
    logger.error(`Premium order ${order.rid} failed${signerInvoked ? ' after signer invocation; manual review required' : ''}: ${signerInvoked ? 'TON_RESULT_UNCONFIRMED' : message.slice(0, 100)}`)
    return signerInvoked ? 'manual' : 'failed'
  }
}

async function reconcileInterruptedPayments(pool: PremiumFulfillmentDatabase) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const stale = await client.query<{ order_rid: number; payment_method: string }>("UPDATE t_platform_premium_payment SET state='manual',error_code='INTERRUPTED_PAYMENT_REQUIRES_REVIEW',updated_at=now() WHERE state IN ('prepared','submitting') AND updated_at < now()-interval '10 minutes' RETURNING order_rid,payment_method")
    if (stale.rowCount) await client.query("UPDATE t_premium_platform_order SET status=5,comments=CASE WHEN fulfillment_method='telegram_stars' THEN 'Telegram Stars 付款进程中断，需人工核查' ELSE 'TON 付款进程中断，需人工核查' END,update_time=now(),tg_notice_user=CASE WHEN fulfillment_method='telegram_stars' THEN 'Y' ELSE tg_notice_user END,tg_notice_admin='Y' WHERE rid=ANY($1::int[]) AND status=6", [stale.rows.map(row => row.order_rid)])
    await client.query('COMMIT')
    return stale.rowCount ?? stale.rows.length
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export async function syncPremiumFulfillment(options: PremiumFulfillmentOptions) {
  const shouldContinue = options.shouldContinue ?? (() => true), logger = options.logger ?? console
  if (!options.enabled || !shouldContinue()) return { skipped: true, scanned: 0, matched: 0, succeeded: 0, failed: 0, manual: 0 }
  const { pool } = options, fetcher = options.fetcher ?? fetch
  const trades = await pool.query<{ rid: number }>("SELECT rid FROM t_premium_wallet_trade_list WHERE process_status=1 AND coin_name='usdt' ORDER BY rid LIMIT 100")
  let matched = 0, failed = 0, manual = await reconcileInterruptedPayments(pool), succeeded = 0
  for (const row of trades.rows) {
    if (!shouldContinue()) break
    try { if (await matchTrade(pool, Number(row.rid)) === 'matched') matched++ }
    catch (error) { logger.error(`Premium trade ${row.rid} matching failed: ${error instanceof Error ? error.message : 'database error'}`) }
  }
  const due = await pool.query<DueOrder>("SELECT rid,bot_rid,premium_platform_rid,recipient,premium_package_month,fulfillment_method,need_pay_stars,premium_tg_user_id::text AS premium_tg_user_id FROM t_premium_platform_order WHERE status=1 AND (fulfillment_method='fragment_ton' OR (fulfillment_method='telegram_stars' AND (update_time IS NULL OR update_time<now()-interval '30 seconds'))) ORDER BY rid LIMIT $1", [options.batchSize ?? 5])
  for (const order of due.rows) {
    if (!shouldContinue()) break
    const result = order.fulfillment_method==='telegram_stars'
      ? options.allowTelegramStars ? await fulfillStarsOrder(pool,order,fetcher,shouldContinue,logger) : 'waiting'
      : await fulfillOrder(pool, order, fetcher, options, shouldContinue, logger)
    if (result === 'succeeded') succeeded++
    else if (result === 'manual') manual++
    else if (result === 'failed') failed++
  }
  return { skipped: false, scanned: trades.rows.length + due.rows.length, matched, succeeded, failed, manual }
}
