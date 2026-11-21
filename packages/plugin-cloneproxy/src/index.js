export const manifest = {
  id: 'cloneproxy',
  version: '0.1.0',
  hostRange: '>=1.0.0 <2.0.0',
  sdkVersion: '0.1.0',
  name: '克隆/代理',
  description: '代理开户、商户和收益',
  dependencies: [],
  menuRoutes: ['admin.telegram.cloneproxy.basic', 'admin.telegram.cloneproxy.merchants'],
  apiRoutes: ['/api/cloneproxy'],
  tasks: ['synctelegramcloneproxyrevenue'],
  drainTasks: ['synctelegramcloneproxyrevenue'],
  configTypes: ['keyboard', 'keyreply', 'keyreply_keyboard'],
}

export const plugin = { manifest }
