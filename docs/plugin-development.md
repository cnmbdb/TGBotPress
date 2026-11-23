# TGBotPress 插件开发文档

本文介绍 TGBotPress 插件的开发与集成。路径均相对仓库根目录；具体接口以源码和测试为准。

## 当前能力与边界

TGBotPress 的目标是支持开发者开发 Telegram Bot 模块插件，并在插件市场发布。当前代码提供 SDK 类型、八个内置插件目录、生命周期管理和 ETS 插件展示信息提交入口。开发者可以参考现有包开发和集成模块，但任意第三方包还不能直接通过市场安装并自动运行：

- 宿主目录和接线以 `src/plugins/catalog.ts`、`src/plugins/registry.server.ts` 为准；声明 manifest 不会自动注册页面、API、任务或 Telegram 事件。
- 远程安装的信任策略要求插件 ID 已在内置目录中，包名为 `@tgbotpress/plugin-<id>`；GitHub Packages 包需要 SHA-512 完整性信息。见 `src/plugins/install-policy.server.ts`。
- 前端路由仍需构建期接入；第三方代码隔离、多实例制品同步、重启切换及线上回滚仍需实现或验收。
- 市场提交是向 ETS 提交插件名称、介绍、npm 包和可选图片，并不等同于发布 npm 包或完成安装验证。提交需要超级管理员及有效 ETS 登录；外部服务是否接受以上架接口实际结果为准。见 `src/server/plugin-market-api.server.ts`。

第三方插件代码具有执行宿主进程权限的风险；`--ignore-scripts` 和 manifest 声明不能代替隔离。不要将凭据放进插件包、前端或日志。

## SDK 与插件结构

SDK 类型位于 `packages/plugin-sdk/src/index.d.ts`。插件通常是 ESM npm 包，使用 `package.json` 的 `exports` 显式暴露 JavaScript 和类型入口。参照 `packages/plugin-cloneproxy` 与 `packages/plugin-groups`。

根入口可以按现有包的形式导出：

```js
export const manifest = {
  id: 'example',
  version: '0.1.0',
  hostRange: '>=1.0.0 <2.0.0',
  sdkVersion: '0.1.0',
  name: '示例插件',
  dependencies: [],
  menuRoutes: [],
  apiRoutes: [],
  tasks: [],
  drainTasks: [],
  configTypes: [],
}

export const plugin = { manifest }
```

`id`、`version`、`hostRange`、`sdkVersion` 和 `name` 为必填字段；可选字段还包括 `description`。`configTypes` 可包含 `command`、`keyboard`、`keyreply` 和 `keyreply_keyboard`。`plugin` 可实现 `activate(host)` 和 `deactivate(host)`；当前 SDK 的 `PluginHost` 提供 manifest、状态查询、状态转换和日志接口。上述示例只说明数据结构，不能单独实现宿主接入。

### 内置会员 npm 包

`packages/plugin-premium` 是会员模块的 npm 包示例。它导出 manifest、Telegram 套餐购买及订单回调、USDT 钱包轮询、Fragment/TON 与 Telegram Stars 履约、会员通知、后台 API、后台页面组件和 `./tasks` 调度任务定义。Stars 开通使用 Bot API 的 `giftPremiumSubscription`；官方接口只接受目标用户的数值 `user_id`，机器人履约成本固定为 3/6/12 个月 1000/1500/2500 Stars，购买者仍按套餐设置支付 USDT。宿主通过适配器注入数据库、身份/权限、密钥解密、TON 签名器、API key 和媒体存储等能力。页面主体由包提供；TanStack 路由仍需宿主在构建时挂载，并注入后台 shell 与 UI 组件。会员专属 PostgreSQL 表及增量迁移放在包的 `migrations/postgres/`，宿主账号、机器人和会话表仍由平台核心拥有；迁移器只发现仓库内插件和宿主 `package.json` 明确声明的 `@tgbotpress/plugin-*` 依赖。包内服务端 TypeScript 源文件以 `*.source.ts` 保存，后台页面以 `admin-pages.*.tsx` 保存；使用 `npm run build` 生成发布用的 ESM `*.js` 和类型声明 `*.d.ts`，使用 `npm run typecheck` 检查包源码。

订单/交易/平台/套餐 API 由宿主静态路由转接到插件包，后台任务由宿主调度器使用包内任务定义；管理身份与权限由宿主注入。会员后台页面组件由包提供，宿主静态路由负责挂载并注入 shell/UI runtime。**仅安装这个 npm 包不会自动注册页面或启动任务**；完整的第三方动态路由、安装隔离与任务权限仍未实现。

插件间依赖写在 manifest 的 `dependencies`；npm 依赖写在包的 `package.json`。通过参数注入宿主能力，避免直接依赖宿主私有源码。涉及数据库、鉴权、Telegram 和外部服务时，先明确接口与数据归属。

## 开发与集成流程

1. 从 `src/plugins/catalog.ts` 和 `src/plugins/registry.server.ts` 确定模块及接入点，追踪页面、API、权限、worker、Telegram 更新、数据库表和测试。内置模块参考 `packages/plugin-*`。
2. 在插件包内实现功能，定义公开入口和类型，并通过宿主适配器接入。插件包执行 `npm run build` 生成提交的 JavaScript 和声明文件，再执行 `npm run typecheck` 检查源码。
3. 显式接入菜单、服务端 API 和任务；服务端必须检查权限及插件状态，隐藏菜单不能代替鉴权。对 Telegram 配置关联，参考 `src/plugins/plugin-config-links.server.ts`。
4. 在隔离数据库和模拟外部服务中验证正常、失败、重复执行和并发路径。支付、钱包和订单要保留事务、幂等与恢复语义。
5. 在插件目录执行 `npm pack --dry-run` 检查包内容，再在干净消费项目中安装产物及其 peer dependencies，验证公开入口和类型。另通过宿主真实入口验证插件行为；打包成功不代表可以动态安装。

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
└── src/
    ├── index.js
    └── index.d.ts
```

`package.json` 的最小形式：

```json
{
  "name": "@example/plugin-example",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": { "types": "./src/index.d.ts", "import": "./src/index.js" }
  },
  "files": ["src"],
  "peerDependencies": { "@tgbotpress/plugin-sdk": "^0.1.0" }
}
```

在 `src/index.js` 填写上方 manifest 和 plugin 示例，并为公开入口提供对应类型声明。发布前确认 SDK 版本及 registry 权限；如果 SDK 未在目标 registry 可用，需要通过开发环境可访问的方式提供匹配版本。示例包名不会绕过当前官方包信任策略。

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
5. 确认 npm 包已在目标 registry 发布且可被预期用户安装后，再通过后台填写市场展示资料。ETS 上架、npm 发布与宿主安装互相独立。

对于支付、余额和钱包操作，应在同一事务内维护业务状态，并测试重复请求、进程中断和并发竞争。涉及外部副作用时还需验证重试不会造成重复发放或重复扣款。


## 使用独立开发工具包

可安装 `@tgbotpress/devkit` 获得命令行脚手架、MCP 服务和 Agent Skill：

```sh
npm install --global @tgbotpress/devkit
tgbotpress plugin create --id hello-world --name "Hello World"
tgbotpress skill install
```

配置 MCP 客户端运行 `tgbotpress mcp`，可调用 `create_tgbotpress_plugin` 工具生成项目。完整参数、MCP 配置和限制见[开发工具包说明](../packages/devkit/README.md)。
