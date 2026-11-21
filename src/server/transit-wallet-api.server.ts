import { constants, createPublicKey, publicEncrypt, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { can, identity, run } from './api.server'
import { db } from './db.server'
import { encryptPrivateKey } from '@tgbotpress/plugin-transit/private-key.js'
import { timestamp } from '@tgbotpress/plugin-transit/units.js'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const time = z.string().trim().max(19).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/, '\u5f00\u59cb\u65f6\u95f4\u683c\u5f0f\u65e0\u6548').refine(value => {
  if (!value) return true
  const [date, clock] = value.split('T')
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute, second = 0] = clock.split(':').map(Number)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1] &&
    hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
}, '\u5f00\u59cb\u65f6\u95f4\u65e0\u6548').or(z.literal(''))
let publicKey: KeyObject | undefined
function configuredPublicKey() {
  if (publicKey) return publicKey
  const path = process.env.TRON_RSA_PUBLIC_KEY_PATH
  const raw = (path ? readFileSync(path, 'utf8') : process.env.TRON_RSA_PUBLIC_KEY)?.replace(/\\n/g, '\n').trim()
  if (!raw) throw new Error('RSA_PUBLIC_KEY_UNAVAILABLE')
  const key = createPublicKey(raw)
  const bits = key.asymmetricKeyDetails?.modulusLength
  if (!bits || bits < 2048 || bits % 8 !== 0) throw new Error('RSA_PUBLIC_KEY_INVALID')
  publicKey = key
  return key
}
function originError(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  return null
}
const walletFields = {
  bot_rid: z.union([id, z.null()]),
  chain_type: z.literal('trc'),
  receive_wallet: z.string().trim().min(1).max(200),
  send_wallet: z.string().trim().min(1).max(200),
  show_notes: z.string().trim().max(500),
  tg_notice_obj_receive: z.string().trim().max(200),
  tg_notice_obj_send: z.string().trim().max(200),
  get_tx_time: time,
}
const base = 'admin.transit.wallet'
const access = (user: Awaited<ReturnType<typeof identity>>) => can(user, '闪兑管理', `${base}.index`) && can(user, '闪兑钱包', `${base}.index`)
const allowed = (user: Awaited<ReturnType<typeof identity>>, permission: string, action: string) => can(user, permission, `${base}.${action}`)
function addressPattern(value: string) { return value.trim() }

export function transitWalletApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!access(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.searchParams.get('action') === 'options') {
        const bots = await db.query(`SELECT rid, bot_firstname, bot_username FROM t_telegram_bot ORDER BY rid DESC`)
        return Response.json({ bots: bots.rows }, { headers })
      }
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        receive: z.string().trim().max(200).default(''),
        send: z.string().trim().max(200).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const receive = `%${input.receive.replace(/[!%_]/g, char => `!${char}`)}%`
      const send = `%${input.send.replace(/[!%_]/g, char => `!${char}`)}%`
      const where = `($1 = '%%' OR COALESCE(w.receive_wallet,'') ILIKE $1 ESCAPE '!') AND ($2 = '%%' OR COALESCE(w.send_wallet,'') ILIKE $2 ESCAPE '!')`
      const values = [receive, send]
      const total = await db.query(`SELECT count(*)::int AS total FROM t_transit_wallet w WHERE ${where}`, values)
      const result = await db.query(`SELECT w.rid, w.bot_rid, b.bot_firstname, b.bot_username, w.chain_type,
        w.receive_wallet, w.send_wallet, w.show_notes, w.status,
        (NULLIF(BTRIM(w.send_wallet_privatekey), '') IS NOT NULL) AS private_key_configured,
        w.tg_notice_obj_receive, w.tg_notice_obj_send,
        to_char(w.get_tx_time, 'YYYY-MM-DD"T"HH24:MI') AS get_tx_time,
        to_char(w.create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time,
        to_char(w.update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time
        FROM t_transit_wallet w LEFT JOIN t_telegram_bot b ON b.rid=w.bot_rid
        WHERE ${where} ORDER BY w.rid DESC LIMIT $3 OFFSET $4`, [...values, input.pageSize, (input.page - 1) * input.pageSize])
      return Response.json({
        rows: result.rows.map(row => ({ ...row, enabled: Number(row.status) === 0 })), total: total.rows[0].total,
        page: input.page, pageSize: input.pageSize,
        canAdd: allowed(user, '添加闪兑钱包', 'add'), canEdit: allowed(user, '修改闪兑钱包', 'update'),
        canManageKey: allowed(user, '修改私钥', 'updateprikey'), canDelete: allowed(user, '删除闪兑钱包', 'delete'),
        canChangeStatus: allowed(user, '修改闪兑钱包', 'change_status'),
      }, { headers })
    }
    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const badOrigin = originError(request)
    if (badOrigin) return badOrigin
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.discriminatedUnion('action', [
      z.object({ action: z.literal('create'), ...walletFields }).strict(),
      z.object({ action: z.literal('update'), rid: id, ...walletFields }).strict(),
      z.object({ action: z.literal('delete'), rid: id }).strict(),
      z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict(),
      z.object({ action: z.literal('private-key'), rid: id, send_wallet_privatekey: z.string().trim().min(1).max(4000) }).strict(),
    ]).parse(body)
    const permission = action.action === 'create' ? ['添加闪兑钱包', 'add'] : action.action === 'update' ? ['修改闪兑钱包', 'update'] : action.action === 'delete' ? ['删除闪兑钱包', 'delete'] : action.action === 'status' ? ['修改闪兑钱包', 'change_status'] : ['修改私钥', 'updateprikey']
    if (!allowed(user, permission[0], permission[1])) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    let encryptedKey: string | null = null
    if (action.action === 'private-key') {
      try { encryptedKey = encryptPrivateKey(action.send_wallet_privatekey, configuredPublicKey().export({ type: 'spki', format: 'pem' }).toString()) }
      catch (error) {
        const tooLong = error instanceof RangeError
        return Response.json({ message: tooLong ? '私钥长度超出加密存储上限' : '服务端 RSA 公钥未正确配置，暂不能更新私钥' }, { status: tooLong ? 400 : 503, headers })
      }
    }
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      let resourceId: number
      if (action.action === 'create' || action.action === 'update') {
        const rid = action.action === 'update' ? action.rid : null
        if (rid) {
          const current = await client.query('SELECT rid FROM t_transit_wallet WHERE rid=$1 FOR UPDATE', [rid])
          if (!current.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '闪兑钱包不存在' }, { status: 404, headers }) }
        }
        const address = addressPattern(action.receive_wallet)
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [action.chain_type + ':' + address])
        const duplicate = await client.query(`SELECT rid FROM t_transit_wallet WHERE chain_type=$1 AND receive_wallet=$2 AND ($3::int IS NULL OR rid<>$3) LIMIT 1`, [action.chain_type, address, rid])
        if (duplicate.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '收款钱包已存在' }, { status: 409, headers }) }
        const collisionChecks: Array<[string, string]> = [
          ['t_telegram_bot', 'recharge_wallet_addr'], ['t_energy_platform_bot', 'receive_wallet'], ['t_premium_platform', 'receive_wallet'],
        ]
        const collisionMessages = ['收款钱包不能和机器人充值地址一致', '不能和能量钱包地址一致', '不能和会员钱包地址一致']
        for (let index = 0; index < collisionChecks.length; index++) {
          const [table, column] = collisionChecks[index]
          const collision = await client.query(`SELECT rid FROM ${table} WHERE ${column}=$1 LIMIT 1`, [address])
          if (collision.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: collisionMessages[index] }, { status: 409, headers }) }
        }
        if (action.bot_rid !== null) {
          const bot = await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1', [action.bot_rid])
          if (!bot.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '通知机器人不存在' }, { status: 400, headers }) }
        }
        if (action.action === 'create') {
          const created = await client.query(`INSERT INTO t_transit_wallet(bot_rid,chain_type,receive_wallet,send_wallet,show_notes,tg_notice_obj_receive,tg_notice_obj_send,get_tx_time,create_time)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()) RETURNING rid`, [action.bot_rid, action.chain_type, address, action.send_wallet, action.show_notes, action.tg_notice_obj_receive, action.tg_notice_obj_send, timestamp(action.get_tx_time)])
          resourceId = created.rows[0].rid
        } else {
          const updated = await client.query(`UPDATE t_transit_wallet SET bot_rid=$2,chain_type=$3,receive_wallet=$4,send_wallet=$5,show_notes=$6,tg_notice_obj_receive=$7,tg_notice_obj_send=$8,get_tx_time=$9,update_time=now() WHERE rid=$1 RETURNING rid`, [rid, action.bot_rid, action.chain_type, address, action.send_wallet, action.show_notes, action.tg_notice_obj_receive, action.tg_notice_obj_send, timestamp(action.get_tx_time)])
          resourceId = updated.rows[0].rid
        }
      } else if (action.action === 'status') {
        const changed = await client.query('UPDATE t_transit_wallet SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [action.rid, action.enabled ? 0 : 1])
        if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '闪兑钱包不存在' }, { status: 404, headers }) }
        resourceId = changed.rows[0].rid
      } else if (action.action === 'private-key') {
        const changed = await client.query('UPDATE t_transit_wallet SET send_wallet_privatekey=$2,update_time=now() WHERE rid=$1 RETURNING rid', [action.rid, encryptedKey])
        if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '闪兑钱包不存在' }, { status: 404, headers }) }
        resourceId = changed.rows[0].rid
      } else {
        const dependencies = await client.query('SELECT count(*)::int AS total FROM t_transit_wallet_coin WHERE transit_wallet_id=$1', [action.rid])
        if (Number(dependencies.rows[0].total) > 0) { await client.query('ROLLBACK'); return Response.json({ message: '请先删除该钱包关联的闪兑币种' }, { status: 409, headers }) }
        const removed = await client.query('DELETE FROM t_transit_wallet WHERE rid=$1 RETURNING rid', [action.rid])
        if (!removed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '闪兑钱包不存在' }, { status: 404, headers }) }
        resourceId = removed.rows[0].rid
      }
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, `transit.wallet.${action.action}`, resourceId])
      await client.query('COMMIT')
      const labels = { create: '闪兑钱包已添加', update: '闪兑钱包已更新', status: '钱包状态已更新', 'private-key': '私钥已加密更新', delete: '闪兑钱包已删除' }
      return Response.json({ ok: true, message: labels[action.action] }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })
}
