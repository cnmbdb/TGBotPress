BEGIN;
ALTER TABLE t_platform_telegram_update
  DROP CONSTRAINT IF EXISTS t_platform_telegram_update_status_check;
ALTER TABLE t_platform_telegram_update
  ADD CONSTRAINT t_platform_telegram_update_status_check
  CHECK (status IN ('pending','processing','processed','failed','ignored'));
COMMIT;
