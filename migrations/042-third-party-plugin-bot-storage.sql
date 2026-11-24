ALTER TABLE t_platform_plugin_storage ADD COLUMN IF NOT EXISTS bot_id bigint NOT NULL DEFAULT 0;
ALTER TABLE t_platform_plugin_storage DROP CONSTRAINT IF EXISTS t_platform_plugin_storage_pkey;
ALTER TABLE t_platform_plugin_storage ADD CONSTRAINT t_platform_plugin_storage_pkey PRIMARY KEY (plugin_id, bot_id, storage_key);
