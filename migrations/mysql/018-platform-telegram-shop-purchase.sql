BEGIN;

CREATE TABLE IF NOT EXISTS t_platform_telegram_shop_purchase (
  update_rid bigint PRIMARY KEY,
  callback_query_id varchar(200) UNIQUE,
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  cdkey_rid integer NOT NULL,
  payment_type smallint NOT NULL CHECK (payment_type IN (1,2)),
  price numeric(20,6),
  outcome varchar(32) NOT NULL CHECK (outcome IN ('purchased','user_missing','item_unavailable','unsupported_price','insufficient_balance')),
  delivery_status varchar(16) NOT NULL DEFAULT 'none' CHECK (delivery_status IN ('none','pending','sending','sent','uncertain')),
  order_rid integer,
  telegram_message_id bigint,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CHECK ((outcome='purchased' AND order_rid IS NOT NULL AND delivery_status<>'none') OR (outcome<>'purchased' AND order_rid IS NULL AND delivery_status='none'))
);

CREATE INDEX t_platform_telegram_shop_purchase_user_created_idx
  ON t_platform_telegram_shop_purchase(bot_rid,chat_id,created_at DESC);

COMMIT;
