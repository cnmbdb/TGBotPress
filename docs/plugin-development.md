# TGBotPress 插件开发文档

本文参考 [TG Ultra TanStack 分支插件开发说明](https://github.com/cnmbdb/tgbot-Ultra-v1-deve/blob/TanStack/docs/plugin-development.md)，并按本仓库当前结构整理。路径均相对仓库根目录；具体接口以源码和测试为准。

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

插件间依赖写在 manifest 的 `dependencies`；npm 依赖写在包的 `package.json`。通过参数注入宿主能力，避免直接依赖宿主私有源码。涉及数据库、鉴权、Telegram 和外部服务时，先明确接口与数据归属。

## 开发与集成流程

1. 从 `src/plugins/catalog.ts` 和 `src/plugins/registry.server.ts` 确定模块及接入点，追踪页面、API、权限、worker、Telegram 更新、数据库表和测试。内置模块参考 `packages/plugin-*`。
2. 在插件包内实现功能，定义公开入口和类型，并通过宿主适配器接入。修改 TypeScript 源码后，确保包中提交的 JavaScript 和声明文件与源码一致。
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
