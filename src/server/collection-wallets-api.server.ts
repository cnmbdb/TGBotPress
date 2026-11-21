import { createPublicKey, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { can, identity, run } from './api.server'
import { db } from './db.server'
import { visibleNavigation } from '../lib/navigation'
import { encryptRsaV2 } from './rsa-storage.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const route = 'admin.collection.wallet.index'
const id = z.coerce.number().int().positive().max(2_147_483_647)
const money = z.preprocess(v => v === '' || v === null || v === undefined ? '0' : String(v), z.string().trim().regex(/^\d{1,10}(?:\.\d{1,6})?$/))
const permissions = {
  add: ['添加归集钱包', 'admin.collection.wallet.add'],
  update: ['修改归集钱包', 'admin.collection.wallet.update'],
  delete: ['删除归集钱包', 'admin.collection.wallet.delete'],
  status: ['修改归集钱包', 'admin.collection.wallet.change_status'],
  privateKey: ['修改私钥', 'admin.collection.wallet.updateprikey'],
} as const
function permitted(user: Parameters<typeof can>[0], action: keyof typeof permissions) {
  const [name, actionRoute] = permissions[action]
  return can(user, name, actionRoute)
}
function originFailure(request: Request) {
  const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!expected || request.headers.get('origin') !== expected || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  }
  return null
}
let publicKey: KeyObject | null = null
function encryptedPrivateKey(value: string) {
  if (!publicKey) {
    const path = process.env.TRON_RSA_PUBLIC_KEY_PATH
    const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PUBLIC_KEY)?.replace(/\\n/g, '\n').trim()
    if (!raw) throw new Error('归集私钥加密公钥未配置')
    publicKey = createPublicKey(raw)
  }
  try { return encryptRsaV2(value, publicKey, 2000) }
  catch (error) {
    if (error instanceof RangeError) throw new RangeError('私钥长度超出存储限制')
    throw error
  }
}

const pageInput = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
  search: z.string().trim().max(200).default(''),
  bot: z.union([z.literal('all'), z.coerce.number().int().positive().max(2_147_483_647)]).default('all'),
})
const commonFields = {
  bot_rid: id,
  chain_type: z.literal('trc'),
  wallet_addr: z.string().trim().min(1).max(200),
  tg_notice_obj: z.string().trim().max(500).default(''),
  trx_collection_amount: money,
  usdt_collection_amount: money,
  trx_reserve_amount: money,
  usdt_reserve_amount: money,
  collection_wallet_addr: z.string().trim().max(200).default(''),
  comments: z.string().trim().max(100).default(''),
}
function amountUnits(value: string) {
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
}
function validAmounts(input: { trx_collection_amount: string; usdt_collection_amount: string; trx_reserve_amount: string; usdt_reserve_amount: string }) {
  const pairs = [['TRX', input.trx_collection_amount, input.trx_reserve_amount], ['USDT', input.usdt_collection_amount, input.usdt_reserve_amount]] as const
  for (const [label, collection, reserve] of pairs) {
    const collectionUnits = amountUnits(collection), reserveUnits = amountUnits(reserve)
    if (collectionUnits > 0n && reserveUnits >= collectionUnits) return `${label} 预留金额必须小于归集金额`
    if (collectionUnits === 0n && reserveUnits > 0n) return `${label} 未设置归集金额时，预留金额必须为 0`
  }
  return null
}

export function collectionWalletsApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!visibleNavigation(user).some(group => group.items.some(item => item.id === route))) {
      return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    }
    const url = new URL(request.url)
    if (request.method === 'GET') {
      if (url.searchParams.get('action') === 'options') {
        const bots = await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC')
        return Response.json({ bots: bots.rows }, { headers })
      }
      const input = pageInput.parse(Object.fromEntries(url.searchParams))
      const search = '%' + input.search.replace(/[!%_]/g, c => '!' + c) + '%'
      const bot = input.bot === 'all' ? null : input.bot
      const where = "($1::int IS NULL OR w.bot_rid=$1) AND ($2='%%' OR w.wallet_addr ILIKE $2 ESCAPE '!' OR COALESCE(w.comments,'') ILIKE $2 ESCAPE '!' OR w.rid::text ILIKE $2 ESCAPE '!')"
      const [total, columns] = await Promise.all([
        db.query('SELECT count(*)::int AS total FROM t_collection_wallet w WHERE ' + where, [bot, search]),
        db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='t_collection_wallet' AND column_name='last_collection_time'"),
      ])
      const lastCollectionTime = columns.rowCount ? 'w.last_collection_time' : 'NULL::timestamp AS last_collection_time'
      const rows = await db.query(
        `SELECT w.rid,w.bot_rid,b.bot_firstname,b.bot_username,(b.bot_token IS NOT NULL AND b.bot_token<>'') AS token_configured,w.chain_type,w.wallet_addr,(NULLIF(BTRIM(w.wallet_addr_privatekey),'') IS NOT NULL) AS wallet_key_configured,w.status,w.trx_balance::text AS trx_balance,w.usdt_balance::text AS usdt_balance,w.trx_collection_amount::text AS trx_collection_amount,w.usdt_collection_amount::text AS usdt_collection_amount,w.trx_reserve_amount::text AS trx_reserve_amount,w.usdt_reserve_amount::text AS usdt_reserve_amount,w.collection_wallet_addr,w.permission_id,w.tg_notice_obj,w.comments,to_char(w.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(w.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time,${lastCollectionTime} FROM t_collection_wallet w LEFT JOIN t_telegram_bot b ON b.rid=w.bot_rid WHERE ${where} ORDER BY w.rid DESC LIMIT $3 OFFSET $4`,
        [bot, search, input.pageSize, (input.page - 1) * input.pageSize],
      )
      return Response.json({ rows: rows.rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize, permissions: {
        add: permitted(user, 'add'), update: permitted(user, 'update'), delete: permitted(user, 'delete'), status: permitted(user, 'status'), privateKey: permitted(user, 'privateKey'),
      } }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const origin = originFailure(request)
    if (origin) return origin
    const raw = await request.text()
    if (raw.length > 12_000) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    let body: unknown
    try { body = JSON.parse(raw) } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.object({ action: z.enum(['add','update','delete','status','private-key']) }).parse(body).action
    const permission = action === 'add' ? 'add' : action === 'update' ? 'update' : action === 'delete' ? 'delete' : action === 'status' ? 'status' : 'privateKey'
    if (!permitted(user, permission)) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    if (action === 'private-key') {
      const input = z.object({ action: z.literal('private-key'), rid: id, wallet_addr_privatekey: z.string().trim().min(1).max(2000), permission_id: z.coerce.number().int().min(0).max(2_147_483_647).default(0) }).strict().parse(body)
      let ciphertext: string
      try { ciphertext = encryptedPrivateKey(input.wallet_addr_privatekey) }
      catch (error) { return Response.json({ message: error instanceof RangeError ? error.message : '私钥加密配置不可用' }, { status: 503, headers }) }
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        const changed = await client.query('UPDATE t_collection_wallet SET wallet_addr_privatekey=$2,permission_id=$3,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, ciphertext, input.permission_id])
        if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '归集钱包不存在' }, { status: 404, headers }) }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'collection.wallet.private_key', input.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '私钥已加密保存' }, { headers })
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      let rid: number
      let message: string
      if (action === 'add' || action === 'update') {
        const input = z.object({ action: z.enum(['add','update']), ...(action === 'update' ? { rid: id } : {}), ...commonFields }).strict().parse(body)
        const amountError = validAmounts(input)
        if (amountError) { await client.query('ROLLBACK'); return Response.json({ message: amountError }, { status: 400, headers }) }
        if (input.collection_wallet_addr && input.wallet_addr === input.collection_wallet_addr) { await client.query('ROLLBACK'); return Response.json({ message: '钱包地址与归集地址不能相同' }, { status: 400, headers }) }
        const bot = await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1', [input.bot_rid])
        if (!bot.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '机器人不存在' }, { status: 404, headers }) }
        await client.query("SELECT pg_advisory_xact_lock(hashtext('collection-wallet:'||$1||':'||$2))", [input.chain_type, input.wallet_addr])
        const duplicate = await client.query('SELECT rid FROM t_collection_wallet WHERE wallet_addr=$1 AND chain_type=$2 AND ($3::int IS NULL OR rid<>$3) LIMIT 1', [input.wallet_addr, input.chain_type, action === 'update' ? input.rid : null])
        if (duplicate.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '该链类型下归集钱包已存在' }, { status: 409, headers }) }
        const values = [input.bot_rid,input.chain_type,input.wallet_addr,input.tg_notice_obj,input.trx_collection_amount,input.usdt_collection_amount,input.trx_reserve_amount,input.usdt_reserve_amount,input.collection_wallet_addr,input.comments]
        if (action === 'add') {
          const result = await client.query("INSERT INTO t_collection_wallet(bot_rid,chain_type,wallet_addr,tg_notice_obj,trx_collection_amount,usdt_collection_amount,trx_reserve_amount,usdt_reserve_amount,collection_wallet_addr,comments,status,create_time) VALUES($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,NULLIF($9,''),NULLIF($10,''),1,now()) RETURNING rid", values)
          rid = result.rows[0].rid as number
          message = '归集钱包已添加'
        } else {
          const result = await client.query("UPDATE t_collection_wallet SET bot_rid=$2,chain_type=$3,wallet_addr=$4,tg_notice_obj=NULLIF($5,''),trx_collection_amount=$6,usdt_collection_amount=$7,trx_reserve_amount=$8,usdt_reserve_amount=$9,collection_wallet_addr=NULLIF($10,''),comments=NULLIF($11,''),update_time=now() WHERE rid=$1 RETURNING rid", [input.rid,...values])
          if (!result.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '归集钱包不存在' }, { status: 404, headers }) }
          rid = result.rows[0].rid as number
          message = '归集钱包已更新'
        }
      } else if (action === 'status') {
        const input = z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict().parse(body)
        const result = await client.query('UPDATE t_collection_wallet SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, input.enabled ? 0 : 1])
        if (!result.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '归集钱包不存在' }, { status: 404, headers }) }
        rid = input.rid
        message = '归集状态已更新'
      } else {
        const input = z.object({ action: z.literal('delete'), rid: id }).strict().parse(body)
        const result = await client.query('DELETE FROM t_collection_wallet WHERE rid=$1 RETURNING rid', [input.rid])
        if (!result.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '归集钱包不存在' }, { status: 404, headers }) }
        rid = input.rid
        message = '归集钱包已删除'
      }
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, `collection.wallet.${action}`, rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message }, { headers })
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  })
}
