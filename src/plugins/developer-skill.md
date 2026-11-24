---
name: tgbotpress-plugin-development
description: Develop a TGBotPress npm module plugin, including host integration and lifecycle verification.
---

# TGBotPress 插件开发

先阅读仓库 AGENTS.md、docs/plugin-development.md、packages/plugin-sdk/src/index.d.ts，并核对 package.json、宿主注册及实际测试；以当前代码而非示例为准。保留已有改动，并检查目标功能的调用关系和影响。

## 当前契约
第三方插件是独立 ESM npm 包，根目录必须有 `tgbotpress.plugin.json`，`package.json` 的 `tgbotpressPlugin` 必须镜像同一清单；`entry` 指向已编译入口（默认建议 `./dist/index.js`），入口导出与外部清单完全一致的 `manifest` 和 `plugin`。SDK 0.1.0 manifest 必填 `schemaVersion`、命名空间风格 `id`、`name`、`version`、`apiVersion`、`hostRange`、`sdkRange`、`runtime.node`、`entry` 和 `permissions`。优先使用 `telegram.updates.read`、`telegram.messages.send`、`plugin.storage.read`、`plugin.storage.write`、`plugin.jobs.register`、`admin.api` 等细粒度权限；插件存储按 Bot ID 隔离。注册项必须在 `activate(host)` 中通过 SDK 注册能力创建；声明字段不会自动创建页面。当前 runtime 接入 HTTP 路由、周期任务、Telegram 更新和 KV 存储；后台菜单/页面仍需宿主前端静态接入。

## 工作流程
1. 确定宿主版本、功能边界、插件依赖、数据所有权和旧行为；追踪 API、菜单、worker、Telegram、失败与并发路径。
2. 独立实现并通过受控宿主接口注入数据库、日志、鉴权及外部服务；不得导入宿主私有源码。服务器端必须鉴权和检查生命周期，不以隐藏菜单替代权限。
3. 保留人工配置、在途业务、事务锁、幂等、数据及恢复语义；插件停用与卸载需考虑依赖与排空。测试使用隔离 PostgreSQL 和模拟 Telegram、支付、链上服务。
4. 在干净消费项目安装打包产物及 peer dependencies，验证所有公开 JS/类型入口；再通过真实宿主验证菜单、API、任务、启停、失败及回滚。
5. 报告已实现、实测和未实现项；绝不声称 npm pack 成功即支持安装。不得把 token、私钥等凭据放入插件包、前端或日志。

## 重要现状
当前宿主已提供公开 npm 固定版本安装、sidecar manifest 校验、动态 HTTP/Telegram/任务注册及插件级 KV 存储。第三方 npm 动态安装目前只覆盖 PostgreSQL，动态后台菜单/UI、权限审批和插件数据库迁移尚未完成。多容器部署必须共享插件目录。第三方插件代码与 Core 同进程运行，权限声明和 `--ignore-scripts` 不构成沙箱。不要发布包；安装真实外部插件仅限用户明确要求。
