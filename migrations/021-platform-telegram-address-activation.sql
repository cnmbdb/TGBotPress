BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_telegram_address_activation (
  update_rid bigint PRIMARY KEY,
  bot_rid integer NOT NULL,
  target_address varchar(64) NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('signing','succeeded','manual')),
  tx_hash varchar(200),
  error_code varchar(80),
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  UNIQUE(bot_rid,target_address)
);
CREATE INDEX IF NOT EXISTS t_platform_telegram_address_activation_state_idx
  ON t_platform_telegram_address_activation(state,updated_at);
COMMIT;
