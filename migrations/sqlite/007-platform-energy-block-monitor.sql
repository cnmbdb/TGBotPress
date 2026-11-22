BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_energy_block_cursor (
 cursor_key varchar(100) PRIMARY KEY,
 latest_block bigint NOT NULL,
 latest_block_id char(64) NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS t_platform_energy_missed_block (
 block_number bigint PRIMARY KEY,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 locked_until TEXT,
 last_error varchar(500),
 discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS t_platform_energy_missed_block_pending_idx
 ON t_platform_energy_missed_block(status,next_attempt_at,block_number);
CREATE INDEX IF NOT EXISTS t_platform_energy_missed_block_lease_idx
 ON t_platform_energy_missed_block(status,locked_until,block_number);
COMMIT;
