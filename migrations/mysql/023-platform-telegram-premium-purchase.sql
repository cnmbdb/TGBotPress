BEGIN;

CREATE TABLE IF NOT EXISTS t_platform_telegram_premium_purchase (
  update_rid bigint PRIMARY KEY,
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  premium_tg_username varchar(100) NOT NULL,
  premium_name varchar(255) NOT NULL,
  order_rid bigint NOT NULL,
  package_name varchar(50) NOT NULL,
  premium_package_month integer NOT NULL,
  need_pay_usdt numeric(12,4) NOT NULL,
  receive_wallet varchar(100) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expire_time DATETIME(6) NOT NULL,
  notification_sent_at DATETIME(6)
);

CREATE INDEX t_platform_telegram_premium_purchase_user_created_idx
  ON t_platform_telegram_premium_purchase(bot_rid, chat_id, created_at DESC);

COMMIT;
