BEGIN;

CREATE TABLE IF NOT EXISTS t_platform_telegram_monitor_wallet_toggle (
  update_rid bigint PRIMARY KEY,
  callback_query_id varchar(200) UNIQUE,
  bot_rid integer NOT NULL,
  chat_id bigint NOT NULL,
  wallet_rid integer NOT NULL,
  setting varchar(40) NOT NULL CHECK (setting IN ('monitor_usdt_transaction','monitor_trx_transaction','monitor_approve_transaction','monitor_multi_transaction','monitor_pledge_transaction')),
  before_value char(2) NOT NULL CHECK (before_value IN ('YY','NN')),
  after_value char(2) NOT NULL CHECK (after_value IN ('YY','NN')),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE INDEX t_platform_telegram_monitor_wallet_toggle_wallet_created_idx
  ON t_platform_telegram_monitor_wallet_toggle(bot_rid,chat_id,wallet_rid,created_at DESC);

COMMIT;
