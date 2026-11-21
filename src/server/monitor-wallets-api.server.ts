import { z } from 'zod'
import { can, identity, run } from './api.server'
import { db } from './db.server'
import { visibleNavigation } from '../lib/navigation'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const route = 'admin.monitor.wallet.index'
const id = z.coerce.number().int().positive().max(2_147_483_647)
const optionalBot = z.preprocess(v => v === '' || v === null || v === undefined ? null : Number(v), z.number().int().positive().max(2_147_483_647).nullable())
const amount = z.preprocess(v => v === '' || v === null || v === undefined ? '0' : String(v), z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/))
const flagPair = z.string().trim().regex(/^[YN]{2}$/u, '请选择两个事件开关').default('NN')
const usdtFlagPair = z.string().trim().regex(/^[YN]{2}$/u, '请选择两个事件开关').default('YY')
const permissions = {
  add: ['添加监控钱包', 'admin.monitor.wallet.add'],
  batchadd: ['批量添加监控', 'admin.monitor.wallet.batchadd'],
  update: ['修改监控钱包', 'admin.monitor.wallet.update'],
  delete: ['删除监控钱包', 'admin.monitor.wallet.delete'],
  status: ['修改监控钱包', 'admin.monitor.wallet.change_status'],
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

export function monitorWalletsApi(request: Request) {
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
      const input = z.object({
        page: z.coerce.number().int().min(1).max(1_000_000).default(1),
        pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        search: z.string().trim().max(200).default(''),
        bot: z.union([z.literal('all'), z.coerce.number().int().positive().max(2_147_483_647)]).default('all'),
      }).parse(Object.fromEntries(url.searchParams))
      const search = '%' + input.search.replace(/[!%_]/g, c => '!' + c) + '%'
      const bot = input.bot === 'all' ? null : input.bot
      const where = "($1::int IS NULL OR w.bot_rid=$1) AND ($2='%%' OR w.monitor_wallet ILIKE $2 ESCAPE '!' OR COALESCE(w.comments,'') ILIKE $2 ESCAPE '!' OR w.rid::text ILIKE $2 ESCAPE '!')"
      const [hasUsdtColumn, total] = await Promise.all([
        db.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='t_monitor_wallet' AND column_name='monitor_usdt_transaction') AS present"),
        db.query('SELECT count(*)::int AS total FROM t_monitor_wallet w WHERE ' + where, [bot, search]),
      ])
      const usdtExpression = hasUsdtColumn.rows[0]?.present ? 'w.monitor_usdt_transaction' : "'YY'::varchar"
      const rows = await db.query(
        'SELECT w.rid,w.bot_rid,b.bot_firstname,b.bot_username,(b.bot_token IS NOT NULL AND b.bot_token<>' + "''" + ') AS token_configured,w.chain_type,w.monitor_wallet,w.status,w.tg_notice_obj,w.balance_alert::text,w.balance_amount::text,w.monitor_trx_transaction,w.monitor_approve_transaction,w.monitor_multi_transaction,w.monitor_pledge_transaction,' + usdtExpression + ' AS monitor_usdt_transaction,w.comments,to_char(w.create_time,\'YYYY-MM-DD HH24:MI:SS\') AS create_time,to_char(w.update_time,\'YYYY-MM-DD HH24:MI:SS\') AS update_time FROM t_monitor_wallet w LEFT JOIN t_telegram_bot b ON b.rid=w.bot_rid WHERE ' + where + ' ORDER BY w.rid DESC LIMIT $3 OFFSET $4',
        [bot, search, input.pageSize, (input.page - 1) * input.pageSize],
      )
      return Response.json({
        rows: rows.rows,
        total: total.rows[0].total,
        page: input.page,
        pageSize: input.pageSize,
        permissions: {
          add: permitted(user, 'add'),
          batchadd: permitted(user, 'batchadd'),
          update: permitted(user, 'update'),
          delete: permitted(user, 'delete'),
          status: permitted(user, 'status'),
        },
      }, { headers })
    }

    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const origin = originFailure(request)
    if (origin) return origin
    const raw = await request.text()
    if (raw.length > 600_000) return Response.json({ message: '输入内容过长' }, { status: 413, headers })
    let body: unknown
    try { body = JSON.parse(raw) } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const action = z.object({ action: z.enum(['add', 'batchadd', 'update', 'delete', 'status']) }).parse(body).action
    if (!permitted(user, action)) return Response.json({ message: '没有操作权限' }, { status: 403, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      let rid: number | null = null
      let message = ''
      if (action === 'add' || action === 'update') {
        const schema = z.object({ action: z.enum(['add', 'update']), ...(action === 'update' ? { rid: id } : {}), bot_rid: optionalBot, chain_type: z.string().trim().min(1).max(10), monitor_wallet: z.string().trim().min(1).max(200), tg_notice_obj: z.string().trim().max(200).default(''), balance_alert: amount, monitor_usdt_transaction: usdtFlagPair, monitor_trx_transaction: flagPair, monitor_approve_transaction: flagPair, monitor_multi_transaction: flagPair, monitor_pledge_transaction: flagPair, comments: z.string().trim().max(100).default('') }).strict()
        const input = schema.parse(body)
        if (input.bot_rid !== null) {
          const bot = await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1', [input.bot_rid])
          if (!bot.rowCount) {
            await client.query('ROLLBACK')
            return Response.json({ message: '机器人不存在' }, { status: 404, headers })
          }
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtext('monitor-wallet:'||$1||':'||$2))", [input.chain_type, input.monitor_wallet])
        const duplicate = await client.query('SELECT rid FROM t_monitor_wallet WHERE monitor_wallet=$1 AND chain_type=$2 AND ($3::int IS NULL OR rid<>$3) LIMIT 1', [input.monitor_wallet, input.chain_type, action === 'update' ? input.rid : null])
        if (duplicate.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '该链类型下监控钱包已存在' }, { status: 409, headers })
        }
        const values = [input.bot_rid, input.chain_type, input.monitor_wallet, input.tg_notice_obj, input.balance_alert, input.monitor_usdt_transaction, input.monitor_trx_transaction, input.monitor_approve_transaction, input.monitor_multi_transaction, input.monitor_pledge_transaction, input.comments]
        if (action === 'add') {
          const created = await client.query('INSERT INTO t_monitor_wallet(bot_rid,chain_type,monitor_wallet,tg_notice_obj,balance_alert,monitor_usdt_transaction,monitor_trx_transaction,monitor_approve_transaction,monitor_multi_transaction,monitor_pledge_transaction,comments,status,create_time) VALUES($1,$2,$3,NULLIF($4,\'\'),$5,$6,$7,$8,$9,$10,$11,1,now()) RETURNING rid', values)
          rid = created.rows[0].rid
          message = '监控钱包已添加'
        } else {
          const updated = await client.query('UPDATE t_monitor_wallet SET bot_rid=$2,chain_type=$3,monitor_wallet=$4,tg_notice_obj=NULLIF($5,\'\'),balance_alert=$6,monitor_usdt_transaction=$7,monitor_trx_transaction=$8,monitor_approve_transaction=$9,monitor_multi_transaction=$10,monitor_pledge_transaction=$11,comments=$12,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, ...values])
          if (!updated.rowCount) {
            await client.query('ROLLBACK')
            return Response.json({ message: '监控钱包不存在' }, { status: 404, headers })
          }
          rid = updated.rows[0].rid as number
          message = '监控钱包已更新'
        }
      } else if (action === 'batchadd') {
        const input = z.object({ action: z.literal('batchadd'), bot_rid: optionalBot, chain_type: z.string().trim().min(1).max(10), monitor_wallet: z.string().max(500_000), tg_notice_obj: z.string().trim().max(200).default(''), balance_alert: amount }).strict().parse(body)
        if (input.bot_rid !== null && !(await client.query('SELECT rid FROM t_telegram_bot WHERE rid=$1', [input.bot_rid])).rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '机器人不存在' }, { status: 404, headers })
        }
        const entries: { address: string; comment: string }[] = []
        const seen = new Set<string>()
        for (const line of input.monitor_wallet.split(/\r?\n/u)) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const comma = trimmed.indexOf(',')
          const address = (comma < 0 ? trimmed : trimmed.slice(0, comma)).trim()
          const comment = (comma < 0 ? '' : trimmed.slice(comma + 1)).trim().slice(0, 100)
          if (!address || address.length > 200) {
            await client.query('ROLLBACK')
            return Response.json({ message: '每行请填写有效钱包地址（最多 200 个字符）' }, { status: 400, headers })
          }
          const key = input.chain_type + ':' + address
          if (seen.has(key)) continue
          seen.add(key)
          entries.push({ address, comment })
        }
        if (!entries.length) {
          await client.query('ROLLBACK')
          return Response.json({ message: '没有可导入的钱包地址' }, { status: 400, headers })
        }
        if (entries.length > 500) {
          await client.query('ROLLBACK')
          return Response.json({ message: '单次最多批量添加 500 个钱包' }, { status: 400, headers })
        }
        let added = 0
        let skipped = 0
        for (const entry of entries) {
          await client.query("SELECT pg_advisory_xact_lock(hashtext('monitor-wallet:'||$1||':'||$2))", [input.chain_type, entry.address])
          const duplicate = await client.query('SELECT rid FROM t_monitor_wallet WHERE monitor_wallet=$1 AND chain_type=$2 LIMIT 1', [entry.address, input.chain_type])
          if (duplicate.rowCount) { skipped++; continue }
          const inserted = await client.query('INSERT INTO t_monitor_wallet(bot_rid,chain_type,monitor_wallet,tg_notice_obj,balance_alert,comments,status,create_time) VALUES($1,$2,$3,NULLIF($4,\'\'),$5,$6,1,now()) RETURNING rid', [input.bot_rid, input.chain_type, entry.address, input.tg_notice_obj, input.balance_alert, entry.comment])
          rid = inserted.rows[0].rid
          added++
        }
        if (!added) {
          await client.query('ROLLBACK')
          return Response.json({ message: '没有新增记录，输入的钱包均已存在' }, { status: 409, headers })
        }
        message = '已添加 ' + added + ' 个钱包' + (skipped ? '，跳过重复 ' + skipped + ' 个' : '')
      } else if (action === 'status') {
        const input = z.object({ action: z.literal('status'), rid: id, enabled: z.boolean() }).strict().parse(body)
        const changed = await client.query('UPDATE t_monitor_wallet SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [input.rid, input.enabled ? 0 : 1])
        if (!changed.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '监控钱包不存在' }, { status: 404, headers })
        }
        rid = input.rid
        message = '监控状态已更新'
      } else {
        const input = z.object({ action: z.literal('delete'), rid: id }).strict().parse(body)
        const deleted = await client.query('DELETE FROM t_monitor_wallet WHERE rid=$1 RETURNING rid', [input.rid])
        if (!deleted.rowCount) {
          await client.query('ROLLBACK')
          return Response.json({ message: '监控钱包不存在' }, { status: 404, headers })
        }
        rid = input.rid
        message = '监控钱包已删除'
      }
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'monitor.wallet.' + action, rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })
}
