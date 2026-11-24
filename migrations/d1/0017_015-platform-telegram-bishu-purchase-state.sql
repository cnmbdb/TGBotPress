ALTER TABLE t_platform_telegram_conversation_state
  ADD COLUMN context TEXT;

CREATE TABLE IF NOT EXISTS t_platform_telegram_bishu_purchase (
  update_rid bigint PRIMARY KEY,
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  wallet_addr varchar(100) NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric(4,2) NOT NULL,
  total_price numeric(14,2) NOT NULL,
  previous_quantity integer NOT NULL,
  new_quantity integer NOT NULL,
  wallet_rid integer NOT NULL,
  is_active character(1) NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notification_sent_at TEXT
);

CREATE INDEX IF NOT EXISTS t_platform_telegram_bishu_purchase_user_created_idx
  ON t_platform_telegram_bishu_purchase(bot_rid, chat_id, created_at DESC);
