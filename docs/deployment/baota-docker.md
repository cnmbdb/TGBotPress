# VPS / 宝塔面板：Docker 部署

本方式使用已发布的 `ghcr.io/cnmbdb/tgbotpress:latest` 镜像。需要宝塔 Docker 管理功能、Docker Compose，以及能拉取镜像的服务器。镜像支持 AMD64 和 ARM64；若 GHCR 包为私有，需先使用有读取权限的账号登录。

## 方案一：数据库随 Compose 部署

按照 [Docker Compose 教程](docker-compose.md) 创建 `.env` 和 `compose.yaml`。在宝塔的 Docker / Compose 项目管理中选择该目录或导入 Compose 配置，然后创建并启动项目。具体按钮名称可能随面板版本变化；也可以通过宝塔终端在部署目录运行教程中的 `docker compose` 命令。

该方案使用独立的 PostgreSQL **容器**，数据保存在命名卷中，不需要另外购买数据库。它不是内嵌 SQLite 或单容器数据库。不要删除 `postgres_data` 卷；升级前备份数据库。

## 方案二：连接已有 PostgreSQL

创建应用容器时设置 `DB_HOST`、`DB_PORT`、`DB_DATABASE`、`DB_USERNAME`、`DB_PASSWORD`，并配置 `APP_KEY`、`ADMIN_INITIAL_PASSWORD`、`PLATFORM_ORIGIN`。数据库可运行在本机另一容器、另一台服务器或兼容的托管服务上。容器内的 `localhost` 指容器自身；根据网络实际配置填写可达地址，不要直接假定宿主机地址。

首次使用空库时，镜像启动脚本会初始化基础表并执行迁移；初始账号为 `trxadmin`。已经存在数据的库不会通过环境变量重置密码。参数说明与外部数据库限制见[数据库连接与组合](databases.md)。

## 域名和验证

将容器 8083 端口映射到本机，再通过宝塔网站反向代理指向该端口并配置 HTTPS；`PLATFORM_ORIGIN` 设置成浏览器访问的完整 HTTPS origin。容器及数据库之间需要可达的网络连接。

检查容器日志、数据库连接和 `/api/health`，然后用初始管理员登录。启用 Telegram Webhook 前还需配置公网 HTTPS 地址和业务开关。更新前备份数据库及密钥；Compose 的 `down -v` 会删除命名卷，勿对有数据的部署执行。
