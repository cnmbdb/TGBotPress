export function priceUnits(value) {
  const text = String(value ?? '').trim(), match = /^\d+(?:\.\d{1,2})?$/.exec(text)
  if (!match) return null
  const [whole, fraction = ''] = text.split('.')
  const units = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
  return units > 0n ? units : null
}
export function priceText(units) { return (units / 100n).toString() + '.' + (units % 100n).toString().padStart(2, '0') }
export function telegramPremiumStarPrice(months) {
  return ({ 3: 1000, 6: 1500, 12: 2500 })[Number(months)] ?? null
}

export const lifecycleBlockerSql = `SELECT (SELECT count(*) FROM t_premium_wallet_trade_list WHERE process_status=1)::int + (SELECT count(*) FROM t_premium_platform_order WHERE status IN (0,1,6))::int + (SELECT count(*) FROM t_platform_job_outbox WHERE task_name='sendpremiumtgmessage' AND status IN ('pending','processing'))::int AS count`

export const adminMenu = {
  id: '5',
  label: '会员管理',
  icon: 'Gem',
  items: [
    { id: 'admin.premium.platform.index', label: '会员平台', path: '/admin/premium/platform/index', consolePath: '/console/premium-platforms', permissions: ['会员管理', '会员平台'] },
    { id: 'admin.premium.package.index', label: '会员套餐', path: '/admin/premium/package/index', consolePath: '/console/premium-packages', permissions: ['会员管理', '会员套餐'] },
    { id: 'admin.premium.order.index', label: '会员订单', path: '/admin/premium/order/index', consolePath: '/console/premium-orders', permissions: ['会员管理', '会员订单'] },
    { id: 'admin.premium.trade.index', label: '会员交易', path: '/admin/premium/trade/index', consolePath: '/console/premium-trades', permissions: ['会员管理', '会员交易'] },
  ],
}

export const manifest = {
  id: 'premium',
  version: '0.1.0',
  hostRange: '>=1.0.0 <2.0.0',
  sdkVersion: '0.1.0',
  name: '会员管理',
  description: '会员平台、套餐、订单和自动开通',
  dependencies: [],
  menuRoutes: adminMenu.items.map(item => item.id),
  apiRoutes: ['/api/premium-platforms', '/api/premium-packages', '/api/premium-orders', '/api/premium-trades'],
  tasks: ['premiumwalletusdttrade', 'sendpremiumtgmessage', 'tgpremium'],
  drainTasks: ['sendpremiumtgmessage', 'tgpremium'],
  configTypes: ['command', 'keyreply', 'keyreply_keyboard'],
  lifecycleBlockerSql,
  adminMenu,
  automaticConfigLinks: {
    commands: { buypremium: ['premium'] },
    keyreplyOptions: { 4: ['premium'], 8: ['premium'] },
  },
}
export const plugin = { manifest }
