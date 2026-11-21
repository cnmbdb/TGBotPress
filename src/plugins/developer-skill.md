---
name: tgbotpress-plugin-development
description: Develop or migrate a TGBotPress/TG Ultra npm module plugin, including host integration and lifecycle verification.
---

# TGBotPress 插件开发

先阅读仓库 AGENTS.md、docs/plugin-development.md、packages/plugin-sdk/src/index.d.ts，并核对 package.json、宿主注册及实际测试；以当前代码而非示例为准。保留已有改动，并检查目标功能的调用关系和影响。

## 当前契约
插件为独立 ESM npm 包，`package.json` 的 `exports` 显式提供 JS 和类型入口；根入口导出 `manifest` 与 `plugin`。当前 SDK 0.1.0 的 manifest 必填 `id`、`version`、`hostRange`、`sdkVersion`、`name`，可声明 `dependencies`、`menuRoutes`、`apiRoutes`、`tasks`、`drainTasks` 和 `configTypes`。`plugin` 含 manifest，可选 `activate`、`deactivate`；不要假设声明自动注册路由或能力。根据目标需求列出插件入口、宿主注入类型、权限、数据库表和迁移、任务及 Telegram 更新，参考现有 groups 和 cloneproxy 包。

## 工作流程
1. 确定宿主版本、功能边界、插件依赖、数据所有权和旧行为；追踪 API、菜单、worker、Telegram、失败与并发路径。
2. 独立实现并通过受控宿主接口注入数据库、日志、鉴权及外部服务；不得导入宿主私有源码。服务器端必须鉴权和检查生命周期，不以隐藏菜单替代权限。
3. 保留人工配置、在途业务、事务锁、幂等、数据及恢复语义；插件停用与卸载需考虑依赖与排空。测试使用隔离 PostgreSQL 和模拟 Telegram、支付、链上服务。
4. 在干净消费项目安装打包产物及 peer dependencies，验证所有公开 JS/类型入口；再通过真实宿主验证菜单、API、任务、启停、失败及回滚。
5. 报告已实现、实测和未实现项；绝不声称 npm pack 成功即支持安装。不得把 token、私钥等凭据放入插件包、前端或日志。

## 重要现状
当前宿主是静态注册，远程安装、动态前端路由、版本回滚及第三方隔离未完成安全验收，且安装策略限定官方包。创建 npm 包或提供 manifest 不足以让任意插件直接安装；先实现并验证宿主扩展、第三方隔离和权限机制，再宣称兼容。第三方插件代码是任意代码，权限声明和 `--ignore-scripts` 均不构成沙箱。不要发布、安装或访问真实外部服务，除非任务明确授权。
