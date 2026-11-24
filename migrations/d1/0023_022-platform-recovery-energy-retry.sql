CREATE TABLE IF NOT EXISTS t_platform_recovery_energy_retry (
  energy_platform_order_rid integer PRIMARY KEY,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS t_platform_recovery_energy_retry_window_idx
  ON t_platform_recovery_energy_retry(window_started_at);
