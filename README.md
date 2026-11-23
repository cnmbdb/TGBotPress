<div align="center">

![TGBotPress 展示动画](docs/images/tgbotpress-banner-hd.gif)

# TGBotPress

**面向 Telegram Bot 的模块化管理基座与插件生态**

用可复用的基座、清晰的模块边界和插件开发接口，让机器人功能开发与管理更高效。

[![Docker build and publish](https://github.com/cnmbdb/TGBotPress/actions/workflows/docker-build.yml/badge.svg)](https://github.com/cnmbdb/TGBotPress/actions/workflows/docker-build.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-database-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

[项目介绍](#项目介绍) · [开始使用](#开始使用) · [部署教程](#部署教程) · [插件开发](#插件开发) · [常见问题](#常见问题)

</div>

---

## 目录

- [项目介绍](#项目介绍)
- [界面预览](#界面预览)
- [功能模块](#功能模块)
- [技术栈](#技术栈)
- [开始使用](#开始使用)
- [部署教程](#部署教程)
- [插件开发](#插件开发)
- [源码开发与验证](#源码开发与验证)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 项目介绍

TGBotPress 是一个以 **基座 + 模块插件 + 插件市场** 为方向的 Telegram Bot 项目。基座提供管理后台、数据库、机器人管理及插件生命周期等公共能力；开发者可以围绕业务模块组织代码，减少重复开发，用户则可按需要管理模块。

项目的目标是让开发者开发 Telegram Bot 模块，并向插件市场提交展示信息。基座源码采用 Apache-2.0 许可证开放，欢迎参与开发和完善生态。

> [!IMPORTANT]
> 项目仍在迭代。当前已有 SDK 类型、内置模块、生命周期管理和 ETS 市场信息提交入口；任意第三方插件的通用安装、动态路由和安全隔离尚未完成。**提交市场信息或成功打包，不代表插件已可自动安装运行。** 请先阅读[插件开发文档](docs/plugin-development.md)。

### 项目特点

- 🧩 **模块化组织**：将群组、商城、监控等业务划分为模块，按生命周期管理。
- 🤖 **面向 Telegram Bot**：围绕机器人配置、消息处理与后台管理组织能力。
- 🛠️ **开发者接口**：提供插件 SDK、manifest 类型和现有模块示例。
- 🛍️ **插件市场入口**：支持向 ETS 的 TGBotPress 分类提交插件展示信息。
- 🐳 **容器化交付**：使用 GitHub Actions 构建镜像并推送至 GHCR。

## 界面预览

点击截图可查看原图。

<table>
  <tr>
    <td align="center" width="50%"><a href="docs/images/screenshots/login.png"><img src="docs/images/screenshots/login.png" alt="TGBotPress 管理员登录页面" width="100%"></a><br><strong>管理员登录</strong></td>
    <td align="center" width="50%"><a href="docs/images/screenshots/dashboard.png"><img src="docs/images/screenshots/dashboard.png" alt="TGBotPress 管理后台仪表盘" width="100%"></a><br><strong>管理后台</strong></td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="docs/images/screenshots/plugins.png"><img src="docs/images/screenshots/plugins.png" alt="TGBotPress 插件管理页面" width="100%"></a><br><strong>插件管理</strong></td>
    <td align="center" width="50%"><a href="docs/images/screenshots/plugin-development.png"><img src="docs/images/screenshots/plugin-development.png" alt="TGBotPress 模块插件开发页面" width="100%"></a><br><strong>插件开发</strong></td>
  </tr>
</table>

> [!NOTE]
> 截图展示当前界面；插件远程安装和第三方隔离的状态请以实际版本及[插件开发文档](docs/plugin-development.md)为准。

## 功能模块

| 模块 | 功能方向 |
| --- | --- |
| 群组管理 | 群组、用户、群管策略和充值记录 |
| 闪兑钱包 | 兑换钱包、订单与交易 |
| 能量管理 | 能量平台、套餐、订单和相关任务 |
| 会员管理 | 会员平台、套餐、订单和发放 |
| 监控管理 | 机器人与钱包监控 |
| 归集管理 | 归集钱包与任务，依赖闪兑模块 |
| 商城管理 | 商城机器人、商品、卡密与订单 |
| 克隆/代理 | 代理开户、商户和收益 |

模块以当前 [插件目录](src/plugins/catalog.ts) 为准。各模块的包化程度不同，部分业务仍由基座提供。

## 技术栈

| 层次 | 技术 |
| --- | --- |
| 应用框架 | TanStack Start、TanStack Router、React、TypeScript |
| 数据与界面 | PostgreSQL、TanStack Query、TanStack Table |
| UI | Tailwind CSS、Radix UI、shadcn/ui 组件 |
| 运行与交付 | Node.js 22、Docker、GitHub Actions、GitHub Container Registry |

## 开始使用

选择适合你的方式：

1. **体验和部署**：使用已构建镜像，按 [Docker Compose 教程](docs/deployment/docker-compose.md)启动应用和 PostgreSQL。
2. **开发功能**：克隆仓库，按照[源码开发与验证](#源码开发与验证)准备环境。
3. **开发插件**：从 [插件开发](#插件开发) 和 [完整开发文档](docs/plugin-development.md)开始。

> [!NOTE]
> GitHub Actions 已构建并推送 `ghcr.io/cnmbdb/tgbotpress:latest`。GHCR 新建包可能为私有；若拉取时提示未授权，请先使用有权读取该包的 GitHub 账号登录 GHCR，或由包所有者在 GitHub Packages 中调整可见性。公开匿名拉取状态请以实际仓库设置为准。

## 部署教程

先选择应用运行方式，再选择数据库和数据存储方式。每项都链接到对应教程或组合说明：

### 应用如何运行

| 方式 | 适合场景 | 教程 |
| --- | --- | --- |
| VPS / 宝塔 Node.js 项目 | 在服务器运行 Node.js 进程，连接独立数据库 | [宝塔 Node 部署](docs/deployment/baota-node.md) |
| VPS / 宝塔 Docker | 通过宝塔管理应用容器，可搭配 Compose 数据库或外部数据库 | [宝塔 Docker 部署](docs/deployment/baota-docker.md) |
| Docker Compose | 在 VPS 一次启动应用、PostgreSQL 和 Redis | [Docker Compose 部署](docs/deployment/docker-compose.md) |

### 数据库和持久化怎么选

| 组合 | 典型搭配 | 当前状态和说明 |
| --- | --- | --- |
| PostgreSQL 容器 + 数据卷 | Docker / Compose + 同机 PostgreSQL | 当前推荐；数据由 PostgreSQL 服务管理，数据卷用于持久化。见[数据库组合说明](docs/deployment/databases.md#postgresql-容器与数据卷) |
| 外部或托管 PostgreSQL | 宝塔 Node 或 Docker + 独立 PostgreSQL | 可配置；确认网络、TLS、扩展和建表权限。见[连接参数及托管数据库](docs/deployment/databases.md#外部与托管-postgresql) |
| MySQL / MariaDB | Node 或 Docker + MySQL 服务 | 接入开发中；当前代码已有部分适配，尚未完成全业务验收。见[数据库状态](docs/deployment/databases.md#mysql--mariadb) |
| SQLite 文件 + 持久化目录 | 单机 Node 或挂载宿主机目录的容器 | 接入开发中；不能把文件放在临时容器层。见[SQLite 文件与 SQL 导入](docs/deployment/databases.md#sqlite-文件与-sql-文件) |
| Cloudflare D1 | Cloudflare Workers + D1 绑定 | 目标部署方式仍在开发，不能当作 VPS 上的数据库地址使用。见[Cloudflare D1 与 Hyperdrive](docs/deployment/databases.md#cloudflare-d1-与-hyperdrive) |
| SQL 备份文件 | 导入对应数据库 | SQL 文件是备份/迁移输入，不是可直接挂载运行的数据库。见[SQLite 文件与 SQL 导入](docs/deployment/databases.md#sqlite-文件与-sql-文件) |

> [!IMPORTANT]
> 只有 PostgreSQL 组合目前作为可部署方案提供。MySQL、SQLite 和 D1 的工作仍在推进；表格里的说明用于帮助选型，不代表完整业务已经通过验收。部署前请查看[数据库连接与组合](docs/deployment/databases.md)中的状态和限制。

## 插件开发

TGBotPress 提供插件 SDK、模块生命周期和现有插件示例。可通过独立开发 MCP 包 `@tgbotpress/mcp` 使用 CLI 脚手架、MCP 工具和 Agent Skill；安装与配置见[MCP 包说明](packages/devkit/README.md)。插件宿主接入、测试和市场发布流程见[插件开发文档](docs/plugin-development.md)。当前第三方插件的通用动态安装与隔离仍在开发中。

## 源码开发与验证

需要 Node.js 22、npm 和可访问的 PostgreSQL。仓库提供 `package-lock.json`，镜像构建使用 `npm ci`。

```sh
git clone https://github.com/cnmbdb/TGBotPress.git
cd TGBotPress
npm ci
```

设置 `DB_HOST`、`DB_PORT`、`DB_DATABASE`、`DB_USERNAME`、`DB_PASSWORD` 和 `PLATFORM_ORIGIN` 后运行 `npm run dev`；服务默认监听 8083。Vite 读取仓库根目录 `.env`。开发用数据库需要先具备基础表结构及迁移：镜像启动脚本可初始化空数据库，而 `npm run db:migrate` 只执行 `migrations/` 下的平台迁移，不能单独初始化空数据库。

```sh
npm run typecheck         # TypeScript 检查
npm test                  # 单元测试及脚本测试
npm run test:integration  # 集成测试，部分测试需隔离数据库或额外配置
npm run build             # 应用构建
```

测试前查看对应测试文件的环境要求。不要对真实支付、链上账户或生产数据库运行破坏性测试。

## 项目结构

```text
TGBotPress/
├── .github/workflows/    # GitHub Actions 镜像工作流
├── docs/                 # 插件开发文档
├── legacy/               # 数据库初始化所需基础结构与模板
├── migrations/           # 平台数据库迁移
├── packages/             # 插件 SDK 与模块包
├── public/               # 静态资源
├── scripts/              # 启动、迁移与辅助脚本
├── src/
│   ├── components/       # 界面组件
│   ├── plugins/          # 插件目录、注册与生命周期
│   ├── routes/           # 页面及 API 路由
│   ├── server/           # 服务端业务
│   └── worker/           # 后台任务入口
├── Dockerfile
└── package.json
```

## 常见问题

<details>
<summary><strong>拉取镜像时报未授权怎么办？</strong></summary>

检查包是否公开。私有包需要使用有权限的 GitHub 账号与具备相应包读取权限的凭据登录 GHCR；不要将凭据写进 Compose 文件或提交到仓库。

</details>

<details>
<summary><strong>启动失败或健康检查未通过怎么办？</strong></summary>

先查看 `docker compose logs app` 和 `docker compose logs postgres`。确认数据库健康、连接参数一致、空数据库已设置有效的初始管理员密码，且迁移没有报错。数据库就绪不代表 Telegram、支付或其他外部服务已经配置完成。

</details>

<details>
<summary><strong>为什么添加插件后没有自动出现页面？</strong></summary>

当前页面、API 和任务仍需按宿主结构接入，第三方动态路由尚未完成。请查看[插件开发文档](docs/plugin-development.md)和现有模块实现。

</details>

## 参与贡献

欢迎通过 [Issues](https://github.com/cnmbdb/TGBotPress/issues) 反馈问题或讨论功能，也欢迎提交 Pull Request。提交前请说明触发场景和验证方式；涉及数据库、支付、钱包或 Telegram 行为时，请特别说明迁移、权限、幂等和失败处理。

## 许可证

本项目采用 [Apache License 2.0](LICENSE)。
