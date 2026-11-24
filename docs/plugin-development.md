# TGBotPress 插件开发文档

本文介绍 TGBotPress 插件的开发与集成。路径均相对仓库根目录；具体接口以源码和测试为准。

## 当前能力与边界

TGBotPress 提供八个内置插件和符合 SDK 契约的第三方 npm 插件安装入口。超级管理员在“插件管理”输入公开 npm 包的固定版本后，宿主先显示插件信息、兼容范围、依赖和申请权限，管理员确认后才执行安装。安装器校验 npm 元数据中的 `tgbotpressPlugin` 清单，下载并校验 tarball 完整性；解包后再校验包内 `tgbotpress.plugin.json` 与 `dist` 入口导出的 manifest 一致，之后安装依赖并启动运行时注册。当前动态能力包括服务端 HTTP 路由、周期任务、Telegram 更新处理和按 Bot 隔离的插件存储；每个插件单独记录 Telegram Update 投递结果，单个 handler 报错不会阻止其他插件收件，重试时跳过已成功投递的插件。进程内注册表最多缓存 1 秒，任务下次执行时间和生命周期租约持久化在平台数据库中，worker 或 Web 进程重启后会按状态重新加载。

- 第三方包需要发布 `tgbotpress.plugin.json`，并在 npm `package.json` 的 `tgbotpressPlugin` 字段镜像相同清单，以便安装前读取 ID。入口由 `entry` 指定，通常为已编译的 `./dist/index.js`，并导出 `plugin`（或 default）。清单 ID 支持如 `example.welcome` 的命名空间形式，必须唯一且不能占用内置 ID；npm 包名不限于 `@tgbotpress` scope。
- 动态 HTTP 路由经 `/api/plugin-runtime?plugin=<plugin-id>&path=<plugin-route-path>` 统一调度；该入口要求已登录，插件仍应根据注入的用户角色执行业务授权。插件页面和菜单目前不支持动态挂载，需由宿主前端静态集成。
- Telegram 插件事件由宿主轮询或 Webhook 入口送入持久化 inbox；启用前须配置 `PLATFORM_TELEGRAM_ACTIONS=true`、`PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY=true`，使用内置轮询还须设置 `PLATFORM_TELEGRAM_POLLING_ENABLED=true`。
- 第三方插件代码在宿主 Node.js 进程中执行，权限字段用于限制宿主提供的注册能力，不构成操作系统级沙箱。只有超级管理员可安装、启停和卸载；只接受固定 SemVer 版本，不执行 npm 生命周期脚本。
- npm 包为平台级安装，Bot 级启用默认关闭；在插件卡片“按机器人启停”中单独选择 Bot。停用某个 Bot 后，宿主不再向该实例投递 Telegram 更新或提供该 Bot 的 Telegram API Token，其他 Bot 实例不受影响。
- 当前第三方安装、存储和任务调度迁移只覆盖 PostgreSQL；MySQL、SQLite 和 D1 暂不开放第三方动态安装。Web/Worker 进程需要能访问同一插件目录；多容器部署要将该目录挂载到共享存储。
- 安装记录、任务租约、插件存储和路由/Telegram 注册由平台数据库支撑。见 `src/plugins/third-party-runtime.server.ts`。
- 市场提交是向 ETS 提交插件名称、介绍、npm 包和可选图片，并不等同于发布 npm 包或完成安装验证。提交需要超级管理员及有效 ETS 登录；外部服务是否接受以上架接口实际结果为准。见 `src/server/plugin-market-api.server.ts`。

第三方插件代码具有执行宿主进程权限的风险；`--ignore-scripts` 和 manifest 声明不能代替隔离。不要将凭据放进插件包、前端或日志。

## SDK 与插件结构

SDK 类型位于 `packages/plugin-sdk/src/index.d.ts`。插件通常是 ESM npm 包，使用 `package.json` 的 `exports` 显式暴露 JavaScript 和类型入口。参照 `packages/plugin-cloneproxy` 与 `packages/plugin-groups`。

根入口需要以 SDK 提供的 host 注册能力声明插件：

```js
export const manifest = {
  schemaVersion: 1,
  id: 'example',
  version: '0.1.0',
  apiVersion: 1,
  hostRange: '>=1.0.0 <2.0.0',
  sdkRange: '^0.1.0',
  runtime: { node: '>=22' },
  entry: './dist/index.js',
  name: '示例插件',
  description: '示例第三方插件',
  permissions: ['admin.api', 'plugin.jobs.register', 'plugin.storage.read', 'plugin.storage.write'],
}

export const plugin = {
  manifest,
  activate(host) {
    host.registerRoute({ method: 'GET', path: '/hello', handler: ({ user }) => Response.json({ hello: user.id }) })
    host.registerTask({ id: 'refresh', intervalMs: 60_000, run: async ({ shouldContinue }) => { if (shouldContinue()) host.log.info('refresh') } })
  },
}
```

外部清单必填 `schemaVersion`、`id`、`name`、`version`、`apiVersion: 1`、`hostRange`、`sdkRange`、`runtime.node`、`entry` 和 `permissions`。`tgbotpress.plugin.json` 与 `plugin.manifest` 必须完全一致。建议使用细粒度权限，如 `telegram.updates.read`、`telegram.messages.send`、`plugin.storage.read`、`plugin.storage.write`、`plugin.jobs.register` 和 `admin.api`；旧版 `http`、`tasks`、`storage`、`telegram` 是兼容别名。事件 handler 收到 `{botId, update, telegram, storage}`，`storage` 绑定当前 Bot；后台任务收到当前启用的 `botIds`，也可用 `host.storage.forBot(botId)` 选择作用域。`telegram.call(method, payload)` 使用当前事件机器人的凭据代为请求 Bot API，不会向插件返回 Bot Token；宿主每次代调都会检查插件和该 Bot 实例仍处于启用状态。handler 返回 `true` 表示已处理该事件。插件通过 `activate(host)` 注册能力，可选实现 `deactivate()`。任务周期限制为 1 秒至 24 小时；标记 `drain: true` 的任务可在停用排空阶段继续运行。

将相同 manifest 写入 npm 包根的 `tgbotpress.plugin.json`，并镜像到 `package.json` 的 `tgbotpressPlugin` 字段，供安装器在运行代码前确定 plugin ID：

```json
{
  "name": "@example/tgbotpress-plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "files": ["dist", "tgbotpress.plugin.json"],
  "tgbotpressPlugin": {
    "schemaVersion": 1,
    "id": "example",
    "name": "示例插件",
    "version": "0.1.0",
    "apiVersion": 1,
    "hostRange": ">=1.0.0 <2.0.0",
    "sdkRange": "^0.1.0",
    "runtime": { "node": ">=22" },
    "entry": "./dist/index.js",
    "permissions": ["admin.api", "plugin.jobs.register", "plugin.storage.read", "plugin.storage.write"]
  }
}
```

### 内置会员 npm 包

`packages/plugin-premium` 是会员模块的 npm 包示例。它导出 manifest、Telegram 套餐购买及订单回调、USDT 钱包轮询、Fragment/TON 与 Telegram Stars 履约、会员通知、后台 API、后台页面组件和 `./tasks` 调度任务定义。Stars 开通使用 Bot API 的 `giftPremiumSubscription`；官方接口只接受目标用户的数值 `user_id`，机器人履约成本固定为 3/6/12 个月 1000/1500/2500 Stars，购买者仍按套餐设置支付 USDT。宿主通过适配器注入数据库、身份/权限、密钥解密、TON 签名器、API key 和媒体存储等能力。页面主体由包提供；TanStack 路由仍需宿主在构建时挂载，并注入后台 shell 与 UI 组件。会员专属 PostgreSQL 表及增量迁移放在包的 `migrations/postgres/`，宿主账号、机器人和会话表仍由平台核心拥有；迁移器只发现仓库内插件和宿主 `package.json` 明确声明的 `@tgbotpress/plugin-*` 依赖。包内服务端 TypeScript 源文件以 `*.source.ts` 保存，后台页面以 `admin-pages.*.tsx` 保存；使用 `npm run build` 生成发布用的 ESM `*.js` 和类型声明 `*.d.ts`，使用 `npm run typecheck` 检查包源码。

订单/交易/平台/套餐 API 由宿主静态路由转接到会员插件包；这是兼容既有会员功能的专用集成。会员后台页面组件由包提供，宿主静态路由负责挂载并注入 shell/UI runtime。符合通用第三方 SDK 契约的 HTTP 路由、任务、Telegram handler 和存储则由动态运行时注册；后台菜单和页面仍需静态挂载。

npm 依赖写在包的 `dependencies`；宿主会在插件版本目录中使用 `--ignore-scripts` 安装运行时依赖，并生成独立 `package-lock.json`，不同插件的依赖不会共用可变目录。通过 SDK 注册接口使用宿主能力，避免直接依赖宿主私有源码。涉及数据库、鉴权、Telegram 和外部服务时，先明确接口与数据归属。

## 开发与集成流程

1. 从 `src/plugins/catalog.ts` 和 `src/plugins/registry.server.ts` 确定模块及接入点，追踪页面、API、权限、worker、Telegram 更新、数据库表和测试。内置模块参考 `packages/plugin-*`。
2. 在插件包内实现功能，定义公开入口和类型，并通过宿主适配器接入。插件包执行 `npm run build` 生成提交的 JavaScript 和声明文件，再执行 `npm run typecheck` 检查源码。
3. 声明所需权限，并在 `activate(host)` 注册 HTTP、任务或 Telegram handler。HTTP handler 从上下文取得登录用户，并自行校验业务权限。管理 UI 菜单仍需核心项目静态接入。
4. 在隔离数据库和模拟外部服务中验证正常、失败、重复执行和并发路径。支付、钱包和订单要保留事务、幂等与恢复语义。
5. 在插件目录执行 `npm pack --dry-run` 检查入口文件、依赖和 `tgbotpressPlugin` 元数据；发布固定版本后，在后台输入 `npm install <package>@<version>` 安装，并验证动态路由、worker 任务、Telegram 更新、停用排空、恢复和卸载。

## 生命周期与数据

`active` 允许新业务；`draining` 停止不应继续接收的新业务，同时按模块约定处理在途任务；`uninstalled` 表示逻辑卸载，不等于删除数据或代码。操作及状态转换见 `src/plugins/lifecycle-policy.ts` 和各模块生命周期实现。

卸载前应检查依赖、运行任务及未完成业务。默认保留业务数据；删除数据需要单独设计。涉及收益、支付或链上任务的插件，还需明确停用后谁负责处理已有义务。

## 提交市场展示

在管理后台的插件市场使用“公开上架模块插件”，先登录 ETS，再填写插件名称、详情、npm 安装命令和可选图片。当前表单接受 `npm install` 或 `npm i` 加包名及可选的完整版本号；图片支持 PNG、JPEG、WebP，最大 200 KB。提交成功表示 ETS 接受展示信息，不代表 npm 包已发布、宿主已支持该插件或安装已验证。

发布包前应检查版本、包内容、依赖、来源及安装权限；远程发布和实际安装分别验收。市场服务和审核规则以 ETS 实际情况为准。

## 验收清单

- 验证启用、停用、恢复、卸载及在途任务，检查依赖和数据保留。
- 验证权限、直接访问 API、不同账号的导航，以及机器人配置的共享和人工选择。
- 验证重复操作、失败重试、并发、重启和回滚；涉及外部服务时检查实际结果。
- 分别记录本地打包、干净项目导入、宿主集成、远程发布、市场上架和真实安装的结果及未覆盖项。

## 创建插件包：目录与导出示例

建议在隔离目录开始开发，并用独立 ID 区分已有模块。以下包结构是开发示例，不会被宿主自动发现：

```text
plugin-example/
├── package.json
├── tgbotpress.plugin.json
└── src/
    ├── index.js
└── dist/
    ├── index.js
    └── index.d.ts
```

`package.json` 的最小形式：

```json
{
  "name": "@example/plugin-example",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "tgbotpress.plugin.json"],
  "tgbotpressPlugin": { "schemaVersion": 1, "id": "example", "name": "示例插件", "version": "0.1.0", "apiVersion": 1, "hostRange": ">=1.0.0 <2.0.0", "sdkRange": "^0.1.0", "runtime": { "node": ">=22" }, "entry": "./dist/index.js", "permissions": [] }
}
```

在 `tgbotpress.plugin.json` 和根入口导出中使用完全相同的 manifest。开发时可运行 `tgbotpress plugin validate` 检查 sidecar 镜像、包身份和安全入口路径；发布前生成 `dist/` 并用 `npm pack --dry-run` 查看最终包内容。包名可用任意 npm scope，但 plugin ID 必须全局唯一。

## 接入点排查

| 能力 | 开始位置 | 开发时需要确认 |
| --- | --- | --- |
| 内置模块 | `src/plugins/catalog.ts`、`src/plugins/registry.server.ts` | ID、依赖、状态与实际宿主接线一致 |
| 后台导航 | `src/lib/plugin-navigation.ts`、`src/config/admin-navigation.ts` | 菜单权限与插件状态；隐藏菜单不等于禁止 API |
| HTTP API | `src/routes/`、`src/server/` | 身份、角色、来源校验、参数及失败响应 |
| 后台任务 | `src/server/platform-worker.server.ts`、`src/worker/` | 租约、幂等、并发、停用和排空 |
| 机器人配置 | `src/plugins/plugin-config-links.server.ts` | 自动及人工归属、共享配置、恢复与刷新 |
| 数据结构 | `migrations/` | 新旧版本兼容、备份、失败恢复、数据保留 |

现有模块的目录声明和包入口可以作为参考；请继续追踪实际调用者和集成测试，不要把声明当作运行时注册。

## 测试和发布步骤

1. 在不含生产数据的环境中准备依赖和隔离数据库。对 Telegram、支付及链上请求使用模拟服务。
2. 从仓库根目录运行 `npm run typecheck`、相关测试及 `npm run build`；集成测试按各测试文件的隔离数据库要求配置。
3. 在插件目录执行 `npm pack --dry-run`，核对代码、类型、许可证及不应发布的凭据。再执行 `npm pack`，在干净项目中安装产物与必要的 peer dependencies，并验证每个公开入口。
4. 在宿主中逐一验证有权限和无权限访问、重复事件、失败恢复及插件启停。记录运行环境、命令、结果与未覆盖场景。
5. 确认 npm 包已在公开 registry 发布且可被预期用户安装后，再通过后台填写市场展示资料。ETS 上架、npm 发布与宿主安装互相独立。

对于支付、余额和钱包操作，应在同一事务内维护业务状态，并测试重复请求、进程中断和并发竞争。涉及外部副作用时还需验证重试不会造成重复发放或重复扣款。


## 使用独立开发工具包

可安装 `@tgbotpress/devkit` 获得命令行脚手架、MCP 服务和 Agent Skill：

```sh
npm install --global @tgbotpress/devkit
tgbotpress plugin create --id hello-world --name "Hello World"
cd tgbotpress-plugin-hello-world
tgbotpress plugin validate
npm run build
npm pack --dry-run
tgbotpress skill install
```

配置 MCP 客户端运行 `tgbotpress mcp`，可调用 `create_tgbotpress_plugin` 工具生成项目。完整参数、MCP 配置和限制见[开发工具包说明](../packages/devkit/README.md)。
