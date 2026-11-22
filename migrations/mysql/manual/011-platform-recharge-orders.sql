ALTER TABLE t_telegram_bot_user
  ADD COLUMN total_recharge_trx DECIMAL(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN total_recharge_usdt DECIMAL(20,6) NOT NULL DEFAULT 0;

UPDATE t_telegram_bot_user AS u
JOIN (
  SELECT bot_rid, recharge_tg_uid, SUM(recharge_pay_price) AS total
  FROM t_fms_recharge_order
  WHERE status=1 AND LOWER(recharge_coin_name)='trx'
    AND COALESCE(LEFT(comments,16),'') <> '__clone_proxy__:'
  GROUP BY bot_rid,recharge_tg_uid
) AS r ON u.bot_rid=r.bot_rid AND CAST(u.tg_uid AS CHAR)=r.recharge_tg_uid
SET u.total_recharge_trx=COALESCE(r.total,0);

UPDATE t_telegram_bot_user AS u
JOIN (
  SELECT bot_rid, recharge_tg_uid, SUM(recharge_pay_price) AS total
  FROM t_fms_recharge_order
  WHERE status=1 AND LOWER(recharge_coin_name)='usdt'
    AND COALESCE(LEFT(comments,16),'') <> '__clone_proxy__:'
  GROUP BY bot_rid,recharge_tg_uid
) AS r ON u.bot_rid=r.bot_rid AND CAST(u.tg_uid AS CHAR)=r.recharge_tg_uid
SET u.total_recharge_usdt=COALESCE(r.total,0);

CREATE TABLE IF NOT EXISTS t_platform_cloneproxy_token_waiter (
  master_bot_rid INT NOT NULL,
  pay_user_tg_uid BIGINT NOT NULL,
  clone_proxy_order_rid BIGINT NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(master_bot_rid,pay_user_tg_uid)
);
CREATE INDEX t_platform_cloneproxy_token_waiter_expiry_idx
  ON t_platform_cloneproxy_token_waiter(expires_at,consumed_at);
