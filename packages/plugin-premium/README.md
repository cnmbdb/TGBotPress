# @tgbotpress/plugin-premium

TGBotPress 的会员模块 npm 包。它导出会员模块 manifest、金额处理工具，以及可由宿主注入依赖的会员履约 worker。

```sh
npm install @tgbotpress/plugin-premium
```

该包内置 TGBotPress 插件及数据库接口类型，无需另行安装 `@tgbotpress/plugin-sdk`。后台页面使用宿主现有的 React、TanStack Query 和 UI runtime。

## 导出入口

```js
import { manifest, plugin, priceUnits, priceText } from '@tgbotpress/plugin-premium'
import { handleTelegramPremiumPackageCallback, handleTelegramPremiumUsernameReply } from '@tgbotpress/plugin-premium/purchases'
import { syncPremiumWalletUsdtTrades } from '@tgbotpress/plugin-premium/wallet-poll'
import { syncPremiumFulfillment } from '@tgbotpress/plugin-premium/fulfillment'
import { sendPremiumTelegramNotifications } from '@tgbotpress/plugin-premium/notifications'
import { createPremiumPlatformApi, createPremiumPackagesApi, createPremiumOrderApi, createPremiumTradeApi } from '@tgbotpress/plugin-premium/admin-api'
import { createPremiumScheduledTasks } from '@tgbotpress/plugin-premium/tasks'
import { createPremiumModuleRuntime } from '@tgbotpress/plugin-premium/server'
import { PremiumAdminProvider, PremiumPlatformsPage, PremiumPackagesPage, PremiumOrdersPage, PremiumTradesPage } from '@tgbotpress/plugin-premium/admin-pages'
```

- 根入口提供插件 manifest 和 USDT 金额转分工具。
- `./purchases` 处理 Telegram 套餐回调、用户名校验与查验、待支付订单创建、USDT 余额支付、未付款订单取消、重复更新幂等及支付回执通知。
- `./wallet-poll` 读取 TronGrid USDT 转入并幂等匹配待支付订单。
- `./fulfillment` 负责匹配 USDT 入账、领取待履约订单；支持 Fragment/TON 履约，以及预检机器人 Stars 余额后调用官方 `giftPremiumSubscription`。
- `./notifications` 排空会员订单的用户和管理员 Telegram 通知。
- `./admin-api` 提供会员平台、套餐、订单和入账交易管理 API；Stars 余额查询、价格规则、权限判断及订单操作均在包内，宿主显式注入身份、权限、数据库、加密和图片存储能力。
- `./tasks` 提供会员钱包轮询、订单通知和会员履约的任务定义与调度周期；宿主注入数据库、API key 读取、TON 执行/预检、密钥解密和功能开关。
- `./server` 的 `createPremiumModuleRuntime` 可在一个 Node 宿主 adapter 中组合管理 API、任务和 Telegram 更新处理器。
- `./admin-pages` 提供四个会员后台页面；宿主通过 `PremiumAdminProvider` 注入 API client、后台 shell 和基础 UI 组件，页面主体随 npm 包发布。
- Telegram 购买入口接收数据库连接和 Telegram fetcher；履约函数还接收平台密钥解密器、TON 预检和签名付款函数。npm 包不携带密钥或宿主数据库连接。
- Telegram Stars 履约按 3/6/12 个月固定消耗 1000/1500/2500 Stars；购买者仍按套餐配置支付 USDT，Stars 不替代订单收款。目标需要数值 Telegram 用户 ID，可从机器人已记录的用户名解析，或由购买者直接提交 ID。余额不足时已收款订单进入等待状态，机器人补充 Stars 后自动重试；外部调用结果不确定时订单进入人工核对，避免重复赠送。

## 宿主职责

TGBotPress 宿主仍负责 HTTP/TanStack 路由挂载、全局后台 UI shell、基础 UI 组件、TronGrid API key 配置读取、密钥加密存储、媒体文件保存、TON 命令执行和身份/权限提供。会员平台/套餐/订单/交易页面及 API、Telegram 购买、钱包轮询、履约、通知和任务定义由包内实现；宿主路由及任务调度器将插件能力接入宿主运行时。

会员平台、套餐、订单、钱包交易、Telegram 购买记录和 Stars 支付记录的 PostgreSQL 初始化/增量迁移都随包发布在 `migrations/postgres/`。宿主迁移器会读取仓库内插件包，以及宿主 `package.json` 明确声明的 `@tgbotpress/plugin-*` 依赖，并执行其 Postgres 迁移；不会扫描或执行未声明的 `node_modules` 包。宿主账号、机器人和会话表仍由平台核心提供。该接入按项目当前正式支持的 PostgreSQL 环境实现。

manifest 用于宿主的内置模块目录和状态管理。**安装 npm 包本身不会自动注册 TanStack 页面、HTTP 路由或启动后台任务**；这些路由与任务仍需宿主在构建/启动时挂载，动态加载和隔离能力仍有限。包发布、宿主集成和 ETS 市场展示分别验收。

## 宿主挂载示例

服务器只启用相关能力时，可通过包提供的工厂注册会员任务和管理 API：

```ts
import { createPremiumScheduledTasks } from '@tgbotpress/plugin-premium/tasks'
import { createPremiumPlatformApi } from '@tgbotpress/plugin-premium/admin-api'

const premiumTasks = createPremiumScheduledTasks({
  pool,
  logger,
  getWalletApiKeys: () => readTronGridKeys(pool),
  decryptSecret,
  runPayment: runTonPayment,
  preflight: checkTonWallet,
  walletPollingEnabled: true,
  telegramActionsEnabled: true,
  fulfillmentEnabled: true,
  allowTelegramStars: true,
})

const premiumPlatformApi = createPremiumPlatformApi(premiumHost)
```

若希望一次性组装模块运行入口，可以用 `createPremiumModuleRuntime({ adminHost, getWalletApiKeys, decryptSecret, runPayment, preflight, ... })`；它返回 `api`、`createTasks(pool, logger)` 和 `telegram` 处理器集合。若宿主需要拆分路由与任务 bundle，可按运行边界分别导入 `./admin-api`、`./purchases` 和 `./tasks`。

后台路由在宿主构建时挂载，页面主体通过 runtime 使用宿主的 shell、API client 和 UI 组件：

```tsx
import { PremiumAdminProvider, PremiumPlatformsPage } from '@tgbotpress/plugin-premium/admin-pages'

export function PremiumPlatformsRoute() {
  return <PremiumAdminProvider runtime={premiumAdminRuntime}>
    <PremiumPlatformsPage />
  </PremiumAdminProvider>
}
```

## 开发约定

业务 TypeScript 源文件位于 `src/*.source.ts`，页面源文件位于 `src/admin-pages.*.tsx`。运行 `npm run build` 会生成包导出的 ESM `*.js` 和类型声明 `*.d.ts`；运行 `npm run typecheck` 检查包内源文件。发布工作流执行这两个命令后再打包。宿主适配器应继续注入所有涉及密钥、数据库、API key 和支付的能力。

## 发布

发布前先更新 `package.json` 的版本号，并将代码合并到 `main`。随后从 `main` 为该版本创建并推送标签，例如 `plugin-premium-v0.1.0`。GitHub Actions 会校验标签版本和提交是否包含在 `main`，再使用仓库 Secret `NPM_TOKEN` 发布到 npm。手动运行发布 workflow 也只能从 `main` 触发，并且需要显式把 `publish` 确认为 `true`。
