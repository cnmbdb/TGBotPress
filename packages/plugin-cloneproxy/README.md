# @tgbotpress/plugin-cloneproxy

TG Ultra 克隆/代理插件的可发布包。目前包含业务入口和宿主适配契约，主应用仍负责路由注册、数据库迁移、调度租约和页面加载。

## 入口

- `./revenue`：精确金额与分佣计算。
- `./settlement`：从主应用注入连接池、日志器和停止信号，执行收益结算。
- `./onboarding`：Telegram 私聊开户、余额支付、订单取消和入口按钮处理。
- `./token-intake`：Token 校验、机器人创建、配置复制和 Webhook 注册；必须注入宿主的配置复制、Webhook 地址和签名服务。
- `./admin-api`：管理 API；必须注入宿主身份认证、权限判断、数据库连接和生命周期服务。

## 发布

包使用 `@tgbotpress` scope，registry 是 GitHub Packages：

```sh
npm install --registry=https://npm.pkg.github.com @tgbotpress/plugin-cloneproxy
```

当前版本尚未发布。发布由仓库的 `publish-plugin-cloneproxy.yml` 在 `plugin-cloneproxy-v*` 标签或手动触发时执行。安装插件的应用必须提供 `zod` peer dependency，并由宿主控制版本和来源。

## 安全边界

插件包不保存 GitHub 凭据、管理员会话、Webhook 密钥或 Bot Token。Token 接收和管理 API 的敏感能力必须由宿主显式注入；宿主负责权限、生命周期锁、审计和数据库事务。包内测试使用模拟 Telegram 请求和隔离数据库，不代表生产 Telegram 端到端验证。
