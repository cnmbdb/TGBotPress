BEGIN;

CREATE TABLE IF NOT EXISTS t_platform_monitor_wallet_block_cursor (
  cursor_key varchar(100) PRIMARY KEY,
  latest_block bigint NOT NULL,
  latest_block_id char(64) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE TABLE IF NOT EXISTS t_platform_monitor_wallet_missed_block (
  block_number bigint PRIMARY KEY,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  locked_until DATETIME(6),
  last_error varchar(500),
  discovered_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX t_platform_monitor_wallet_missed_pending_idx
  ON t_platform_monitor_wallet_missed_block(status,next_attempt_at,block_number);
CREATE INDEX t_platform_monitor_wallet_missed_lease_idx
  ON t_platform_monitor_wallet_missed_block(status,locked_until,block_number);

CREATE TABLE IF NOT EXISTS t_platform_monitor_wallet_notification (
  rid BIGINT AUTO_INCREMENT PRIMARY KEY,
  monitor_wallet_rid bigint NOT NULL,
  bot_rid bigint NOT NULL,
  tx_hash char(64) NOT NULL,
  notification_type varchar(20) NOT NULL,
  chat_id varchar(100) NOT NULL,
  payload text NOT NULL,
  reply_markup JSON NOT NULL DEFAULT ('{}'),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  locked_until DATETIME(6),
  sent_at DATETIME(6),
  last_error varchar(500),
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(monitor_wallet_rid,tx_hash,notification_type,chat_id)
);
CREATE INDEX t_platform_monitor_wallet_notification_pending_idx
  ON t_platform_monitor_wallet_notification(status,next_attempt_at,rid);
CREATE INDEX t_platform_monitor_wallet_notification_lease_idx
  ON t_platform_monitor_wallet_notification(status,locked_until,rid);

COMMIT;
