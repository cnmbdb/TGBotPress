import { constants, createPrivateKey, createPublicKey, privateDecrypt, publicEncrypt, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { db } from './db.server'
import { can, identity, run } from './api.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const money = z.string().trim().regex(/^(?:\d{1,12})(?:\.\d{1,4})?$/, '金额最多 12 位整数和 4 位小数')
const seq = z.coerce.number().int().min(0).max(2_147_483_647)
const prefix = 'v2:'
type Kind = 'PUBLIC' | 'PRIVATE'
const keyCache: Partial<Record<Kind, KeyObject>> = {}

function configuredKey(kind: Kind): KeyObject {
  if (keyCache[kind]) return keyCache[kind]!
  const variable = `TRON_RSA_${kind}_KEY`
  const pathVariable = `TRON_RSA_${kind}_KEY_PATH`
  const path = process.env[pathVariable]
  let raw = path ? readFileSync(path, 'utf8') : process.env[variable]
  if (!raw?.trim()) throw new Error(`RSA_${kind}_KEY_UNAVAILABLE`)
  raw = raw.replace(/\\n/g, '\n').trim()
  const key = kind === 'PUBLIC' ? createPublicKey(raw) : createPrivateKey(raw)
  keyCache[kind] = key
  return key
}

function modulusBytes(key: KeyObject) {
  const bits = key.asymmetricKeyDetails?.modulusLength
  if (!bits || bits < 2048 || bits % 8 !== 0) throw new Error('RSA_KEY_INVALID')
  return bits / 8
}

function encryptPassword(password: string) {
  const key = configuredKey('PUBLIC'), bytes = modulusBytes(key), maxPart = bytes - 42
  if (maxPart <= 0) throw new Error('RSA_KEY_INVALID')
  const data = Buffer.from(password, 'utf8'), encrypted: Buffer[] = []
  for (let offset = 0; offset < data.length; offset += maxPart) {
    encrypted.push(publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, data.subarray(offset, offset + maxPart)))
  }
  const result = prefix + Buffer.concat(encrypted).toString('base64')
  if (result.length > 2000) throw new RangeError('CDKEY_SECRET_TOO_LONG')
  return result
}

function decryptPassword(ciphertext: string) {
  const key = configuredKey('PRIVATE'), bytes = modulusBytes(key), versioned = ciphertext.startsWith(prefix)
  const encoded = (versioned ? ciphertext.slice(prefix.length) : ciphertext).replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('CDKEY_CIPHERTEXT_INVALID')
  const encrypted = Buffer.from(encoded, 'base64')
  if (!encrypted.length || encrypted.length % bytes !== 0) throw new Error('CDKEY_CIPHERTEXT_INVALID')
  const decrypted: Buffer[] = []
  for (let offset = 0; offset < encrypted.length; offset += bytes) {
    decrypted.push(privateDecrypt(versioned
      ? { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }
      : { key, padding: constants.RSA_PKCS1_PADDING }, encrypted.subarray(offset, offset + bytes)))
  }
  return Buffer.concat(decrypted).toString('utf8')
}

function originError(request: Request) {
  const origin = process.env.PLATFORM_ORIGIN
  if (!origin || request.headers.get('origin') !== new URL(origin).origin || !request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  }
  return null
}

function allowed(user: Awaited<ReturnType<typeof identity>>, permission: string, route: string) {
  return can(user, permission, route)
}

export function shopCdkeysApi(request: Request) {
  return run(async () => {
    const user = await identity(request), route = 'admin.shop.cdkey.index'
    if (!allowed(user, '商城管理', route) || !allowed(user, '卡密管理', route)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })

    if (request.method === 'GET') {
      const url = new URL(request.url)
      if (url.searchParams.get('action') === 'options') {
        const goods = await db.query('SELECT rid, goods_name FROM t_shop_goods ORDER BY rid DESC')
        return Response.json({ goods: goods.rows }, { headers })
      }
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        goodsRid: z.union([z.literal('all'), id]).default('all'),
        cdkey: z.string().trim().max(100).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const pattern = `%${input.cdkey.replace(/[!%_]/g, char => `!${char}`)}%`, goodsRid = input.goodsRid === 'all' ? null : input.goodsRid
      const where = `($1::int IS NULL OR a.goods_rid = $1) AND ($2 = '%%' OR a.cdkey_no ILIKE $2 ESCAPE '!')`
      const values = [goodsRid, pattern]
      const total = await db.query(`SELECT count(*)::int AS total FROM t_shop_goods_cdkey a JOIN t_shop_goods b ON b.rid = a.goods_rid WHERE ${where}`, values)
      const result = await db.query(`SELECT a.rid, a.goods_rid, a.cdkey_no, a.cdkey_pwd, a.cdkey_trx_price::text AS cdkey_trx_price,
        a.cdkey_usdt_price::text AS cdkey_usdt_price, a.status, a.seq_sn,
        to_char(a.create_time, 'YYYY-MM-DD HH24:MI:SS') AS create_time,
        to_char(a.update_time, 'YYYY-MM-DD HH24:MI:SS') AS update_time, b.goods_name
        FROM t_shop_goods_cdkey a JOIN t_shop_goods b ON b.rid = a.goods_rid
        WHERE ${where} ORDER BY a.rid DESC LIMIT $3 OFFSET $4`, [...values, input.pageSize, (input.page - 1) * input.pageSize])
      const canView = allowed(user, '查看卡密', 'admin.shop.cdkey.show')
      const rows = result.rows.map(row => {
        const status = Number(row.status)
        return { rid: row.rid, goods_rid: row.goods_rid, goods_name: row.goods_name, cdkey_no: row.cdkey_no,
          cdkey_pwd_masked: '••••••••', cdkey_trx_price: row.cdkey_trx_price, cdkey_usdt_price: row.cdkey_usdt_price,
          status, status_label: ['待上架', '售卖中', '已售卖'][status] || `未知状态 (${status})`, seq_sn: row.seq_sn,
          create_time: row.create_time, update_time: row.update_time }
      })
      return Response.json({
        rows, total: total.rows[0].total, page: input.page, pageSize: input.pageSize,
        canAdd: allowed(user, '添加卡密', 'admin.shop.cdkey.add'),
        canBatchAdd: allowed(user, '批量添加', 'admin.shop.cdkey.batchadd'),
        canView,
        canEdit: allowed(user, '修改卡密', 'admin.shop.cdkey.update'),
        canDelete: allowed(user, '删除卡密', 'admin.shop.cdkey.delete'),
        canBatchPublish: allowed(user, '批量上架', 'admin.shop.cdkey.batchshang'),
        canBatchUnpublish: allowed(user, '批量下架', 'admin.shop.cdkey.batchxia'),
      }, { headers })
    }

    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const invalidOrigin = originError(request)
    if (invalidOrigin) return invalidOrigin
    let body: unknown
    try { body = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.discriminatedUnion('action', [
      z.object({ action: z.literal('add'), goods_rid: id, cdkey_no: z.string().trim().min(1).max(100), cdkey_pwd: z.string().min(1).max(2000), cdkey_trx_price: money.default('0'), cdkey_usdt_price: money.default('0'), seq_sn: seq.default(0) }).strict(),
      z.object({ action: z.literal('batch_add'), goods_rid: id, lines: z.string().min(1).max(500_000), cdkey_trx_price: money.default('0'), cdkey_usdt_price: money.default('0'), seq_sn: seq.default(0) }).strict(),
      z.object({ action: z.literal('update'), rid: id, goods_rid: id, cdkey_no: z.string().trim().min(1).max(100), cdkey_pwd: z.string().max(2000).optional(), cdkey_trx_price: money.default('0'), cdkey_usdt_price: money.default('0'), status: z.coerce.number().int().min(0).max(2), seq_sn: seq.default(0) }).strict(),
      z.object({ action: z.literal('delete'), rid: id }).strict(),
      z.object({ action: z.literal('set_product_status'), goods_rid: id, status: z.union([z.literal(0), z.literal(1)]) }).strict(),
      z.object({ action: z.literal('reveal'), rid: id }).strict(),
    ]).parse(body)
    let permission: string, actionRoute: string
    switch (action.action) {
      case 'add': permission = '添加卡密'; actionRoute = 'admin.shop.cdkey.add'; break
      case 'batch_add': permission = '批量添加'; actionRoute = 'admin.shop.cdkey.batchadd'; break
      case 'update': permission = '修改卡密'; actionRoute = 'admin.shop.cdkey.update'; break
      case 'delete': permission = '删除卡密'; actionRoute = 'admin.shop.cdkey.delete'; break
      case 'set_product_status':
        permission = action.status === 1 ? '批量上架' : '批量下架'
        actionRoute = action.status === 1 ? 'admin.shop.cdkey.batchshang' : 'admin.shop.cdkey.batchxia'
        break
      case 'reveal': permission = '查看卡密'; actionRoute = 'admin.shop.cdkey.show'; break
    }
    if (!allowed(user, permission, actionRoute)) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    if (action.action === 'reveal') {
      const row = await db.query('SELECT cdkey_no, cdkey_pwd, cdkey_trx_price::text AS cdkey_trx_price, cdkey_usdt_price::text AS cdkey_usdt_price FROM t_shop_goods_cdkey WHERE rid = $1', [action.rid])
      if (!row.rowCount) return Response.json({ message: '卡密不存在' }, { status: 404, headers })
      const secret = decryptPassword(String(row.rows[0].cdkey_pwd))
      await db.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.cdkey.reveal', action.rid])
      return Response.json({ cdkey_no: row.rows[0].cdkey_no, cdkey_pwd: secret, cdkey_trx_price: row.rows[0].cdkey_trx_price, cdkey_usdt_price: row.rows[0].cdkey_usdt_price }, { headers })
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (action.action === 'add' || action.action === 'batch_add') {
        const existsGoods = await client.query('SELECT rid FROM t_shop_goods WHERE rid = $1', [action.goods_rid])
        if (!existsGoods.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '商品不存在' }, { status: 404, headers })
        }
        if (action.action === 'add') {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [action.cdkey_no])
          const duplicate = await client.query('SELECT rid FROM t_shop_goods_cdkey WHERE cdkey_no = $1 LIMIT 1', [action.cdkey_no])
          if (duplicate.rowCount) {
            await client.query('ROLLBACK')
            return Response.json({ message: '卡号已存在' }, { status: 409, headers })
          }
          let encrypted: string
          try { encrypted = encryptPassword(action.cdkey_pwd) } catch (error) {
            if (error instanceof RangeError) {
              await client.query('ROLLBACK')
              return Response.json({ message: '卡密长度超过加密存储上限' }, { status: 400, headers })
            }
            throw error
          }
          const inserted = await client.query(`INSERT INTO t_shop_goods_cdkey(goods_rid, cdkey_no, cdkey_pwd, cdkey_trx_price, cdkey_usdt_price, seq_sn, status, create_time)
            VALUES($1, $2, $3, $4, $5, $6, 0, now()) RETURNING rid`, [action.goods_rid, action.cdkey_no, encrypted, action.cdkey_trx_price, action.cdkey_usdt_price, action.seq_sn])
          await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.cdkey.add', inserted.rows[0].rid])
          await client.query('COMMIT')
          return Response.json({ ok: true, message: '卡密已添加' }, { headers })
        }
        const parsed = action.lines.split('\n').map((raw, index) => ({ raw: raw.endsWith('\r') ? raw.slice(0, -1) : raw, line: index + 1 })).filter(item => item.raw.trim() !== '')
        if (!parsed.length || parsed.length > 500) {
          await client.query('ROLLBACK')
          return Response.json({ message: parsed.length ? '每次最多导入 500 条' : '请输入要导入的卡密' }, { status: 400, headers })
        }
        const records: { no: string; secret: string; line: number }[] = []
        for (const item of parsed) {
          const comma = item.raw.indexOf(',')
          if (comma < 1 || comma === item.raw.length - 1) {
            await client.query('ROLLBACK')
            return Response.json({ message: `第 ${item.line} 行格式无效，应为卡号,卡密` }, { status: 400, headers })
          }
          const no = item.raw.slice(0, comma).trim(), secret = item.raw.slice(comma + 1)
          if (!no || no.length > 100 || !secret.trim()) {
            await client.query('ROLLBACK')
            return Response.json({ message: `第 ${item.line} 行卡号或卡密为空/超长` }, { status: 400, headers })
          }
          records.push({ no, secret, line: item.line })
        }
        const firstByNo = new Map<string, { no: string; secret: string; line: number }>()
        for (const record of records) if (!firstByNo.has(record.no)) firstByNo.set(record.no, record)
        const unique = [...firstByNo.values()]
        for (const no of unique.map(record => record.no).sort()) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [no])
        const existing = await client.query('SELECT cdkey_no FROM t_shop_goods_cdkey WHERE cdkey_no = ANY($1::varchar[])', [unique.map(record => record.no)])
        const existingNos = new Set(existing.rows.map(row => String(row.cdkey_no)))
        const fresh = unique.filter(record => !existingNos.has(record.no))
        const ciphertexts: string[] = []
        try { for (const record of fresh) ciphertexts.push(encryptPassword(record.secret)) } catch (error) {
          await client.query('ROLLBACK')
          return Response.json({ message: error instanceof RangeError ? '某行卡密长度超过加密存储上限' : 'RSA 加密配置不可用' }, { status: error instanceof RangeError ? 400 : 503, headers })
        }
        for (const [index, record] of fresh.entries()) {
          const inserted = await client.query(`INSERT INTO t_shop_goods_cdkey(goods_rid, cdkey_no, cdkey_pwd, cdkey_trx_price, cdkey_usdt_price, seq_sn, status, create_time)
            VALUES($1, $2, $3, $4, $5, $6, 0, now()) RETURNING rid`, [action.goods_rid, record.no, ciphertexts[index], action.cdkey_trx_price, action.cdkey_usdt_price, action.seq_sn])
          await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.cdkey.batch_add', inserted.rows[0].rid])
        }
        await client.query('COMMIT')
        const skipped = records.length - fresh.length
        return Response.json({ ok: true, message: `已添加 ${fresh.length} 条，跳过重复 ${skipped} 条`, created: fresh.length, skipped }, { headers })
      }

      if (action.action === 'update') {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [action.cdkey_no])
        const row = await client.query('SELECT cdkey_pwd FROM t_shop_goods_cdkey WHERE rid = $1 FOR UPDATE', [action.rid])
        if (!row.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '卡密不存在' }, { status: 404, headers })
        }
        const duplicate = await client.query('SELECT rid FROM t_shop_goods_cdkey WHERE cdkey_no = $1 AND rid <> $2 LIMIT 1', [action.cdkey_no, action.rid])
        if (duplicate.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '卡号已存在' }, { status: 409, headers })
        }
        const product = await client.query('SELECT rid FROM t_shop_goods WHERE rid = $1', [action.goods_rid])
        if (!product.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '商品不存在' }, { status: 404, headers })
        }
        let encrypted = String(row.rows[0].cdkey_pwd)
        if (action.cdkey_pwd) {
          try { encrypted = encryptPassword(action.cdkey_pwd) } catch (error) {
            await client.query('ROLLBACK')
            if (error instanceof RangeError) return Response.json({ message: '卡密长度超过加密存储上限' }, { status: 400, headers })
            throw error
          }
        }
        const updated = await client.query(`UPDATE t_shop_goods_cdkey SET goods_rid = $2, cdkey_no = $3, cdkey_pwd = $4,
          cdkey_trx_price = $5, cdkey_usdt_price = $6, status = $7, seq_sn = $8, update_time = now() WHERE rid = $1 RETURNING rid`, [action.rid, action.goods_rid, action.cdkey_no, encrypted, action.cdkey_trx_price, action.cdkey_usdt_price, action.status, action.seq_sn])
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.cdkey.update', updated.rows[0].rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '卡密已更新' }, { headers })
      }
      if (action.action === 'delete') {
        const deleted = await client.query('DELETE FROM t_shop_goods_cdkey WHERE rid = $1 RETURNING rid', [action.rid])
        if (!deleted.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '卡密不存在' }, { status: 404, headers })
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, 'shop.cdkey.delete', action.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '卡密已删除' }, { headers })
      }
      const exists = await client.query('SELECT rid FROM t_shop_goods_cdkey WHERE goods_rid = $1 LIMIT 1', [action.goods_rid])
      if (!exists.rowCount) {
        await client.query('ROLLBACK')
        return Response.json({ message: '该商品没有卡密' }, { status: 404, headers })
      }
      const targetStatus = action.status === 1 ? 1 : 0
      const updated = await client.query('UPDATE t_shop_goods_cdkey SET status = $2, update_time = now() WHERE goods_rid = $1 AND status = $3', [action.goods_rid, targetStatus, targetStatus === 1 ? 0 : 1])
      await client.query('INSERT INTO t_platform_audit_log(admin_id, action, resource_id) VALUES($1, $2, $3)', [user.id, action.status === 1 ? 'shop.cdkey.batch_publish' : 'shop.cdkey.batch_unpublish', action.goods_rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: `${action.status === 1 ? '上架' : '下架'}完成，共更新 ${updated.rowCount || 0} 条`, updated: updated.rowCount || 0 }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
