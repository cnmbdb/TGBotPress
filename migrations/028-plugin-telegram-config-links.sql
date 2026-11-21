BEGIN;
CREATE TABLE IF NOT EXISTS t_platform_plugin_config_link (
  rid bigserial PRIMARY KEY,
  plugin_id text NOT NULL,
  config_type text NOT NULL CHECK (config_type IN ('command','keyboard','keyreply','keyreply_keyboard')),
  bot_rid bigint NOT NULL DEFAULT 0,
  config_rid bigint NOT NULL,
  manual_override boolean NOT NULL DEFAULT false,
  create_by text,
  create_time timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plugin_id,config_type,bot_rid,config_rid,manual_override)
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_config_lookup_idx ON t_platform_plugin_config_link(config_type,bot_rid,config_rid);
CREATE INDEX IF NOT EXISTS t_platform_plugin_config_plugin_idx ON t_platform_plugin_config_link(plugin_id,bot_rid);
CREATE TABLE IF NOT EXISTS t_platform_plugin_config_refresh (
  bot_rid bigint PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_owner text,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS t_platform_plugin_config_refresh_work_idx ON t_platform_plugin_config_refresh(status,next_attempt_at,bot_rid);

CREATE OR REPLACE FUNCTION platform_plugin_auto_targets(p_type text,p_bot bigint,p_rid bigint,p_name text,p_opt integer)
RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE targets text[] := ARRAY[]::text[];
BEGIN
  IF p_type='command' THEN
    IF lower(COALESCE(p_name,'')) IN ('trx','z0') THEN RETURN ARRAY['transit']; END IF;
    IF lower(COALESCE(p_name,''))='buyenergy' THEN RETURN ARRAY['energy']; END IF;
    IF lower(COALESCE(p_name,''))='buypremium' THEN RETURN ARRAY['premium']; END IF;
    RETURN targets;
  ELSIF p_type='keyreply' THEN
    IF p_opt IN (3,10,11) THEN RETURN ARRAY['energy']; END IF;
    IF p_opt=4 THEN RETURN ARRAY['premium']; END IF;
    IF p_opt=6 THEN RETURN ARRAY['monitor']; END IF;
    IF p_opt=7 THEN RETURN ARRAY['shop']; END IF;
    IF p_opt=9 THEN RETURN ARRAY['transit']; END IF;
    IF p_opt=8 THEN RETURN ARRAY['transit','energy','premium']; END IF;
    IF p_opt=1 AND lower(COALESCE(p_name,'')) LIKE '%克隆/代理%' THEN RETURN ARRAY['cloneproxy']; END IF;
    RETURN targets;
  ELSIF p_type='keyboard' THEN
    IF lower(COALESCE(p_name,'')) LIKE '%克隆/代理%' THEN targets := array_append(targets,'cloneproxy'); END IF;
    RETURN ARRAY(SELECT DISTINCT x.plugin_id FROM (
      SELECT unnest(targets) AS plugin_id
      UNION SELECT unnest(platform_plugin_config_targets('keyreply',r.bot_rid,r.keyreply_rid,k.monitor_word,k.opt_type))
        FROM t_telegram_bot_keyreply_keyboard r JOIN t_telegram_bot_keyreply k ON k.rid=r.keyreply_rid WHERE r.keyboard_rid=p_rid
    ) x);
  ELSIF p_type='keyreply_keyboard' THEN
    RETURN ARRAY(SELECT DISTINCT x.plugin_id FROM (
      SELECT unnest(platform_plugin_config_targets('keyreply',r.bot_rid,r.keyreply_rid,k.monitor_word,k.opt_type)) AS plugin_id
        FROM t_telegram_bot_keyreply_keyboard r JOIN t_telegram_bot_keyreply k ON k.rid=r.keyreply_rid WHERE r.rid=p_rid AND r.bot_rid=p_bot
      UNION SELECT unnest(platform_plugin_config_targets('keyboard',0,kb.rid,kb.keyboard_name,NULL))
        FROM t_telegram_bot_keyreply_keyboard r JOIN t_telegram_bot_keyboard kb ON kb.rid=r.keyboard_rid WHERE r.rid=p_rid AND r.bot_rid=p_bot
    ) x);
  END IF;
  RETURN targets;
END $$;

CREATE OR REPLACE FUNCTION platform_plugin_config_targets(p_type text,p_bot bigint,p_rid bigint,p_name text,p_opt integer)
RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE has_manual boolean; targets text[];
BEGIN
  SELECT EXISTS(SELECT 1 FROM t_platform_plugin_config_link WHERE config_type=p_type AND bot_rid=p_bot AND config_rid=p_rid AND manual_override) INTO has_manual;
  IF has_manual THEN
    SELECT COALESCE(array_agg(DISTINCT plugin_id) FILTER(WHERE plugin_id<>'__none__'),ARRAY[]::text[]) INTO targets FROM t_platform_plugin_config_link
      WHERE config_type=p_type AND bot_rid=p_bot AND config_rid=p_rid AND manual_override;
    RETURN targets;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT plugin_id) FILTER(WHERE plugin_id<>'__none__'),ARRAY[]::text[]) INTO targets FROM t_platform_plugin_config_link
    WHERE config_type=p_type AND bot_rid=p_bot AND config_rid=p_rid AND NOT manual_override;
  RETURN ARRAY(SELECT DISTINCT x.plugin_id FROM (
    SELECT unnest(COALESCE(targets,ARRAY[]::text[])) AS plugin_id
    UNION SELECT unnest(platform_plugin_auto_targets(p_type,p_bot,p_rid,p_name,p_opt))
  ) x);
END $$;

CREATE OR REPLACE FUNCTION platform_plugin_config_effective(p_type text,p_bot bigint,p_rid bigint,p_name text,p_opt integer)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT cardinality(platform_plugin_config_targets(p_type,p_bot,p_rid,p_name,p_opt))=0
    OR EXISTS(SELECT 1 FROM t_platform_plugin_lifecycle s WHERE s.plugin_id=ANY(platform_plugin_config_targets(p_type,p_bot,p_rid,p_name,p_opt)) AND s.state='active')
$$;

INSERT INTO t_platform_plugin_config_link(plugin_id,config_type,bot_rid,config_rid,manual_override,create_by)
SELECT CASE lower(command) WHEN 'trx' THEN 'transit' WHEN 'z0' THEN 'transit' WHEN 'buyenergy' THEN 'energy' WHEN 'buypremium' THEN 'premium' END,'command',bot_rid,rid,false,'auto'
FROM t_telegram_bot_command WHERE lower(command) IN ('trx','z0','buyenergy','buypremium') ON CONFLICT DO NOTHING;
INSERT INTO t_platform_plugin_config_link(plugin_id,config_type,bot_rid,config_rid,manual_override,create_by)
SELECT mapping.plugin_id,'keyreply',k.bot_rid,k.rid,false,'auto'
FROM t_telegram_bot_keyreply k CROSS JOIN LATERAL unnest(platform_plugin_auto_targets('keyreply',k.bot_rid,k.rid,k.monitor_word,k.opt_type)) mapping(plugin_id)
ON CONFLICT DO NOTHING;
INSERT INTO t_platform_plugin_config_link(plugin_id,config_type,bot_rid,config_rid,manual_override,create_by)
SELECT 'cloneproxy','keyboard',0,k.rid,false,'auto' FROM t_telegram_bot_keyboard k WHERE lower(k.keyboard_name) LIKE '%克隆/代理%' ON CONFLICT DO NOTHING;
COMMIT;
