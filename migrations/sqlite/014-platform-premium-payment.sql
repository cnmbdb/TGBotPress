BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_premium_payment (
  order_rid integer PRIMARY KEY,
  state varchar(16) NOT NULL CHECK (state IN ('prepared','submitting','succeeded','manual')),
  tx_hash varchar(200),
  error_code varchar(80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS t_platform_premium_payment_state_idx ON t_platform_premium_payment(state, updated_at);
COMMIT;
