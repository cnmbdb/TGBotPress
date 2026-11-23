import { adminMenu as premiumAdminMenu } from '@tgbotpress/plugin-premium'
// Generated from the original Blade navigation and Laravel route collection.
// Keep names, order, paths and combined permission requirements aligned with the source.
export type AdminMenuItem = { id: string; label: string; path: string; permissions: string[] }
export type AdminMenuGroup = { id: string; label: string; icon: string; items: AdminMenuItem[] }
export const adminNavigation: AdminMenuGroup[] = [
  {
    "id": "dashboard",
    "label": "仪表盘",
    "icon": "LayoutDashboard",
    "items": [
      {
        "id": "admin.home",
        "label": "仪表盘",
        "path": "/admin/home",
        "permissions": []
      }
    ]
  },
  {
    "id": "1",
    "label": "机器人列表",
    "icon": "Bot",
    "items": [
      {
        "id": "admin.telegram.telegrambot.index",
        "label": "机器人列表",
        "path": "/admin/telegram/telegrambot/index",
        "permissions": [
          "机器人列表"
        ]
      },
      {
        "id": "admin.telegram.command.index",
        "label": "命令设置",
        "path": "/admin/telegram/command/index",
        "permissions": [
          "命令设置"
        ]
      },
      {
        "id": "admin.telegram.keyboard.index",
        "label": "键盘设置",
        "path": "/admin/telegram/keyboard/index",
        "permissions": [
          "键盘设置"
        ]
      },
      {
        "id": "admin.telegram.keyreply.index",
        "label": "关键字回复",
        "path": "/admin/telegram/keyreply/index",
        "permissions": [
          "关键字回复"
        ]
      },
      {
        "id": "admin.telegram.keyreplyboard.index",
        "label": "关键字键盘",
        "path": "/admin/telegram/keyreplyboard/index",
        "permissions": [
          "关键字键盘"
        ]
      },
      {
        "id": "admin.telegram.telegrambotad.index",
        "label": "定时广告",
        "path": "/admin/telegram/telegrambotad/index",
        "permissions": [
          "定时广告"
        ]
      },
      {
        "id": "admin.telegram.telegrambotadkeyboard.index",
        "label": "定时广告键盘",
        "path": "/admin/telegram/telegrambotadkeyboard/index",
        "permissions": [
          "定时广告键盘"
        ]
      }
    ]
  },
  {
    "id": "2",
    "label": "群组用户",
    "icon": "Network",
    "items": [
      {
        "id": "admin.groupuser.moderation.index",
        "label": "群管中心",
        "path": "/admin/groupuser/moderation/index",
        "permissions": [
          "群组用户"
        ]
      },
      {
        "id": "admin.groupuser.group.index",
        "label": "群组列表",
        "path": "/admin/groupuser/group/index",
        "permissions": [
          "群组用户",
          "群组列表"
        ]
      },
      {
        "id": "admin.groupuser.user.index",
        "label": "用户列表",
        "path": "/admin/groupuser/user/index",
        "permissions": [
          "群组用户",
          "用户列表"
        ]
      },
      {
        "id": "admin.groupuser.rechargeorder.index",
        "label": "充值订单",
        "path": "/admin/groupuser/rechargeorder/index",
        "permissions": [
          "群组用户",
          "充值订单"
        ]
      },
      {
        "id": "admin.groupuser.rechargetrade.index",
        "label": "充值交易",
        "path": "/admin/groupuser/rechargetrade/index",
        "permissions": [
          "群组用户",
          "充值交易"
        ]
      }
    ]
  },
  {
    "id": "3",
    "label": "闪兑钱包",
    "icon": "Wallet",
    "items": [
      {
        "id": "admin.transit.wallet.index",
        "label": "闪兑钱包",
        "path": "/admin/transit/wallet/index",
        "permissions": [
          "闪兑管理",
          "闪兑钱包"
        ]
      },
      {
        "id": "admin.transit.walletcoin.index",
        "label": "闪兑币种",
        "path": "/admin/transit/walletcoin/index",
        "permissions": [
          "闪兑管理",
          "闪兑币种"
        ]
      },
      {
        "id": "admin.transit.trade.index",
        "label": "闪兑交易",
        "path": "/admin/transit/trade/index",
        "permissions": [
          "闪兑管理",
          "闪兑交易"
        ]
      },
      {
        "id": "admin.transit.walletblack.index",
        "label": "闪兑黑钱包",
        "path": "/admin/transit/walletblack/index",
        "permissions": [
          "闪兑管理",
          "闪兑黑钱包"
        ]
      },
      {
        "id": "admin.transit.userwallet.index",
        "label": "闪兑用户",
        "path": "/admin/transit/userwallet/index",
        "permissions": [
          "闪兑管理",
          "闪兑用户"
        ]
      }
    ]
  },
  {
    "id": "4",
    "label": "能量管理",
    "icon": "Zap",
    "items": [
      {
        "id": "admin.energy.platform.index",
        "label": "能量平台",
        "path": "/admin/energy/platform/index",
        "permissions": [
          "能量管理",
          "能量平台"
        ]
      },
      {
        "id": "admin.energy.platformbot.index",
        "label": "机器人能量",
        "path": "/admin/energy/platformbot/index",
        "permissions": [
          "能量管理",
          "机器人能量"
        ]
      },
      {
        "id": "admin.energy.package.index",
        "label": "能量套餐",
        "path": "/admin/energy/package/index",
        "permissions": [
          "能量管理",
          "能量套餐"
        ]
      },
      {
        "id": "admin.energy.order.index",
        "label": "能量订单",
        "path": "/admin/energy/order/index",
        "permissions": [
          "能量管理",
          "能量订单"
        ]
      },
      {
        "id": "admin.energy.trade.index",
        "label": "钱包交易",
        "path": "/admin/energy/trade/index",
        "permissions": [
          "能量管理",
          "钱包交易"
        ]
      },
      {
        "id": "admin.energy.quick.index",
        "label": "快捷订单",
        "path": "/admin/energy/quick/index",
        "permissions": [
          "能量管理",
          "快捷订单"
        ]
      },
      {
        "id": "admin.energy.aitrusteeship.index",
        "label": "智能托管",
        "path": "/admin/energy/aitrusteeship/index",
        "permissions": [
          "能量管理",
          "智能托管"
        ]
      },
      {
        "id": "admin.energy.aibishu.index",
        "label": "笔数能量",
        "path": "/admin/energy/aibishu/index",
        "permissions": [
          "能量管理",
          "笔数能量"
        ]
      },
      {
        "id": "admin.energy.bindasendn.config",
        "label": "绑A送N",
        "path": "/admin/energy/bindasendn/config",
        "permissions": [
          "能量管理",
          "绑A送N"
        ]
      }
    ]
  },
  {
    "id": "6",
    "label": "监控管理",
    "icon": "CircleCheck",
    "items": [
      {
        "id": "admin.monitor.bot.index",
        "label": "机器人监控",
        "path": "/admin/monitor/bot/index",
        "permissions": [
          "监控管理",
          "机器人监控"
        ]
      },
      {
        "id": "admin.monitor.wallet.index",
        "label": "监控钱包",
        "path": "/admin/monitor/wallet/index",
        "permissions": [
          "监控管理",
          "监控钱包"
        ]
      }
    ]
  },
  {
    "id": "7",
    "label": "归集管理",
    "icon": "Inbox",
    "items": [
      {
        "id": "admin.collection.wallet.index",
        "label": "归集钱包",
        "path": "/admin/collection/wallet/index",
        "permissions": [
          "归集管理",
          "归集钱包"
        ]
      },
      {
        "id": "admin.collection.list.index",
        "label": "归集记录",
        "path": "/admin/collection/list/index",
        "permissions": [
          "归集管理",
          "归集记录"
        ]
      }
    ]
  },
  {
    "id": "8",
    "label": "商城管理",
    "icon": "ShoppingBag",
    "items": [
      {
        "id": "admin.shop.goods.index",
        "label": "商品管理",
        "path": "/admin/shop/goods/index",
        "permissions": [
          "商城管理",
          "商品管理"
        ]
      },
      {
        "id": "admin.shop.cdkey.index",
        "label": "卡密管理",
        "path": "/admin/shop/cdkey/index",
        "permissions": [
          "商城管理",
          "卡密管理"
        ]
      },
      {
        "id": "admin.shop.bot.index",
        "label": "机器人商品",
        "path": "/admin/shop/bot/index",
        "permissions": [
          "商城管理",
          "机器人商品"
        ]
      },
      {
        "id": "admin.shop.order.index",
        "label": "商品订单",
        "path": "/admin/shop/order/index",
        "permissions": [
          "商城管理",
          "商品订单"
        ]
      }
    ]
  },
  {
    "id": "9",
    "label": "克隆/代理",
    "icon": "GitFork",
    "items": [
      {
        "id": "admin.telegram.cloneproxy.basic",
        "label": "基础设置",
        "path": "/admin/telegram/cloneproxy/basic",
        "permissions": [
          "克隆/代理",
          "克隆/代理基础设置"
        ]
      },
      {
        "id": "admin.telegram.cloneproxy.merchants",
        "label": "商户管理",
        "path": "/admin/telegram/cloneproxy/merchants",
        "permissions": [
          "克隆/代理",
          "克隆/代理商户管理"
        ]
      }
    ]
  },
  {
    "id": "10",
    "label": "系统设置",
    "icon": "Settings",
    "items": [
      {
        "id": "admin.setting.config.index",
        "label": "配置信息",
        "path": "/admin/setting/config/index",
        "permissions": [
          "系统设置",
          "配置信息"
        ]
      },
      {
        "id": "admin.setting.app_version.index",
        "label": "版本更新",
        "path": "/admin/setting/version/index",
        "permissions": [
          "系统设置",
          "应用升级"
        ]
      },
      {
        "id": "admin.setting.security.index",
        "label": "安全设置",
        "path": "/admin/setting/security/index",
        "permissions": [
          "系统设置"
        ]
      }
    ]
  },
  {
    "id": "11",
    "label": "系统管理",
    "icon": "Shield",
    "items": [
      {
        "id": "admin.system.admin.index",
        "label": "管理员管理",
        "path": "/admin/system/admin/index",
        "permissions": [
          "系统管理",
          "管理员管理"
        ]
      },
      {
        "id": "admin.system.permission.index",
        "label": "权限设置",
        "path": "/admin/system/permission/index",
        "permissions": [
          "系统管理",
          "权限管理"
        ]
      },
      {
        "id": "admin.system.role.index",
        "label": "角色管理",
        "path": "/admin/system/role/index",
        "permissions": [
          "系统管理",
          "角色管理"
        ]
      }
    ]
  }
]

const premiumMenuIndex = adminNavigation.findIndex(group => group.id === '6')
adminNavigation.splice(premiumMenuIndex < 0 ? adminNavigation.length : premiumMenuIndex, 0, premiumAdminMenu)
