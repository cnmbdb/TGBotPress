CREATE TABLE IF NOT EXISTS t_premium_platform (
  rid serial PRIMARY KEY,
  bot_rid integer NOT NULL,
  platform_name smallint NOT NULL,
  tg_admin_uid varchar(500),
  platform_hash varchar(500),
  platform_cookie varchar(3000),
  platform_phrase varchar(3000),
  status smallint NOT NULL DEFAULT 1,
  receive_wallet varchar(100),
  get_tx_time timestamp without time zone,
  tg_notice_obj_receive varchar(200),
  tg_notice_obj_send varchar(200),
  comments varchar(255),
  create_time timestamp without time zone NOT NULL,
  update_time timestamp without time zone
);

CREATE TABLE IF NOT EXISTS t_premium_platform_order (
  rid serial PRIMARY KEY,
  bot_rid integer NOT NULL,
  premium_platform_rid integer NOT NULL,
  source_type smallint NOT NULL DEFAULT 1,
  buy_tg_uid varchar(100) NOT NULL,
  buy_tg_username varchar(100),
  premium_tg_username varchar(100) NOT NULL,
  need_pay_usdt numeric(12,4) NOT NULL,
  status smallint NOT NULL DEFAULT 0,
  premium_platform_package_rid integer NOT NULL,
  premium_package_month integer NOT NULL,
  comments varchar(255),
  create_time timestamp without time zone NOT NULL,
  update_time timestamp without time zone,
  expire_time timestamp without time zone NOT NULL,
  cancel_time timestamp without time zone,
  complete_time timestamp without time zone,
  recipient varchar(1000),
  tx_hash varchar(200),
  tg_notice_user character(1) NOT NULL DEFAULT 'N',
  tg_notice_admin character(1) NOT NULL DEFAULT 'N'
);

CREATE TABLE IF NOT EXISTS t_premium_platform_package (
  rid serial PRIMARY KEY,
  bot_rid integer NOT NULL,
  premium_platform_rid integer NOT NULL,
  package_name varchar(50) NOT NULL,
  package_month integer NOT NULL,
  usdt_price numeric(14,2) NOT NULL,
  callback_data varchar(50) NOT NULL,
  seq_sn integer NOT NULL DEFAULT 0,
  status smallint NOT NULL DEFAULT 1,
  show_notes varchar(1000),
  package_pic varchar(200),
  comments varchar(255),
  create_time timestamp without time zone NOT NULL,
  update_time timestamp without time zone
);

CREATE TABLE IF NOT EXISTS t_premium_wallet_trade_list (
  rid serial PRIMARY KEY,
  tx_hash varchar(100) NOT NULL,
  transferfrom_address varchar(200) NOT NULL,
  transferto_address varchar(200) NOT NULL,
  coin_name varchar(20) NOT NULL,
  amount varchar(100) NOT NULL,
  "timestamp" varchar(20) NOT NULL,
  process_status smallint NOT NULL DEFAULT 0,
  process_time timestamp without time zone,
  process_comments varchar(255),
  get_time timestamp without time zone,
  tg_notice_status_receive character(1) NOT NULL DEFAULT 'N',
  tg_notice_status_send character(1) NOT NULL DEFAULT 'N',
  platform_order_rid integer,
  premium_package_rid integer,
  premium_platform_rid integer
);

CREATE INDEX IF NOT EXISTS t_premium_platform_bot_status_idx ON t_premium_platform(bot_rid, status);
CREATE INDEX IF NOT EXISTS t_premium_platform_order_bot_user_status_idx ON t_premium_platform_order(bot_rid, buy_tg_uid, status);
CREATE INDEX IF NOT EXISTS t_premium_platform_package_bot_status_idx ON t_premium_platform_package(bot_rid, status);
CREATE INDEX IF NOT EXISTS t_premium_wallet_trade_process_status_idx ON t_premium_wallet_trade_list(process_status, rid);
