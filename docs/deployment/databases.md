# 数据库连接与部署组合

TGBotPress 当前使用 `pg` 驱动连接 PostgreSQL，迁移和 SQL 依赖 PostgreSQL 的语法与特性。部署前准备独立数据库、专用账号和可靠备份；首次启动初始化需要足够的建表、索引及扩展权限。托管服务的权限和扩展支持需在目标环境验证。

| 组合 | 当前状态 | 说明 |
| --- | --- | --- |
| 应用容器 + 同机 PostgreSQL 容器 | 可配置 | [Compose 示例](docker-compose.md)使用命名卷保存数据库数据，不需要额外购买数据库服务 |
| 宝塔 Node + 同机 PostgreSQL | 可配置 | `DB_HOST` 通常为本机地址，使用专用账号和数据库 |
| 应用 + 独立服务器 PostgreSQL | 可配置 | 使用可达的私网地址和防火墙规则，避免直接暴露公网 |
| 应用 + 托管 PostgreSQL | 需要按服务商验证 | 需支持项目使用的 PostgreSQL 特性、建表/迁移权限和连接模式；当前未对特定服务商完成端到端验收 |
| SQLite / SQL 文件挂载 | 不支持 | 没有 SQLite 驱动和对应 schema；挂载 `.sql` 或数据库文件不能替代运行中的 PostgreSQL |
| MySQL / MariaDB | 不支持 | 驱动、SQL、迁移和数据类型需要适配，不能仅更改连接参数 |
| Cloudflare D1 / Durable Objects SQL | 不支持 | 这些服务使用 SQLite 语义和 Cloudflare 绑定，无法直接作为本项目的 PostgreSQL 连接使用 |
| Cloudflare Hyperdrive | 未接入 | Hyperdrive 是面向 Workers 的数据库连接服务，后端仍需要数据库；当前 Node/Docker 代码没有 Hyperdrive 绑定或部署配置 |

Cloudflare 的数据库类型和接入方式可参考 [Workers 数据库连接文档](https://developers.cloudflare.com/workers/databases/connecting-to-databases/)及 [Hyperdrive PostgreSQL 示例](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)。

## 连接参数

```dotenv
DB_HOST=数据库可达主机名
DB_PORT=5432
DB_DATABASE=数据库名称
DB_USERNAME=数据库用户
DB_PASSWORD=数据库密码
```

这些变量被生产迁移脚本和应用读取。`PLATFORM_DB_HOST` 仅覆盖应用连接的 `DB_HOST`，生产迁移脚本仍读取 `DB_HOST`；两者应分别从各自运行环境可达。当前连接配置没有提供通用的 TLS 参数开关；若托管数据库要求 TLS，先确认实际部署环境的安全连接方案及应用兼容性，不要假定填入主机名即可安全连接。

镜像启动时先初始化**空**数据库，再执行平台迁移。对已有数据库，先备份并检查兼容性；不要覆盖已有表。`ADMIN_INITIAL_PASSWORD` 仅在空库初始化时生效，修改环境变量不会重置既有管理员密码。

若希望真正支持 MySQL、SQLite、D1 或其他数据库，需要单独开发驱动适配、迁移、事务与并发语义，并进行完整业务验证；本文不将这些方案标记为现成可部署。
