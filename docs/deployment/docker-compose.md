# Docker Compose：应用与 PostgreSQL

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
