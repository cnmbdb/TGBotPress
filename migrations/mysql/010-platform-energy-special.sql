BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_energy_special_action (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 idempotency_key varchar(255) NOT NULL UNIQUE,
 action_type varchar(20) NOT NULL CHECK (action_type IN ('delegate','recover')),
 source_rid integer NOT NULL,
 energy_special_rid integer NOT NULL,
 energy_platform_rid integer NOT NULL,
 amount_trx numeric(18,6) NOT NULL CHECK (amount_trx > 0),
 energy_amount bigint,
 target_address varchar(50) NOT NULL,
 state varchar(20) NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed','signing','succeeded','retryable','manual')),
 tx_hash varchar(100),
 attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
 error_code varchar(80),
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX t_platform_energy_special_action_pending_idx ON t_platform_energy_special_action(state,updated_at,id);
COMMIT;
