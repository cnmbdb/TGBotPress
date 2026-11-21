BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_premium_payment (
  order_rid integer PRIMARY KEY,
  state varchar(16) NOT NULL CHECK (state IN ('prepared','submitting','succeeded','manual')),
  tx_hash varchar(200),
  error_code varchar(80),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX t_platform_premium_payment_state_idx ON t_platform_premium_payment(state, updated_at);
COMMIT;
