CREATE TABLE IF NOT EXISTS t_platform_plugin_event_delivery (
  plugin_id text NOT NULL,
  bot_id bigint NOT NULL,
  update_id bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plugin_id, bot_id, update_id)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_event_delivery_status_idx ON t_platform_plugin_event_delivery(status, updated_at);
