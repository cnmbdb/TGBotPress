BEGIN;

ALTER TABLE t_premium_platform_order
  ADD COLUMN IF NOT EXISTS fulfillment_method varchar(24) NOT NULL DEFAULT 'fragment_ton',
  ADD COLUMN IF NOT EXISTS need_pay_stars integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_tg_user_id bigint;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='t_premium_platform_order'::regclass AND conname='t_premium_platform_order_fulfillment_method_check') THEN
    ALTER TABLE t_premium_platform_order ADD CONSTRAINT t_premium_platform_order_fulfillment_method_check CHECK (fulfillment_method IN ('fragment_ton','telegram_stars'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='t_premium_platform_order'::regclass AND conname='t_premium_platform_order_stars_amount_check') THEN
    ALTER TABLE t_premium_platform_order ADD CONSTRAINT t_premium_platform_order_stars_amount_check CHECK (need_pay_stars >= 0);
  END IF;
END $$;

ALTER TABLE t_platform_telegram_premium_purchase
  ADD COLUMN IF NOT EXISTS fulfillment_method varchar(24) NOT NULL DEFAULT 'fragment_ton',
  ADD COLUMN IF NOT EXISTS need_pay_stars integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS premium_tg_user_id bigint;

ALTER TABLE t_platform_premium_payment
  ADD COLUMN IF NOT EXISTS payment_method varchar(24) NOT NULL DEFAULT 'fragment_ton',
  ADD COLUMN IF NOT EXISTS target_user_id bigint,
  ADD COLUMN IF NOT EXISTS star_count integer;

ALTER TABLE t_platform_premium_payment DROP CONSTRAINT IF EXISTS t_platform_premium_payment_state_check;
ALTER TABLE t_platform_premium_payment ADD CONSTRAINT t_platform_premium_payment_state_check
  CHECK (state IN ('prepared','submitting','succeeded','manual','waiting_stars'));

CREATE INDEX IF NOT EXISTS t_premium_platform_stars_order_idx
  ON t_premium_platform_order(premium_platform_rid, status, rid)
  WHERE fulfillment_method='telegram_stars';

COMMIT;
