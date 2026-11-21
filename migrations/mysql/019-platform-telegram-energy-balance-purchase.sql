BEGIN;

CREATE TABLE IF NOT EXISTS t_platform_telegram_energy_balance_purchase (
  update_rid bigint PRIMARY KEY,
  callback_query_id varchar(200) UNIQUE,
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  package_rid integer NOT NULL,
  payment_type varchar(8) NOT NULL CHECK (payment_type IN ('trx','usd')),
  pay_price numeric(20,6),
  outcome varchar(32) NOT NULL CHECK (outcome IN ('purchased','user_missing','wallet_missing','package_unavailable','unsupported_price','insufficient_balance')),
  quick_order_rid integer,
  response_text text NOT NULL,
  response_markup JSON NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK ((outcome='purchased' AND quick_order_rid IS NOT NULL) OR (outcome<>'purchased' AND quick_order_rid IS NULL))
);

CREATE INDEX t_platform_telegram_energy_balance_purchase_user_created_idx
  ON t_platform_telegram_energy_balance_purchase(bot_rid,chat_id,created_at DESC);

COMMIT;
