BEGIN;
DO $$
DECLARE
  add_trx_total boolean;
  add_usdt_total boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='t_telegram_bot_user' AND column_name='total_recharge_trx'
  ) INTO add_trx_total;
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='t_telegram_bot_user' AND column_name='total_recharge_usdt'
  ) INTO add_usdt_total;

  ALTER TABLE t_telegram_bot_user ADD COLUMN IF NOT EXISTS total_recharge_trx numeric(20,6) NOT NULL DEFAULT 0;
  ALTER TABLE t_telegram_bot_user ADD COLUMN IF NOT EXISTS total_recharge_usdt numeric(20,6) NOT NULL DEFAULT 0;

  IF add_trx_total THEN
    UPDATE t_telegram_bot_user u SET total_recharge_trx=COALESCE(r.total,0)
    FROM (
      SELECT bot_rid,recharge_tg_uid,SUM(recharge_pay_price) AS total
      FROM t_fms_recharge_order
      WHERE status=1 AND lower(recharge_coin_name)='trx'
        AND COALESCE(left(comments,16),'') <> '__clone_proxy__:'
      GROUP BY bot_rid,recharge_tg_uid
    ) r
    WHERE u.bot_rid=r.bot_rid AND u.tg_uid::text=r.recharge_tg_uid;
  END IF;
  IF add_usdt_total THEN
    UPDATE t_telegram_bot_user u SET total_recharge_usdt=COALESCE(r.total,0)
    FROM (
      SELECT bot_rid,recharge_tg_uid,SUM(recharge_pay_price) AS total
      FROM t_fms_recharge_order
      WHERE status=1 AND lower(recharge_coin_name)='usdt'
        AND COALESCE(left(comments,16),'') <> '__clone_proxy__:'
      GROUP BY bot_rid,recharge_tg_uid
    ) r
    WHERE u.bot_rid=r.bot_rid AND u.tg_uid::text=r.recharge_tg_uid;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS t_platform_cloneproxy_token_waiter (
  master_bot_rid integer NOT NULL,
  pay_user_tg_uid bigint NOT NULL,
  clone_proxy_order_rid bigint NOT NULL,
  expires_at timestamp without time zone NOT NULL,
  consumed_at timestamp without time zone,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  PRIMARY KEY(master_bot_rid,pay_user_tg_uid)
);
CREATE INDEX IF NOT EXISTS t_platform_cloneproxy_token_waiter_expiry_idx
  ON t_platform_cloneproxy_token_waiter(expires_at) WHERE consumed_at IS NULL;
COMMIT;
