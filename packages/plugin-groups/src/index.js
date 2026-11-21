export const manifest = {
  id: 'groups', version: '0.1.0', hostRange: '>=1.0.0 <2.0.0', sdkVersion: '0.1.0',
  name: '群组管理', description: '群管中心、群组、用户、充值订单与交易；策略任务支持暂停、排空和恢复',
  dependencies: [],
  menuRoutes: ['admin.groupuser.moderation.index', 'admin.groupuser.group.index', 'admin.groupuser.user.index', 'admin.groupuser.rechargeorder.index', 'admin.groupuser.rechargetrade.index'],
  apiRoutes: ['/api/moderation', '/api/groups', '/api/users', '/api/recharge-orders', '/api/recharge-trades'],
  tasks: ['groupspluginmessages'], drainTasks: ['groupspluginmessages'],
}
export const plugin = { manifest }
