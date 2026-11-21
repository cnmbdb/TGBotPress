BEGIN;

CREATE TABLE IF NOT EXISTS t_platform_monitor_wallet_block_cursor (
  cursor_key varchar(100) PRIMARY KEY,
  latest_block bigint NOT NULL,
  latest_block_id char(64) NOT NULL,
  updated_at timestamp without time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS t_platform_monitor_wallet_missed_block (
  block_number bigint PRIMARY KEY,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamp without time zone NOT NULL DEFAULT now(),
  locked_until timestamp without time zone,
  last_error varchar(500),
  discovered_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t_platform_monitor_wallet_missed_pending_idx
  ON t_platform_monitor_wallet_missed_block(status,next_attempt_at,block_number);
CREATE INDEX IF NOT EXISTS t_platform_monitor_wallet_missed_lease_idx
  ON t_platform_monitor_wallet_missed_block(status,locked_until,block_number);

CREATE TABLE IF NOT EXISTS t_platform_monitor_wallet_notification (
  rid bigserial PRIMARY KEY,
  monitor_wallet_rid bigint NOT NULL,
  bot_rid bigint NOT NULL,
  tx_hash char(64) NOT NULL,
  notification_type varchar(20) NOT NULL,
  chat_id varchar(100) NOT NULL,
  payload text NOT NULL,
  reply_markup jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamp without time zone NOT NULL DEFAULT now(),
  locked_until timestamp without time zone,
  sent_at timestamp without time zone,
  last_error varchar(500),
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  UNIQUE(monitor_wallet_rid,tx_hash,notification_type,chat_id)
);
CREATE INDEX IF NOT EXISTS t_platform_monitor_wallet_notification_pending_idx
  ON t_platform_monitor_wallet_notification(status,next_attempt_at,rid);
CREATE INDEX IF NOT EXISTS t_platform_monitor_wallet_notification_lease_idx
  ON t_platform_monitor_wallet_notification(status,locked_until,rid);

COMMIT;
