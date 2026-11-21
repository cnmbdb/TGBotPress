export const manifest = {
  id: 'energy',
  version: '0.1.0',
  hostRange: '>=1.0.0 <2.0.0',
  sdkVersion: '0.1.0',
  name: '能量管理',
  description: '能量平台、订单和发放',
  dependencies: [],
  menuRoutes: ['admin.energy.platform.index','admin.energy.platformbot.index','admin.energy.package.index','admin.energy.order.index','admin.energy.quick.index','admin.energy.trade.index','admin.energy.aitrusteeship.index','admin.energy.aibishu.index','admin.energy.bindasendn.config'],
  apiRoutes: ['/api/energy-platforms','/api/energy-platform-bots','/api/energy-packages','/api/energy-orders','/api/energy-quick-orders','/api/energy-trades','/api/energy-ai-trusteeship','/api/energy-ai-bishu','/api/bindasendn'],
  tasks: ['energywalletinlisttrxusdt','monitorenergywallettrade','monitorenergywallettradelost','bishuwalletstop','getaitrusteeshipwalletresource','getaienergywalletresource','energyOrder','energyQuickOrder','handleaienergyorder','handleaienergybishu','recoveryenergy','getenergyplatformbalance','autoactivatebishu','handleenergyspecial','bindasendnusdt','sendenergytgmessage'],
  drainTasks: ['energyOrder','energyQuickOrder','handleaienergyorder','handleaienergybishu','recoveryenergy','sendenergytgmessage'],
  configTypes: ['command','keyreply','keyreply_keyboard'],
}
export const plugin = { manifest }
