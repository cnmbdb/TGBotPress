CREATE TABLE IF NOT EXISTS t_platform_admin_locale (
  admin_id bigint PRIMARY KEY,
  locale text NOT NULL DEFAULT 'zh-CN' CHECK (locale IN ('zh-CN','en','ru','ja')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
