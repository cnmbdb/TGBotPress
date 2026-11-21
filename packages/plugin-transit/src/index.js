export const manifest = {
  id: 'transit',
  version: '0.1.0',
  hostRange: '>=1.0.0 <2.0.0',
  sdkVersion: '0.1.0',
  name: '闪兑钱包',
  description: '兑换钱包、订单和交易',
  dependencies: [],
  menuRoutes: ['admin.transit.wallet.index', 'admin.transit.walletcoin.index', 'admin.transit.walletblack.index', 'admin.transit.userwallet.index', 'admin.transit.trade.index'],
  apiRoutes: ['/api/transit-wallet', '/api/transit-walletcoins', '/api/transit-walletblack', '/api/transit-userwallet', '/api/transit-trades'],
  tasks: ['getoktrealtimerate', 'transitwalletusdttrade', 'sendtransittgmessage', 'shanduiBonus'],
  drainTasks: ['getoktrealtimerate', 'transitwalletusdttrade', 'sendtransittgmessage', 'shanduiBonus'],
  configTypes: ['command', 'keyreply', 'keyreply_keyboard'],
}
export const plugin = { manifest }
