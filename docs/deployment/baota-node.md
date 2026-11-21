# VPS / 宝塔面板：Node.js 部署

本方式在 VPS 上通过宝塔 Node 项目管理进程，使用 Node.js 22 和 PostgreSQL。构建发生在部署服务器；不要求在个人电脑构建镜像。开始前准备域名、HTTPS、Node.js 22、npm、Git 和可连接的空 PostgreSQL 数据库。数据库可装在同机、另一个容器或独立服务器，详见[数据库连接与组合](databases.md)。

## 1. 获取源码和依赖

在宝塔终端进入计划使用的项目目录，使用项目运行用户执行：

```sh
git clone https://github.com/cnmbdb/TGBotPress.git
cd TGBotPress
npm ci
npm run build
./node_modules/.bin/esbuild src/worker/platform-worker.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=.output/worker.mjs
./node_modules/.bin/esbuild src/worker/monitor-wallet-worker.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=.output/monitor-wallet-worker.mjs
```

不要将项目目录放到可被 Nginx 静态访问的位置；尤其不能暴露 `.env`、源码和构建产物。建议使用专用的非特权运行用户。

## 2. 配置环境变量

在宝塔 Node 项目的环境变量中设置以下值（按实际数据库填写，勿把凭据提交到 Git）：

```dotenv
NODE_ENV=production
PORT=8083
HOST=127.0.0.1
PLATFORM_PROCESS_MODE=all
PLATFORM_ORIGIN=https://bot.example.com
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=tgbotpress
DB_USERNAME=tgbotpress
DB_PASSWORD=替换为数据库密码
APP_KEY=替换为至少32字符的随机密钥
ADMIN_INITIAL_PASSWORD=替换为至少12个非空白字符的强密码
PLATFORM_LEGACY_CACHE_REQUIRED=false
```

`ADMIN_INITIAL_PASSWORD` 只用于空库首次初始化，最多 72 个 UTF-8 字节，不会重置已有管理员密码。长期保存并备份 `APP_KEY`；变更密钥可能使已加密配置无法读取。不要暴露数据库到公网。

## 3. 注册 Node 项目

在宝塔 Node 项目中选择该目录及 Node 22，启动命令使用 `node scripts/start.mjs`。该入口先初始化空数据库并执行迁移，再按 `PLATFORM_PROCESS_MODE` 启动 Web 和 worker；不要把 `npm run dev` 用作生产服务。若面板要求 npm 脚本入口，请使用支持自定义命令的项目模式。

将域名反向代理到 `127.0.0.1:8083` 并配置 HTTPS；`PLATFORM_ORIGIN` 必须与用户访问地址一致。绑定或更新配置后检查实际监听端口、进程状态和日志。

## 4. 验证与更新

打开 `https://bot.example.com/login`，以 `trxadmin` 和初始密码登录；再检查 `https://bot.example.com/api/health`。验证数据库、worker 和所需 Telegram 功能，HTTP 健康检查不等于所有业务可用。

更新前备份数据库和密钥，在服务器拉取目标版本并重新执行依赖安装、构建及两个 worker 打包命令，然后重启宝塔项目并检查迁移日志。不要在有数据的数据库上重新初始化或删除表。

> 此教程根据当前代码和启动脚本整理，具体宝塔界面及数据库服务配置需在目标服务器验证。
