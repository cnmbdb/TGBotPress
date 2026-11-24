CREATE TABLE IF NOT EXISTS t_platform_telegram_monitor_wallet_purchase (
  update_rid bigint PRIMARY KEY,
  callback_query_id varchar(200) UNIQUE,
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  package_wallets integer NOT NULL CHECK (package_wallets IN (5,10,20,50,100,200)),
  price_usdt numeric(20,6),
  outcome varchar(32) NOT NULL CHECK (outcome IN ('purchased','user_missing','package_unavailable','insufficient_balance')),
  balance_before numeric(20,6),
  balance_after numeric(20,6),
  quota_before integer,
  quota_after integer,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS t_platform_telegram_monitor_wallet_purchase_user_created_idx
  ON t_platform_telegram_monitor_wallet_purchase(bot_rid, chat_id, created_at DESC);
