# 数据库连接与部署组合

本文帮助选择 TGBotPress 的数据库和数据保存方式。应用部署入口见[宝塔 Node 教程](baota-node.md)、[宝塔 Docker 教程](baota-docker.md)和[Docker Compose 教程](docker-compose.md)。

当前只有 PostgreSQL 组合作为完整部署方案。MySQL、SQLite 和 Cloudflare D1 的适配工作正在进行；有驱动、迁移文件或部分通过的验证，不等于全业务已经可以稳定部署。请按下面的状态表选择方案。

| 组合 | 当前状态 | 数据如何保存 |
| --- | --- | --- |
| 应用容器 + 同机 PostgreSQL 容器 | **可部署，当前推荐** | PostgreSQL 管理数据库文件；Docker 命名卷持久化数据库目录。见[Compose 示例](docker-compose.md) |
| 宝塔 Node + 本机 PostgreSQL | **可部署** | PostgreSQL 服务在 VPS 运行，数据库文件由 PostgreSQL 管理。见[宝塔 Node 教程](baota-node.md) |
| 应用 + 独立服务器 PostgreSQL | **可部署** | 独立数据库服务保存数据；使用私网和防火墙限制访问 |
| 应用 + 托管 PostgreSQL | **按服务商验证** | 使用托管服务保存数据；检查项目所需扩展、TLS、连接限制和迁移权限 |
| MySQL / MariaDB | **开发中，尚未完成全业务验收** | 由 MySQL 服务持久化；不能只改连接参数后用于正式业务 |
| SQLite 文件 + Node/容器 | **开发中，尚未完成全业务验收** | 文件需要放在持久化磁盘或挂载目录；容器重建时必须保留该目录，且要考虑单实例写入 |
| Cloudflare D1 | **开发中，尚无完整 Worker 发布链路** | 由 Cloudflare D1 管理；通过 Worker 环境绑定访问，不是 VPS 可直接连接的数据库主机 |
| Cloudflare Hyperdrive + PostgreSQL | **未接入** | Hyperdrive 加速 Workers 到 PostgreSQL 的连接，仍需另有 PostgreSQL 数据库；当前应用没有 Hyperdrive 运行时绑定 |
| SQL 备份/导出文件 | **可用于导入或迁移，不可直接运行** | `.sql` 是导入数据库的脚本/备份；把它挂载到应用容器不会让应用获得数据库服务 |

Cloudflare 的数据库类型和接入方式可参考 [Workers 数据库连接文档](https://developers.cloudflare.com/workers/databases/connecting-to-databases/)及 [Hyperdrive PostgreSQL 示例](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)。

## PostgreSQL 容器与数据卷

Compose 教程使用独立的 `postgres:16` 服务，并把数据库目录放在 `postgres_data` 命名卷中。应用容器通过 Compose 网络中的服务名 `postgres` 连接数据库。数据库不是打包进应用镜像的，也不是单个 SQL 文件；升级应用时保留卷，升级前制作数据库备份。

宝塔 Docker 可以采用相同的两容器结构，也可以连接已经运行的 PostgreSQL。详细设置见[宝塔 Docker 教程](baota-docker.md)。不要在有数据的部署中执行会删除数据卷的命令，例如 `docker compose down -v`。

## 外部与托管 PostgreSQL

Node 和 Docker 部署都可以连接外部 PostgreSQL。Docker 容器里的 `localhost` 指应用容器自身；同机数据库容器应使用容器网络服务名，远程数据库则使用可达的主机名和端口。使用专用数据库账号，不要将 PostgreSQL 端口无保护地开放到公网。

托管 PostgreSQL 是否可用取决于服务商提供的 TLS、连接方式、扩展及权限。镜像启动时会创建空库所需结构并执行迁移，因此首次初始化需要相应的 DDL 权限。当前尚未对所有托管服务做端到端验证。

## MySQL / MariaDB

MySQL/MariaDB 适合 VPS 上独立运行或由另一容器提供服务，但目前仍处于接入开发阶段，完整平台业务和并发任务尚未全部验收。已有 MySQL 驱动、迁移和启动适配不能作为所有业务可用的证明。正式部署前需等待 README 更新为已支持，并完成登录、配置、插件、订单及后台 worker 的集成验证。

## SQLite 文件与 SQL 文件

SQLite 是单个数据库文件，部署时必须把文件放在持久化路径。容器方案需要将宿主机目录或 Docker 卷挂载到容器，并将 SQLite 数据库路径指向挂载目录；只写入容器可写层会在删除/重建容器后丢失数据。SQLite 写入并发和多进程 worker 也需要按应用实现验证。目前 TGBotPress 的 SQLite 接入尚未完成全业务验收。

`.sql` 文件是数据库建表、迁移或备份内容，不是 SQLite 数据库本身。要使用 SQL 文件，需要通过所选数据库的客户端导入，并确认文件对应同一数据库类型和版本。不能把 PostgreSQL dump 直接导入 MySQL/SQLite/D1，也不能把 SQL 文本文件挂载到应用容器就当作数据库。

## Cloudflare D1 与 Hyperdrive

D1 使用 Cloudflare Worker 绑定和 SQLite 语义；它不是 VPS、Node 或普通 Docker 容器可以通过 `DB_HOST` 连接的托管 SQL 地址。要部署到 D1，需要 Cloudflare Worker 构建入口、绑定配置、迁移执行方式，以及适配 Worker 请求生命周期的后台任务和事务处理。目前这些部分尚未形成可发布的完整部署方式。

Hyperdrive 是 Workers 连接外部 PostgreSQL/MySQL 的连接池和加速层，不是数据库实例，也不会把普通 Node/Docker 应用变成 D1 部署。TGBotPress 当前没有接入 Hyperdrive 绑定。

Cloudflare 官方说明：[Workers 数据库连接](https://developers.cloudflare.com/workers/databases/connecting-to-databases/) · [Hyperdrive PostgreSQL 示例](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)。

## PostgreSQL 连接参数

```dotenv
DB_HOST=数据库可达主机名
DB_PORT=5432
DB_DATABASE=数据库名称
DB_USERNAME=数据库用户
DB_PASSWORD=数据库密码
```

这些参数由 PostgreSQL 生产迁移脚本和应用读取。`PLATFORM_DB_HOST` 仅覆盖应用连接的 `DB_HOST`，生产迁移脚本仍读取 `DB_HOST`；两者应分别从各自运行环境可达。当前连接配置没有通用 TLS 参数开关；若托管数据库要求 TLS，先确认目标部署环境的安全连接方案及应用兼容性。

镜像启动时先初始化**空**数据库，再执行平台迁移。对已有数据库升级前先备份并检查兼容性；不要覆盖已有表。`ADMIN_INITIAL_PASSWORD` 仅在空库初始化时生效，修改环境变量不会重置既有管理员密码。
