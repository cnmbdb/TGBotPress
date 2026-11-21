ALTER TABLE t_platform_ets_account_binding
 ADD COLUMN IF NOT EXISTS display_name varchar(120),
 ADD COLUMN IF NOT EXISTS avatar_url varchar(2048);
