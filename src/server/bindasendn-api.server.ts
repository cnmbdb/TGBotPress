import { z } from 'zod'
import { can, identity, run, type Identity } from './api.server'
import { db } from './db.server'

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const pageRoute = 'admin.energy.bindasendn.config'
const pageAccess = (user: Identity) => can(user, '能量管理', pageRoute) && can(user, '绑A送N', pageRoute)
const canAction = (user: Identity, permission: string, action: string) =>
  can(user, permission, 'admin.energy.bindasendn.' + action)
const statusLabels: Record<number, string> = { 0: '待激活', 1: '已激活', 2: '已解绑', 3: '管理员禁用' }
const grantLabels: Record<number, string> = { 0: '处理中', 1: '成功', 2: '失败', 3: '转人工' }
const id = z.coerce.number().int().positive().max(2_147_483_647)
const pageSchema = z.coerce.number().int().min(1).max(1_000_000).default(1)
const pageSizeSchema = z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15)

function originError(request: Request) {
  const expected = process.env.PLATFORM_ORIGIN ? new URL(process.env.PLATFORM_ORIGIN).origin : ''
  if (!expected || request.headers.get('origin') !== expected) return Response.json({ message: '请求来源无效' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求格式无效' }, { status: 415, headers })
  return null
}
function escapedLike(value: string) {
  return '%' + value.replace(/[!%_]/g, character => '!' + character) + '%'
}
function configDefaults() {
  return {
    rid: null, is_enable: true, energy_per_send: 65000, activate_threshold: '0',
    daily_limit: 9999, monthly_limit: 9999, n_addr_daily_limit: 9999,
    audit_threshold: '0', audit_enabled: false, whitelist: '', blacklist: '',
    retry_count: 3, energy_platform_bot_rid: null,
  }
}
function configView(row: Record<string, unknown> | undefined) {
  if (!row) return configDefaults()
  return {
    rid: Number(row.rid), is_enable: Number(row.is_enable) === 1,
    energy_per_send: Number(row.energy_per_send), activate_threshold: String(row.activate_threshold ?? '0'),
    daily_limit: Number(row.daily_limit), monthly_limit: Number(row.monthly_limit),
    n_addr_daily_limit: Number(row.n_addr_daily_limit), audit_threshold: String(row.audit_threshold ?? '0'),
    audit_enabled: Number(row.audit_enabled) === 1, whitelist: String(row.whitelist ?? ''),
    blacklist: String(row.blacklist ?? ''), retry_count: Number(row.retry_count),
    energy_platform_bot_rid: row.energy_platform_bot_rid == null ? null : Number(row.energy_platform_bot_rid),
  }
}

export function bindASendNApi(request: Request) {
  return run(async () => {
    const user = await identity(request)
    if (!pageAccess(user)) return Response.json({ message: '没有访问权限' }, { status: 403, headers })

    if (request.method === 'GET') {
      const url = new URL(request.url)
      const view = url.searchParams.get('view') || 'config'
      if (view === 'config') {
        const [config, bots, instances] = await Promise.all([
          db.query('SELECT * FROM t_bind_a_send_n_config WHERE bot_rid IS NULL ORDER BY rid DESC LIMIT 1'),
          db.query('SELECT rid, bot_username, bot_firstname FROM t_telegram_bot ORDER BY rid DESC'),
          db.query('SELECT a.rid, a.bot_rid, b.bot_username, b.bot_firstname, a.receive_wallet FROM t_energy_platform_bot a LEFT JOIN t_telegram_bot b ON b.rid = a.bot_rid ORDER BY a.rid DESC'),
        ])
        return Response.json({
          config: configView(config.rows[0]),
          bots: bots.rows.map(row => ({ rid: Number(row.rid), bot_username: row.bot_username, bot_firstname: row.bot_firstname })),
          instances: instances.rows.map(row => ({ rid: Number(row.rid), bot_rid: row.bot_rid == null ? null : Number(row.bot_rid), bot_username: row.bot_username, bot_firstname: row.bot_firstname, receive_wallet: row.receive_wallet })),
          canSave: true,
        }, { headers })
      }
      const common = z.object({
        page: pageSchema, pageSize: pageSizeSchema,
        bot_rid: z.string().trim().max(12).default(''), status: z.string().trim().max(2).default(''),
      }).parse(Object.fromEntries(url.searchParams))
      const botRid = common.bot_rid ? id.parse(common.bot_rid) : null
      const clauses: string[] = []
      const values: unknown[] = []
      const add = (fragment: string, value: unknown) => {
        values.push(value)
        clauses.push(fragment.replace('?', '$' + values.length))
      }
      if (botRid) add('a.bot_rid = ?', botRid)
      if (view === 'bindings' && common.status !== '') add('a.status = ?', z.coerce.number().int().min(0).max(3).parse(common.status))
      if (view === 'grants' && common.status !== '') add('a.grant_status = ?', z.coerce.number().int().min(0).max(3).parse(common.status))
      if (view === 'bindings') {
        const input = z.object({
          tg_uid: z.string().trim().max(100).default(''), wallet_addr: z.string().trim().max(100).default(''),
        }).parse(Object.fromEntries(url.searchParams))
        if (input.tg_uid) add("a.tg_uid::text ILIKE ? ESCAPE '!'", escapedLike(input.tg_uid))
        if (input.wallet_addr) add("a.wallet_addr ILIKE ? ESCAPE '!'", escapedLike(input.wallet_addr))
        const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
        const count = await db.query('SELECT count(*)::int AS total FROM t_bind_a_send_n_binding a ' + where, values)
        const rows = await db.query(
          'SELECT a.rid,a.bot_rid,b.bot_username,b.bot_firstname,a.tg_uid::text AS tg_uid,a.wallet_addr,a.status,a.activate_threshold,' +
          'to_char(a.activate_time,\'YYYY-MM-DD HH24:MI:SS\') AS activate_time,to_char(a.create_time,\'YYYY-MM-DD HH24:MI:SS\') AS create_time,' +
          'to_char(a.unbind_time,\'YYYY-MM-DD HH24:MI:SS\') AS unbind_time,a.unbind_reason ' +
          'FROM t_bind_a_send_n_binding a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid ' + where +
          ' ORDER BY a.rid DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2),
          [...values, common.pageSize, (common.page - 1) * common.pageSize],
        )
        return Response.json({
          rows: rows.rows.map(row => ({ ...row, rid: Number(row.rid), bot_rid: Number(row.bot_rid), status: Number(row.status), status_label: statusLabels[Number(row.status)] || '未知状态' })),
          total: Number(count.rows[0].total), page: common.page, pageSize: common.pageSize,
          bots: (await db.query('SELECT rid,bot_username,bot_firstname FROM t_telegram_bot ORDER BY rid DESC')).rows.map(row => ({ ...row, rid: Number(row.rid) })),
          canActivate: canAction(user, '激活绑A送N', 'bindingActivate'),
          canUnbind: canAction(user, '解绑绑A送N', 'bindingUnbind'),
        }, { headers })
      }
      if (view === 'grants') {
        const input = z.object({
          n_addr: z.string().trim().max(100).default(''), a_addr: z.string().trim().max(100).default(''),
          tx_hash: z.string().trim().max(200).default(''), date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default(''),
          date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).default(''),
        }).parse(Object.fromEntries(url.searchParams))
        if (input.a_addr) add("a.a_addr ILIKE ? ESCAPE '!'", escapedLike(input.a_addr))
        if (input.n_addr) add("a.n_addr ILIKE ? ESCAPE '!'", escapedLike(input.n_addr))
        if (input.tx_hash) add("a.tx_hash ILIKE ? ESCAPE '!'", escapedLike(input.tx_hash))
        if (input.date_start) add('a.grant_time >= ?::date', input.date_start)
        if (input.date_end) add('a.grant_time < (?::date + interval \'1 day\')', input.date_end)
        const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
        const count = await db.query('SELECT count(*)::int AS total FROM t_bind_a_send_n_grant a ' + where, values)
        const rows = await db.query(
          'SELECT a.rid,a.binding_rid,a.bot_rid,b.bot_username,b.bot_firstname,a.tg_uid::text AS tg_uid,a.a_addr,a.n_addr,a.tx_hash,a.energy_amount,a.grant_status,a.audit_status,a.retry_count,a.fail_reason,' +
          'to_char(a.grant_time,\'YYYY-MM-DD HH24:MI:SS\') AS grant_time,to_char(a.create_time,\'YYYY-MM-DD HH24:MI:SS\') AS create_time ' +
          'FROM t_bind_a_send_n_grant a LEFT JOIN t_telegram_bot b ON b.rid=a.bot_rid ' + where +
          ' ORDER BY a.rid DESC LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2),
          [...values, common.pageSize, (common.page - 1) * common.pageSize],
        )
        return Response.json({
          rows: rows.rows.map(row => ({ ...row, rid: Number(row.rid), bot_rid: Number(row.bot_rid), binding_rid: Number(row.binding_rid), energy_amount: Number(row.energy_amount), grant_status: Number(row.grant_status), audit_status: Number(row.audit_status), retry_count: Number(row.retry_count), grant_status_label: grantLabels[Number(row.grant_status)] || '未知状态' })),
          total: Number(count.rows[0].total), page: common.page, pageSize: common.pageSize,
          bots: (await db.query('SELECT rid,bot_username,bot_firstname FROM t_telegram_bot ORDER BY rid DESC')).rows.map(row => ({ ...row, rid: Number(row.rid) })),
          canRetry: canAction(user, '重试绑A送N发放', 'grantRetry'),
          canReview: canAction(user, '重试绑A送N发放', 'grantRetry'),
        }, { headers })
      }
      return Response.json({ message: '未知记录类型' }, { status: 400, headers })
    }

    if (request.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers })
    const rejected = originError(request)
    if (rejected) return rejected
    let raw: unknown
    try { raw = await request.json() } catch { return Response.json({ message: '请求内容无效' }, { status: 400, headers }) }
    const payload = z.discriminatedUnion('action', [
      z.object({
        action: z.literal('configSave'), is_enable: z.boolean(), energy_per_send: z.coerce.number().int().min(1).max(1_000_000),
        activate_threshold: z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
        daily_limit: z.coerce.number().int().min(0).max(2_147_483_647),
        monthly_limit: z.coerce.number().int().min(0).max(2_147_483_647),
        n_addr_daily_limit: z.coerce.number().int().min(0).max(2_147_483_647),
        audit_enabled: z.boolean(), audit_threshold: z.string().trim().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
        whitelist: z.string().max(20_000), blacklist: z.string().max(20_000),
        retry_count: z.coerce.number().int().min(0).max(99), energy_platform_bot_rid: z.union([id, z.null()]),
      }).strict(),
      z.object({ action: z.literal('bindingActivate'), rid: id }).strict(),
      z.object({ action: z.literal('bindingUnbind'), rid: id, reason: z.string().trim().max(500).default('管理员解绑') }).strict(),
      z.object({ action: z.literal('grantRetry'), rid: id }).strict(),
      z.object({ action: z.literal('grantApprove'), rid: id }).strict(),
      z.object({ action: z.literal('grantReject'), rid: id }).strict(),
    ]).parse(raw)
    if (payload.action === 'configSave' && !can(user, '绑A送N', pageRoute)) return Response.json({ message: '没有配置权限' }, { status: 403, headers })
    if (payload.action === 'bindingActivate' && !canAction(user, '激活绑A送N', 'bindingActivate')) return Response.json({ message: '没有激活权限' }, { status: 403, headers })
    if (payload.action === 'bindingUnbind' && !canAction(user, '解绑绑A送N', 'bindingUnbind')) return Response.json({ message: '没有解绑权限' }, { status: 403, headers })
    if ((payload.action === 'grantRetry' || payload.action === 'grantApprove' || payload.action === 'grantReject') && !canAction(user, '重试绑A送N发放', 'grantRetry')) return Response.json({ message: '没有发放管理权限' }, { status: 403, headers })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      if (payload.action === 'configSave') {
        if (payload.energy_platform_bot_rid !== null) {
          const instance = await client.query('SELECT rid FROM t_energy_platform_bot WHERE rid=$1', [payload.energy_platform_bot_rid])
          if (!instance.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '能量实例不存在' }, { status: 404, headers }) }
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', ['bindasendn-global-config'])
        const current = await client.query('SELECT rid FROM t_bind_a_send_n_config WHERE bot_rid IS NULL ORDER BY rid DESC LIMIT 1 FOR UPDATE')
        const data = payload
        if (current.rowCount) {
          await client.query(
            'UPDATE t_bind_a_send_n_config SET is_enable=$2,energy_per_send=$3,activate_threshold=$4,daily_limit=$5,monthly_limit=$6,n_addr_daily_limit=$7,audit_threshold=$8,audit_enabled=$9,whitelist=$10,blacklist=$11,retry_count=$12,energy_platform_bot_rid=$13,update_by=$14,update_time=now() WHERE rid=$1',
            [current.rows[0].rid, Number(data.is_enable), data.energy_per_send, data.activate_threshold, data.daily_limit, data.monthly_limit, data.n_addr_daily_limit, data.audit_threshold, Number(data.audit_enabled), data.whitelist, data.blacklist, data.retry_count, data.energy_platform_bot_rid, Number(user.id)],
          )
        } else {
          await client.query(
            'INSERT INTO t_bind_a_send_n_config(bot_rid,is_enable,energy_per_send,activate_threshold,daily_limit,monthly_limit,n_addr_daily_limit,audit_threshold,audit_enabled,whitelist,blacklist,retry_count,energy_platform_bot_rid,create_by,create_time,update_by,update_time) ' +
            'VALUES(NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$13,now())',
            [Number(data.is_enable), data.energy_per_send, data.activate_threshold, data.daily_limit, data.monthly_limit, data.n_addr_daily_limit, data.audit_threshold, Number(data.audit_enabled), data.whitelist, data.blacklist, data.retry_count, data.energy_platform_bot_rid, Number(user.id)],
          )
        }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'energy.bindasendn.config.update', current.rows[0]?.rid ?? null])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '配置已保存' }, { headers })
      }
      if (payload.action === 'bindingActivate') {
        const changed = await client.query(
          'UPDATE t_bind_a_send_n_binding SET status=1,activate_time=now(),activated_by=$2,update_by=$2,update_time=now() WHERE rid=$1 AND status=0 RETURNING rid',
          [payload.rid, Number(user.id)],
        )
        if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '记录不存在或状态不是待激活' }, { status: 409, headers }) }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'energy.bindasendn.binding.activate', payload.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '绑定已激活' }, { headers })
      }
      if (payload.action === 'bindingUnbind') {
        const changed = await client.query(
          'UPDATE t_bind_a_send_n_binding SET status=2,unbind_time=now(),unbind_by=$2,unbind_reason=$3,update_by=$2,update_time=now() WHERE rid=$1 AND status IN (0,1) RETURNING rid',
          [payload.rid, Number(user.id), payload.reason || '管理员解绑'],
        )
        if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '记录不存在或已解绑' }, { status: 409, headers }) }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'energy.bindasendn.binding.unbind', payload.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '绑定已解绑' }, { headers })
      }
      if (payload.action === 'grantApprove') {
        const changed = await client.query(
          'UPDATE t_bind_a_send_n_grant SET audit_status=2,grant_status=0,retry_count=0,fail_reason=NULL,update_time=now() WHERE rid=$1 AND audit_status=1 AND grant_status=0 RETURNING rid',
          [payload.rid],
        )
        if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '记录不存在或审核状态已变化' }, { status: 409, headers }) }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'energy.bindasendn.grant.approve', payload.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '审核已通过，发放任务已排队' }, { headers })
      }
      if (payload.action === 'grantReject') {
        const changed = await client.query(
          "UPDATE t_bind_a_send_n_grant SET audit_status=3,grant_status=2,fail_reason='管理员拒绝审核',update_time=now() WHERE rid=$1 AND audit_status=1 AND grant_status=0 RETURNING rid",
          [payload.rid],
        )
        if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '记录不存在或审核状态已变化' }, { status: 409, headers }) }
        await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'energy.bindasendn.grant.reject', payload.rid])
        await client.query('COMMIT')
        return Response.json({ ok: true, message: '审核已拒绝' }, { headers })
      }
      const changed = await client.query(
        'UPDATE t_bind_a_send_n_grant SET grant_status=0,retry_count=0,fail_reason=NULL,update_time=now() WHERE rid=$1 AND grant_status=2 AND audit_status IN (0,2) RETURNING rid',
        [payload.rid],
      )
      if (!changed.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '记录不存在、状态不是失败，或审核状态不允许重试' }, { status: 409, headers }) }
      await client.query('INSERT INTO t_platform_audit_log(admin_id,action,resource_id) VALUES($1,$2,$3)', [user.id, 'energy.bindasendn.grant.retry', payload.rid])
      await client.query('COMMIT')
      return Response.json({ ok: true, message: '重试任务已排队，后台 job 将继续处理' }, { headers })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })
}
