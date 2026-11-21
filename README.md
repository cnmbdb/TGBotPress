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

1. **体验和部署**：使用已构建镜像，按下面的 [Docker Compose 教程](#部署教程)启动应用和 PostgreSQL。
2. **开发功能**：克隆仓库，按照[源码开发与验证](#源码开发与验证)准备环境。
3. **开发插件**：从 [插件开发](#插件开发) 和 [完整开发文档](docs/plugin-development.md)开始。

> [!NOTE]
> GitHub Actions 已构建并推送 `ghcr.io/cnmbdb/tgbotpress:latest`。GHCR 新建包可能为私有；若拉取时提示未授权，请先使用有权读取该包的 GitHub 账号登录 GHCR，或由包所有者在 GitHub Packages 中调整可见性。公开匿名拉取状态请以实际仓库设置为准。

## 部署教程

下面的 Compose 示例用于**单机体验**：应用只绑定本机 `127.0.0.1:8083`，PostgreSQL 数据保存在 Docker 卷中。上线前需要根据环境配置 HTTPS、域名、备份、密钥和相应业务服务。镜像由 GitHub Actions 远程构建，本教程不要求本机编译镜像。

### 1. 准备环境

- 已安装 Docker 和 Docker Compose 插件。
- 能从部署机器拉取 GHCR 镜像和 `postgres:16` 镜像。
- 准备一个新的、空的 PostgreSQL 数据库；下面示例会自动创建。

### 2. 创建配置文件

新建一个部署目录，在其中创建 `.env`：

```dotenv
# 用于 PostgreSQL 容器和应用连接，请替换成强随机密码
DB_PASSWORD=replace-with-a-strong-database-password
# 仅在空数据库首次初始化时生效：至少 12 个非空白字符，最多 72 个 UTF-8 字节
ADMIN_INITIAL_PASSWORD=replace-with-a-strong-admin-password
# 至少 32 个字符的独立随机密钥，部署后妥善保存
APP_KEY=replace-with-a-long-random-secret-at-least-32-characters
# 必须与访问后台使用的 origin 一致，部署到域名时改为实际 HTTPS 地址
PLATFORM_ORIGIN=http://127.0.0.1:8083
```

可以使用 `openssl rand -hex 32` 生成随机值。为不同用途分别生成密钥，并妥善保护 `.env`，不要将其提交到 Git。

在同一目录创建 `compose.yaml`：

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: tgbotpress
      POSTGRES_USER: tgbotpress
      POSTGRES_PASSWORD: ${DB_PASSWORD:?请设置数据库密码}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U tgbotpress -d tgbotpress"]
      interval: 10s
      timeout: 5s
      retries: 12

  app:
    image: ghcr.io/cnmbdb/tgbotpress:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:8083:8083"
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_DATABASE: tgbotpress
      DB_USERNAME: tgbotpress
      DB_PASSWORD: ${DB_PASSWORD:?请设置数据库密码}
      ADMIN_INITIAL_PASSWORD: ${ADMIN_INITIAL_PASSWORD:?请设置初始管理员密码}
      APP_KEY: ${APP_KEY:?请设置应用密钥}
      PLATFORM_ORIGIN: ${PLATFORM_ORIGIN:?请设置后台访问地址}
      PLATFORM_PROCESS_MODE: all
      PLATFORM_LEGACY_CACHE_REQUIRED: "false"

volumes:
  postgres_data:
```

### 3. 启动并登录

```sh
docker compose pull
docker compose up -d
docker compose logs -f app
```

应用启动时会初始化空数据库并执行迁移。首次初始化的管理员账号为 `trxadmin`，密码是你设置的 `ADMIN_INITIAL_PASSWORD`。浏览器打开 [http://127.0.0.1:8083/login](http://127.0.0.1:8083/login)，或通过 SSH 隧道访问服务器本机端口。

```sh
# 检查容器和应用健康状态
docker compose ps
curl -fsS http://127.0.0.1:8083/api/health
```

> [!WARNING]
> `ADMIN_INITIAL_PASSWORD` **只在空数据库首次初始化时使用**，修改它不会重置已有账号密码。保留并备份数据库卷和 `APP_KEY`；数据库包含账号、配置及业务数据。不要通过删除数据卷解决登录问题。

### 4. 更新镜像

确认备份及版本变更后，在部署目录执行：

```sh
docker compose pull app
docker compose up -d app
docker compose logs -f app
```

每次启动都会执行数据库迁移；更新前请备份数据库。`latest` 会随 `main` 构建更新，生产环境应先在隔离环境验证目标版本和迁移。

<details>
<summary><strong>Telegram、反向代理和进程模式</strong></summary>

- 使用域名时，在反向代理中配置 HTTPS，并将 `PLATFORM_ORIGIN` 设为浏览器实际访问的完整 origin，例如 `https://bot.example.com`。示例只监听本机端口，需要由反向代理转发。
- Compose 示例默认运行 Web 与 worker（`PLATFORM_PROCESS_MODE=all`）。也可按部署架构选择 `web` 或 `worker`；拆分时需分别规划进程、数据库和健康检查。
- Telegram 相关操作和更新分发受 `PLATFORM_TELEGRAM_ACTIONS`、`PLATFORM_TELEGRAM_UPDATE_DISPATCH_READY` 控制，默认不会仅因启动容器而全部启用。Webhook 需要可从 Telegram 访问的 HTTPS 地址、正确的路由和稳定密钥；在受控环境验证后再启用。
- `WEBHOOK_PROXY_PORT` 是可选的额外监听端口；只有实际部署需要第二个端口时才配置和映射。
- 部分媒体、邮件、链上及支付功能需要额外服务和配置。示例仅用于启动基座，不代表已完成全部业务接入。

</details>

## 插件开发

### 第一步：了解当前契约

从 [插件 SDK 类型](packages/plugin-sdk/src/index.d.ts)、[内置插件目录](src/plugins/catalog.ts) 和 [示例插件](packages/plugin-cloneproxy/) 开始。插件包通常使用 ESM，根入口导出 `manifest` 和 `plugin`：

```js
export const manifest = {
  id: 'example',
  version: '0.1.0',
  hostRange: '>=1.0.0 <2.0.0',
  sdkVersion: '0.1.0',
  name: '示例插件',
}

export const plugin = { manifest }
```

### 第二步：实现并接入

1. 创建插件包，定义 `package.json` 的 `exports`、JavaScript 与类型入口。
2. 实现业务逻辑，通过接口注入宿主能力，明确权限、数据库、任务与 Telegram 事件的边界。
3. 按当前宿主结构显式接入菜单、API 和任务；manifest 本身不会自动注册这些功能。
4. 在隔离环境测试权限、生命周期、失败重试、并发与在途业务，再检查打包内容：

```sh
cd packages/plugin-example  # 替换为你的插件目录
npm pack --dry-run
```

### 第三步：提交市场展示

在后台插件市场登录 ETS，填写插件名称、介绍、npm 安装命令和可选图片后提交。提交展示信息、发布 npm 包、宿主接入和安装验证是独立步骤。

> [!TIP]
> 插件生命周期、依赖、安全边界和市场提交条件见 **[完整插件开发文档](docs/plugin-development.md)**。第三方插件自动安装和隔离尚未完成，开发者应以当前源码和实测结果为准。

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
