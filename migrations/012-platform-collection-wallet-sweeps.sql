BEGIN;
ALTER TABLE t_collection_wallet
  ADD COLUMN IF NOT EXISTS last_collection_time timestamp without time zone,
  ADD COLUMN IF NOT EXISTS last_collection_trx_balance numeric(16,6),
  ADD COLUMN IF NOT EXISTS last_collection_usdt_balance numeric(16,6),
  ADD COLUMN IF NOT EXISTS collection_trx_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collection_usdt_generation integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS t_platform_collection_wallet_action (
  id bigserial PRIMARY KEY,
  action_key char(64) NOT NULL UNIQUE,
  wallet_rid integer NOT NULL,
  coin_name varchar(10) NOT NULL CHECK (coin_name IN ('trx','usdt','trx_fee')),
  from_address varchar(200) NOT NULL,
  to_address varchar(200) NOT NULL,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  balance_snapshot numeric(20,6) NOT NULL CHECK (balance_snapshot >= amount),
  generation integer NOT NULL DEFAULT 0,
  state varchar(20) NOT NULL DEFAULT 'claimed'
    CHECK (state IN ('claimed','signing','succeeded','manual')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  tx_hash varchar(200),
  error_code varchar(80),
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t_platform_collection_wallet_action_wallet_idx
  ON t_platform_collection_wallet_action(wallet_rid, coin_name, created_at DESC);

CREATE INDEX IF NOT EXISTS t_collection_wallet_active_sweep_idx
  ON t_collection_wallet(status, rid) WHERE status=0;
COMMIT;
