import { z } from 'zod'
import type { Pool, PoolClient } from 'pg'

export type CloneProxyIdentity = { id: string; name: string; roles: string[]; permissions: string[]; routes: string[] }
type LifecycleState = 'active' | 'draining' | 'uninstalled'
type LifecycleAction = 'disable' | 'resume' | 'uninstall' | 'install'
export type CloneProxyApiHost = {
  db: Pick<Pool, 'query' | 'connect'>
  identity: (request: Request) => Promise<CloneProxyIdentity>
  can: (user: CloneProxyIdentity, permission: string, route: string) => boolean
  run: (handler: () => Promise<Response>) => Promise<Response>
  getCloneProxyLifecycle: (pool: Pick<Pool, 'query'>) => Promise<LifecycleState>
  lockCloneProxyLifecycle: (client: PoolClient) => Promise<void>
  transitionCloneProxyLifecycle: (client: PoolClient, action: LifecycleAction) => Promise<LifecycleState>
}

/** Create a management API bound to host authentication, database and lifecycle services. */
export function createCloneProxyApi(services: CloneProxyApiHost) {
  const { db, identity, can, run, getCloneProxyLifecycle, lockCloneProxyLifecycle, transitionCloneProxyLifecycle } = services
const H = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const id = z.coerce.number().int().positive().max(2147483647)
const base = 'admin.telegram.cloneproxy'
const pagePermission = (user: Awaited<ReturnType<typeof identity>>, child: 'basic' | 'merchants') =>
  can(user, '克隆/代理', `${base}.${child}`) &&
  can(user, child === 'basic' ? '克隆/代理基础设置' : '克隆/代理商户管理', `${base}.${child}`)
const statusText = (status: unknown) => Number(status) === 1 ? '正常' : '已停用'
const webhookText = (status: unknown) => Number(status) === 1 ? '已注册' : Number(status) === 2 ? '注册失败' : '待处理'
const paymentText = (method: unknown) => ({ free: '免费', balance: '余额支付', chain: '链上支付', pending: '待支付' } as Record<string, string>)[String(method)] || String(method || '')
const orderStatusText = (type: string, status: unknown) => {
  const labels = type === 'opening'
    ? ['待支付', '待提交 token', '开户成功', '已取消', '已删除']
    : ['待结算', '处理中', '已结算', '已取消', '已删除']
  return labels[Number(status)] || '未知'
}
const maskToken = (value: unknown) => {
  const token = String(value || '')
  return !token ? '' : token.length <= 12 ? '*'.repeat(token.length) : token.slice(0, 8) + '…' + token.slice(-4)
}
const maskHash = (value: unknown) => {
  const hash = String(value || '')
  return hash.length > 16 ? hash.slice(0, 8) + '…' + hash.slice(-8) : hash
}
async function body(req: Request): Promise<{ value: unknown } | Response> {
  const raw = await req.text()
  if (raw.length > 32768) return Response.json({ message: '表单内容过长' }, { status: 413, headers: H })
  try { return { value: JSON.parse(raw) as unknown } } catch { return Response.json({ message: '表单内容无效' }, { status: 400, headers: H }) }
}

return function cloneProxyApi(req: Request) {
  return run(async () => {
    const user = await identity(req)
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || ''
    if (req.method === 'GET') {
      if (action === 'lifecycle') {
        if (!pagePermission(user, 'basic')) return Response.json({ message: '没有访问权限' }, { status: 403, headers: H })
        return Response.json({ state: await getCloneProxyLifecycle(db) }, { headers: H })
      }
      if (action === 'config' || action === 'options') {
        if (!pagePermission(user, 'basic')) return Response.json({ message: '没有访问权限' }, { status: 403, headers: H })
        const [configResult, botsResult] = await Promise.all([
          db.query('SELECT rid,master_bot_rid,is_enable,charge_enable,merchant_limit,open_price,default_revenue_ratio FROM t_telegram_clone_proxy_config ORDER BY rid LIMIT 1'),
          db.query('SELECT rid,bot_username,bot_firstname,recharge_wallet_addr FROM t_telegram_bot ORDER BY rid DESC'),
        ])
        const config = configResult.rows[0] || null
        const count = config ? await db.query('SELECT count(*)::int AS active_count FROM t_telegram_clone_proxy_merchant WHERE master_bot_rid=$1 AND status=1', [config.master_bot_rid]) : { rows: [{ active_count: 0 }] }
        const activeCount = Number(count.rows[0].active_count || 0), limit = Number(config?.merchant_limit || 0)
        return Response.json({
          config: config ? { ...config, active_count: activeCount, idle_quantity: limit > 0 ? Math.max(0, limit - activeCount) : null } : null,
          bots: botsResult.rows.map(({ recharge_wallet_addr, ...bot }) => ({ ...bot, recharge_wallet_configured: !!recharge_wallet_addr })),
        }, { headers: H })
      }
      if (!pagePermission(user, 'merchants')) return Response.json({ message: '没有访问权限' }, { status: 403, headers: H })
      if (action === 'merchants') {
        const q = z.object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
          keyword: z.string().trim().max(100).default(''),
        }).parse(Object.fromEntries(url.searchParams))
        const escaped = '%' + q.keyword.replace(/[!%_]/g, c => '!' + c) + '%'
        const where = `($1='%%' OR COALESCE(m.owner_tg_username,'') ILIKE $1 ESCAPE '!' OR CAST(m.owner_tg_uid AS TEXT) ILIKE $1 ESCAPE '!' OR COALESCE(b.bot_username,'') ILIKE $1 ESCAPE '!' OR COALESCE(m.owner_tg_name,'') ILIKE $1 ESCAPE '!')`
        const [count, rows] = await Promise.all([
          db.query(`SELECT count(*)::int AS total FROM t_telegram_clone_proxy_merchant m LEFT JOIN t_telegram_bot b ON b.rid=m.bot_rid WHERE ${where}`, [escaped]),
          db.query(`SELECT m.rid,m.owner_tg_uid,m.owner_tg_username,m.owner_tg_name,m.revenue_ratio,m.status,m.total_revenue_usdt,m.total_revenue_trx,m.webhook_status,to_char(m.create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,b.bot_username,b.bot_firstname
            FROM t_telegram_clone_proxy_merchant m LEFT JOIN t_telegram_bot b ON b.rid=m.bot_rid WHERE ${where} ORDER BY m.rid DESC LIMIT $2 OFFSET $3`,
          [escaped, q.pageSize, (q.page - 1) * q.pageSize]),
        ])
        return Response.json({
          rows: rows.rows.map((row, i) => ({
            ...row, serial: (q.page - 1) * q.pageSize + i + 1,
            owner_label: (row.owner_tg_username ? '@' + String(row.owner_tg_username).replace(/^@/, '') : '未设置用户名') + ' · HFTGID:' + row.owner_tg_uid,
            bot_label: row.bot_username ? '@' + String(row.bot_username).replace(/^@/, '') : '机器人 #' + row.rid,
            status_text: statusText(row.status), webhook_status_text: webhookText(row.webhook_status),
          })),
          total: count.rows[0].total, page: q.page, pageSize: q.pageSize,
          canEdit: true, canStatus: true, canDeleteOrders: true,
        }, { headers: H })
      }
      if (action === 'detail') {
        const rid = id.parse(url.searchParams.get('rid'))
        const found = await db.query(`SELECT m.*,b.bot_username,b.bot_firstname,b.bot_token,
          to_char(m.create_time,'YYYY-MM-DD HH24:MI:SS') AS created_at
          FROM t_telegram_clone_proxy_merchant m LEFT JOIN t_telegram_bot b ON b.rid=m.bot_rid WHERE m.rid=$1`, [rid])
        const merchant = found.rows[0]
        if (!merchant) return Response.json({ message: '商户不存在' }, { status: 404, headers: H })
        const masterUser = await db.query('SELECT cash_usdt,cash_trx FROM t_telegram_bot_user WHERE bot_rid=$1 AND tg_uid=$2 LIMIT 1', [merchant.master_bot_rid, merchant.owner_tg_uid])
        return Response.json({
          merchant: {
            rid: Number(merchant.rid), master_bot_rid: Number(merchant.master_bot_rid), bot_rid: Number(merchant.bot_rid),
            owner_tg_uid: String(merchant.owner_tg_uid), owner_tg_username: merchant.owner_tg_username, owner_tg_name: merchant.owner_tg_name,
            bot_username: merchant.bot_username, bot_firstname: merchant.bot_firstname, bot_token_masked: maskToken(merchant.bot_token),
            revenue_ratio: Number(merchant.revenue_ratio), status: Number(merchant.status), status_text: statusText(merchant.status),
            webhook_status: Number(merchant.webhook_status), webhook_status_text: webhookText(merchant.webhook_status), webhook_error: merchant.webhook_error,
            total_revenue_usdt: Number(merchant.total_revenue_usdt), total_revenue_trx: Number(merchant.total_revenue_trx),
            master_cash_usdt: Number(masterUser.rows[0]?.cash_usdt || 0), master_cash_trx: Number(masterUser.rows[0]?.cash_trx || 0), created_at: merchant.created_at,
          },
        }, { headers: H })
      }
      if (action === 'orders') {
        const q = z.object({
          rid: id, type: z.enum(['revenue', 'opening']).default('revenue'),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          pageSize: z.coerce.number().pipe(z.union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])).default(15),
        }).parse(Object.fromEntries(url.searchParams))
        const exists = await db.query('SELECT 1 FROM t_telegram_clone_proxy_merchant WHERE rid=$1', [q.rid])
        if (!exists.rowCount) return Response.json({ rows: [], total: 0, page: q.page, pageSize: q.pageSize }, { headers: H })
        const [count, result] = await Promise.all([
          db.query('SELECT count(*)::int AS total FROM t_telegram_clone_proxy_order WHERE merchant_rid=$1 AND order_type=$2 AND status<>4', [q.rid, q.type]),
          db.query(`SELECT rid,merchant_rid,master_bot_rid,bot_rid,order_type,source_type,source_order_rid,pay_user_tg_uid,pay_user_tg_username,amount,need_pay_amount,coin_name,payment_method,status,revenue_ratio,revenue_amount,external_order_rid,comments,to_char(create_time,'YYYY-MM-DD HH24:MI:SS') AS create_time,to_char(paid_time,'YYYY-MM-DD HH24:MI:SS') AS paid_time,to_char(expire_time,'YYYY-MM-DD HH24:MI:SS') AS expire_time,tx_hash
            FROM t_telegram_clone_proxy_order WHERE merchant_rid=$1 AND order_type=$2 AND status<>4 ORDER BY rid DESC LIMIT $3 OFFSET $4`,
          [q.rid, q.type, q.pageSize, (q.page - 1) * q.pageSize]),
        ])
        return Response.json({
          rows: result.rows.map((row, i) => {
            const { tx_hash, ...safe } = row
            return { ...safe, serial: (q.page - 1) * q.pageSize + i + 1, status_text: orderStatusText(q.type, row.status), payment_method_text: paymentText(row.payment_method), tx_hash_masked: maskHash(tx_hash) }
          }), total: count.rows[0].total, page: q.page, pageSize: q.pageSize,
        }, { headers: H })
      }
      return Response.json({ message: '未知请求' }, { status: 400, headers: H })
    }
    if (req.method !== 'POST') return Response.json({ message: '请求方法不支持' }, { status: 405, headers: H })
    const origin = process.env.PLATFORM_ORIGIN
    if (!origin || req.headers.get('origin') !== new URL(origin).origin || !req.headers.get('content-type')?.startsWith('application/json')) return Response.json({ message: '请求来源无效' }, { status: 403, headers: H })
    const parsedBody = await body(req)
    if (parsedBody instanceof Response) return parsedBody
    const raw = parsedBody.value
    const actionValue = z.object({ action: z.enum(['config_save', 'merchant_update', 'merchant_status', 'orders_soft_delete', 'lifecycle_disable', 'lifecycle_resume', 'lifecycle_uninstall', 'lifecycle_install']) }).parse(raw).action
    const canBasic = pagePermission(user, 'basic'), canMerchants = pagePermission(user, 'merchants')
    const basicAction = actionValue === 'config_save' || actionValue.startsWith('lifecycle_')
    if ((basicAction && !canBasic) || (!basicAction && !canMerchants)) return Response.json({ message: '没有操作权限' }, { status: 403, headers: H })
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await lockCloneProxyLifecycle(client)
      let message = ''
      if (actionValue === 'lifecycle_disable' || actionValue === 'lifecycle_resume' || actionValue === 'lifecycle_uninstall' || actionValue === 'lifecycle_install') {
        z.object({ action: z.literal(actionValue) }).strict().parse(raw)
        try {
          const target = actionValue === 'lifecycle_disable' ? 'disable' : actionValue === 'lifecycle_resume' ? 'resume' : actionValue === 'lifecycle_uninstall' ? 'uninstall' : 'install'
          const state = await transitionCloneProxyLifecycle(client, target)
          await client.query('COMMIT')
          const labels: Record<string, string> = { active: '插件已安装并启用', draining: '插件已停用，正在处理在途业务', uninstalled: '插件已安全卸载' }
          return Response.json({ ok: true, state, message: labels[state] }, { headers: H })
        } catch (error) {
          if (error instanceof Error && ['plugin_uninstalled','plugin_not_uninstalled','plugin_must_drain','plugin_has_outstanding_business'].includes(error.message)) {
            await client.query('ROLLBACK')
            return Response.json({ message: error.message }, { status: 409, headers: H })
          }
          throw error
        }
      } else if (actionValue === 'config_save') {
        const d = z.object({
          action: z.literal('config_save'), master_bot_rid: id, is_enable: z.boolean(), charge_enable: z.boolean(),
          open_price: z.coerce.number().finite().min(0).max(1000000000000),
          default_revenue_ratio: z.coerce.number().finite().min(0).max(150),
          merchant_limit: z.coerce.number().int().min(0).max(2147483647),
        }).strict().parse(raw)
        if (d.is_enable && await getCloneProxyLifecycle(client) !== 'active') {
          await client.query('ROLLBACK'); return Response.json({ message: '插件未启用，请先恢复插件' }, { status: 409, headers: H })
        }
        if (!(await client.query('SELECT 1 FROM t_telegram_bot WHERE rid=$1', [d.master_bot_rid])).rowCount) {
          await client.query('ROLLBACK'); return Response.json({ message: '请选择有效的主机器人' }, { status: 400, headers: H })
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cloneproxy-config:${d.master_bot_rid}`])
        const existing = await client.query('SELECT rid FROM t_telegram_clone_proxy_config WHERE master_bot_rid=$1 FOR UPDATE', [d.master_bot_rid])
        if (existing.rowCount) {
          await client.query('UPDATE t_telegram_clone_proxy_config SET is_enable=$2,charge_enable=$3,merchant_limit=$4,open_price=$5,default_revenue_ratio=$6,update_time=now() WHERE rid=$1',
            [existing.rows[0].rid, d.is_enable ? 1 : 0, d.charge_enable ? 1 : 0, d.merchant_limit, d.open_price, d.default_revenue_ratio])
        } else {
          await client.query('INSERT INTO t_telegram_clone_proxy_config(master_bot_rid,is_enable,charge_enable,merchant_limit,open_price,default_revenue_ratio,create_time,update_time) VALUES($1,$2,$3,$4,$5,$6,now(),now())',
            [d.master_bot_rid, d.is_enable ? 1 : 0, d.charge_enable ? 1 : 0, d.merchant_limit, d.open_price, d.default_revenue_ratio])
        }
        message = '基础设置已保存'
      } else if (actionValue === 'merchant_update') {
        const d = z.object({ action: z.literal('merchant_update'), rid: id, revenue_ratio: z.coerce.number().finite().min(0).max(150), status: z.enum(['1', '2']).optional() }).strict().parse(raw)
        const result = await client.query(`UPDATE t_telegram_clone_proxy_merchant SET revenue_ratio=$2,status=COALESCE($3,status),update_time=now() WHERE rid=$1 RETURNING rid`, [d.rid, d.revenue_ratio, d.status ? Number(d.status) : null])
        if (!result.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '商户不存在' }, { status: 404, headers: H }) }
        message = '商户设置已保存'
      } else if (actionValue === 'merchant_status') {
        const d = z.object({ action: z.literal('merchant_status'), rid: id, status: z.union([z.literal(1), z.literal(2)]) }).strict().parse(raw)
        const result = await client.query('UPDATE t_telegram_clone_proxy_merchant SET status=$2,update_time=now() WHERE rid=$1 RETURNING rid', [d.rid, d.status])
        if (!result.rowCount) { await client.query('ROLLBACK'); return Response.json({ message: '商户不存在' }, { status: 404, headers: H }) }
        message = d.status === 1 ? '商户已启用' : '商户已停用'
      } else {
        const d = z.object({ action: z.literal('orders_soft_delete'), rid: id, type: z.enum(['revenue', 'opening']), rids: z.array(id).min(1).max(500) }).strict().parse(raw)
        const result = await client.query(`UPDATE t_telegram_clone_proxy_order SET status=4,comments='后台批量删除（账本保留）',update_time=now()
          WHERE merchant_rid=$1 AND order_type=$2 AND rid=ANY($3::bigint[]) AND status<>4 RETURNING rid`, [d.rid, d.type, [...new Set(d.rids)]])
        message = `已软删除 ${result.rowCount || 0} 条订单`
      }
      await client.query('COMMIT')
      return Response.json({ ok: true, message }, { headers: H })
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally { client.release() }
  })
}

}
