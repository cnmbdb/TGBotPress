BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_bindasendn_action (
  grant_rid integer PRIMARY KEY,
  state varchar(16) NOT NULL CHECK (state IN ('claimed','signing','succeeded','manual')),
  platform_rid integer,
  tx_hash varchar(200),
  error_code varchar(80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS t_platform_bindasendn_action_state_idx ON t_platform_bindasendn_action(state, updated_at);
COMMIT;
