import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { can, identity, run, type Identity } from './api.server'
import { db } from './db.server'
import { BotServiceError } from './bot-service.server'
import { boundedFormData, saveMessageImage } from './media-storage.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const base = 'admin.energy.package'
const access = (user: Identity) => can(user, '能量管理', `${base}.index`) && can(user, '能量套餐', `${base}.index`)
const allowed = (user: Identity, permission: string, action: string) => can(user, permission, `${base}.${action}`)
const money = z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/, '金额格式无效')
const agentMoney = z.preprocess(value => value === '' || value === undefined || value === null ? '0' : value, money)
const seq = z.preprocess(value => value === '' || value === undefined || value === null ? '0' : value, z.coerce.number().int().min(0).max(2_147_483_647))
const fields = {
  bot_rid: id,
  package_type: z.literal(1),
  package_name: z.string().trim().min(1, '套餐名称不能为空').max(50),
  energy_amount: z.coerce.number().int().min(65_000).max(2_147_483_647),
  energy_day: z.coerce.number().int().refine(value => [0, 1, 3].includes(value), '套餐期限无效'),
  trx_price: money,
  agent_trx_price: agentMoney,
  seq_sn: seq,
  show_notes: z.string().trim().max(1000).default(''),
}
function validPrice(value: string, positive: boolean) {
  const [whole, fraction = ''] = value.split('.')
  const cents = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
  return positive ? cents > 0n : cents >= 0n
}
function originError(request: Request) {
  const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!expected || request.headers.get('origin') !== expected) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  return null
}
async function parsePost(request: Request) {
  const contentType = request.headers.get('content-type') || ''
  let body: unknown, upload: File | undefined
  if (contentType.startsWith('application/json')) {
    const raw = await request.text()
    if (raw.length > 32_768) throw new BotServiceError(413, '表单内容过长')
    try { body = JSON.parse(raw) } catch { throw new BotServiceError(400, '表单内容无效') }
  } else if (contentType.startsWith('multipart/form-data')) {
    const form = await boundedFormData(request), payload = form.get('payload'), file = form.get('thumb')
    if (typeof payload !== 'string' || payload.length > 32_768) throw new BotServiceError(400, '表单内容无效')
    try { body = JSON.parse(payload) } catch { throw new BotServiceError(400, '表单内容无效') }
    if (file !== null) {
      if (!(file instanceof File)) throw new BotServiceError(400, '图片文件无效')
      upload = file
    }
  } else throw new BotServiceError(415, '请求格式无效')
  return { body, upload }
}

export function energyPackageApi(request: Request) {
  return run(async () => {
    let stored: { url: string; remove: () => Promise<void> } | undefined
    try {
      const url = new URL(request.url), user = await identity(request)
      if (!access(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })
      if (request.method === 'GET') {
        if (url.searchParams.get('action') === 'show') {
          const rid = id.parse(url.searchParams.get('rid'))
          const result = await db.query(`SELECT rid,bot_rid,package_type,package_name,energy_amount,energy_day,trx_price::text AS trx_price,
            usdt_price::text AS usdt_price,agent_trx_price::text AS agent_trx_price,status,seq_sn,show_notes,package_pic,
            to_char(create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time
            FROM t_energy_platform_package WHERE rid=$1`, [rid])
          if (!result.rowCount) return Response.json({ message: '套餐不存在' }, { status: 404, headers })
          return Response.json({ row: result.rows[0] }, { headers })
        }
        if (url.searchParams.get('action') === 'options') {
          const bots = await db.query('SELECT rid,bot_firstname,bot_username FROM t_telegram_bot ORDER BY rid DESC')
          return Response.json({ bots: bots.rows }, { headers })
        }
        const input = z.object({
          page: z.coerce.number().int().min(1).max(1_000_000).default(1),
          pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
          botRid: z.union([z.literal('all'), id]).default('all'),
          search: z.string().trim().max(50).default(''),
        }).parse(Object.fromEntries(url.searchParams))
        const botRid = input.botRid === 'all' ? null : input.botRid
        const search = `%${input.search.replace(/[!%_]/g, char => `!${char}`)}%`
        const where = `($1::int IS NULL OR p.bot_rid=$1) AND ($2='%%' OR COALESCE(p.package_name,'') ILIKE $2 ESCAPE '!')`
        const values = [botRid, search]
        const total = await db.query(`SELECT count(*)::int AS total FROM t_energy_platform_package p WHERE ${where}`, values)
        const result = await db.query(`SELECT p.rid,p.bot_rid,b.bot_firstname,b.bot_username,p.package_type,p.package_name,p.energy_amount,p.energy_day,
          p.trx_price::text AS trx_price,p.usdt_price::text AS usdt_price,p.agent_trx_price::text AS agent_trx_price,p.status,p.seq_sn,p.show_notes,p.package_pic,
          to_char(p.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(p.update_time,'YYYY-MM-DD HH24:MI:SS') AS update_time
          FROM t_energy_platform_package p LEFT JOIN t_telegram_bot b ON b.rid=p.bot_rid WHERE ${where}
          ORDER BY p.rid DESC LIMIT $3 OFFSET $4`, [...values, input.pageSize, (input.page - 1) * input.pageSize])
        return Response.json({
          rows: result.rows.map(row => ({ ...row, enabled: Number(row.status) === 0, energy_day_label: ({ 0: '1 小时', 1: '1 天', 3: '3 天' } as Record<number, string>)[Number(row.energy_day)] || `未知期限 (${row.energy_day})` })),
          total: total.rows[0].total, page: input.page, pageSize: input.pageSize,
          canAdd: allowed(user, '添加能量套餐', 'add'), canEdit: allowed(user, '修改能量套餐', 'update'),
          canDelete: allowed(user, '删除能量套餐', 'delete'), canChangeStatus: allowed(user, '修改能量套餐', 'change_status'),
          canCopy: allowed(user, '复制能量套餐', 'copy_paste'), canBatchDelete: allowed(user, '批量删除套餐', 'batchdelete'),
        }, { headers })
      }
      if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
      const badOrigin = originError(request)
      if (badOrigin) return badOrigin
      const { body, upload } = await parsePost(request)
      const actionName = z.object({ action: z.enum(['create', 'update', 'delete', 'status', 'copy', 'batch-delete']) }).parse(body).action
      const permission = actionName === 'create' ? ['添加能量套餐', 'add'] : actionName === 'update' ? ['修改能量套餐', 'update'] : actionName === 'delete' ? ['删除能量套餐', 'delete'] : actionName === 'status' ? ['修改能量套餐', 'change_status'] : actionName === 'copy' ? ['复制能量套餐', 'copy_paste'] : ['批量删除套餐', 'batchdelete']
      if (!allowed(user, permission[0], permission[1])) return Response.json({ message: '没有操作权限' }, { status: 403, headers })
      if (upload && actionName !== 'update') return Response.json({ message: '只有编辑套餐时可以上传图片' }, { status: 400, headers })
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        let resourceId: number | null = null, message = ''
        if (actionName === 'create' || actionName === 'update') {
          const schema = z.object({ action: z.enum(['create', 'update']), ...(actionName === 'update' ? { rid: id } : {}), ...fields }).strict()
          const input = schema.parse(body)
          if (!validPrice(input.trx_price, true) || !validPrice(input.agent_trx_price, false)) {
            await client.query('ROLLBACK')
            return Response.json({ message: 'TRX 售价必须大于 0，代理售价不能小于 0' }, { status: 400, headers })
          }
          const bot = await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1', [input.bot_rid])
          if (!bot.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '机器人不存在' }, { status: 400, headers }) }
          let packagePic = ''
          if (actionName === 'update') {
            const current = await client.query('SELECT rid,package_pic FROM t_energy_platform_package WHERE rid=$1 FOR UPDATE', [input.rid])
            if (!current.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '套餐不存在' }, { status: 404, headers }) }
            packagePic = current.rows[0].package_pic || ''
          }
          if (upload) {
            try { stored = await saveMessageImage(upload); packagePic = stored.url }
            catch (error) { await client.query('ROLLBACK'); if (error instanceof BotServiceError) return Response.json({ message: error.message }, { status: error.status, headers }); throw error }
          }
          if (actionName === 'create') {
            const created = await client.query(`INSERT INTO t_energy_platform_package(bot_rid,package_type,package_name,energy_amount,energy_day,trx_price,agent_trx_price,seq_sn,callback_data,show_notes,create_time)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING rid`, [input.bot_rid, input.package_type, input.package_name, input.energy_amount, input.energy_day, input.trx_price, input.agent_trx_price, input.seq_sn, `energy_${randomUUID().replaceAll('-', '')}`, input.show_notes])
            resourceId = created.rows[0].rid; message = '能量套餐已添加'
          } else {
            const updated = await client.query(`UPDATE t_energy_platform_package SET bot_rid=$2,package_type=$3,package_name=$4,energy_amount=$5,energy_day=$6,
              trx_price=$7,agent_trx_price=$8,seq_sn=$9,show_notes=$10,package_pic=$11,update_time=now() WHERE rid=$1 RETURNING rid`, [input.rid, input.bot_rid, input.package_type, input.package_name, input.energy_amount, input.energy_day, input.trx_price, input.agent_trx_price, input.seq_sn, input.show_notes, packagePic])
            resourceId = updated.rows[0].rid; message = '能量套餐已更新'
          }
        } else if (actionName === 'status') {
          const input = z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict().parse(body)
          const updated = await client.query('UPDATE t_energy_platform_package SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, input.enabled ? 0 : 1])
          if (!updated.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '套餐不存在' }, { status: 404, headers }) }
          resourceId = input.rid; message = '套餐状态已更新'
        } else if (actionName === 'delete') {
          const input = z.object({ action: z.literal('delete'), rid: id }).strict().parse(body)
          const removed = await client.query('DELETE FROM t_energy_platform_package WHERE rid=$1 RETURNING rid', [input.rid])
          if (!removed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '套餐不存在' }, { status: 404, headers }) }
          resourceId = input.rid; message = '能量套餐已删除'
        } else if (actionName === 'batch-delete') {
          const input = z.object({ action: z.literal('batch-delete'), botRid: id }).strict().parse(body)
          const removed = await client.query('DELETE FROM t_energy_platform_package WHERE bot_rid=$1 RETURNING rid', [input.botRid])
          if (!removed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '该机器人没有能量套餐' }, { status: 404, headers }) }
          resourceId = removed.rows[0].rid; message = `已删除 ${removed.rowCount} 个套餐`
        } else {
          const input = z.object({ action: z.literal('copy'), sourceBotRid: id, targetBotRid: id }).strict().parse(body)
          if (input.sourceBotRid === input.targetBotRid) { await client.query('ROLLBACK'); return Response.json({ message: '覆盖机器人和来源机器人不能一致' }, { status: 400, headers }) }
          const bots = await client.query('SELECT rid FROM t_telegram_bot WHERE rid=ANY($1::int[]) ORDER BY rid FOR UPDATE', [[input.sourceBotRid, input.targetBotRid]])
          if (bots.rowCount !== 2) { await client.query('ROLLBACK'); return Response.json({ message: '来源或覆盖机器人不存在' }, { status: 404, headers }) }
          const source = await client.query('SELECT count(*)::int AS total FROM t_energy_platform_package WHERE bot_rid=$1', [input.sourceBotRid])
          if (!Number(source.rows[0].total)) { await client.query('ROLLBACK'); return Response.json({ message: '来源机器人无数据可复制' }, { status: 400, headers }) }
          await client.query('DELETE FROM t_energy_platform_package WHERE bot_rid=$1', [input.targetBotRid])
          const copied = await client.query(`INSERT INTO t_energy_platform_package(bot_rid,package_type,package_name,energy_amount,energy_day,trx_price,agent_trx_price,status,seq_sn,create_time,callback_data,show_notes,package_pic)
            SELECT $2,package_type,package_name,energy_amount,energy_day,trx_price,agent_trx_price,status,seq_sn,now(),'energy_'||md5(random()::text||clock_timestamp()::text),show_notes,package_pic
            FROM t_energy_platform_package WHERE bot_rid=$1 ORDER BY rid RETURNING rid`, [input.sourceBotRid, input.targetBotRid])
          resourceId = copied.rows[0]?.rid ?? null; message = `已复制 ${copied.rowCount} 个套餐，并覆盖目标机器人原套餐`
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, `energy.package.${actionName}`, resourceId])
        await client.query('COMMIT')
        stored = undefined
        return Response.json({ ok: true, message }, { headers })
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    } catch (error) {
      if (stored) await stored.remove()
      if (error instanceof BotServiceError) return Response.json({ message: error.message }, { status: error.status, headers })
      throw error
    }
  })
}
