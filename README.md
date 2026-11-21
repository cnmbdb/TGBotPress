# TGBotPress

TGBotPress 是面向 Telegram Bot 的模块化插件系统，由开源基座和插件市场组成。项目希望为开发者提供可复用的机器人管理、后台和插件能力，减少重复开发，让用户按需组合功能。

我们的目标是让任何开发者都能开发 Telegram Bot 模块插件，并将插件发布到插件市场。目前项目仍在逐步完善这一能力：已有插件 SDK、内置模块的生命周期管理，以及向 ETS 提交插件展示信息的入口；第三方插件的通用安装、运行时扩展与隔离尚未完成，不能认为任意插件已经可以直接安装运行。详见[插件开发文档](docs/plugin-development.md)。

## 已有模块

当前内置目录包括群组管理、闪兑钱包、能量管理、会员管理、监控管理、归集管理、商城管理和克隆/代理。各模块的独立程度不同，部分业务仍由基座负责；具体接入点见 `src/plugins/catalog.ts` 和 `packages/`。

## 技术栈

TanStack Start、React、TypeScript、PostgreSQL、TanStack Query/Table 和 shadcn/ui。

## 本地开发

在仓库根目录执行：

```sh
npm ci
npm run db:migrate
npm run dev
```

Vite 在服务端读取仓库根目录的 `.env`。将 `PLATFORM_ORIGIN` 和 `LEGACY_ORIGIN` 设置为明确且可信的地址；在 Docker 宿主机运行时可用 `PLATFORM_DB_HOST` 覆盖 `DB_HOST`。凭据不能使用 `VITE_` 前缀。如需与旧版 Admin 联动，将其 `PLATFORM_URL` 设置为与 `PLATFORM_ORIGIN` 完全相同的地址。

## 验证

```sh
npm run typecheck
npm test
npm run build
```

检查 `/api/health`，并验证未登录访问受保护 API 时被拒绝。涉及数据库、Telegram 或支付的功能，还需要在隔离环境中执行对应集成测试和端到端验证。

## 许可证

参见 [LICENSE](LICENSE)。
