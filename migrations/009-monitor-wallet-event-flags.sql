BEGIN;
DO $$
DECLARE
  v_column text;
  v_needs_type_change boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name='t_monitor_wallet'
      AND c.column_name IN (
        'monitor_trx_transaction',
        'monitor_approve_transaction',
        'monitor_multi_transaction',
        'monitor_pledge_transaction'
      )
      AND (c.data_type <> 'character' OR c.character_maximum_length <> 2)
  ) INTO v_needs_type_change;

  -- The legacy compatibility view uses SELECT * and blocks PostgreSQL type changes.
  -- Recreate it only when the underlying flag types actually need migration.
  IF v_needs_type_change THEN
    DROP VIEW IF EXISTS public.monitor_wallet;
    FOREACH v_column IN ARRAY ARRAY[
      'monitor_trx_transaction',
      'monitor_approve_transaction',
      'monitor_multi_transaction',
      'monitor_pledge_transaction'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public'
          AND c.table_name='t_monitor_wallet'
          AND c.column_name=v_column
          AND c.data_type='character'
          AND c.character_maximum_length=2
      ) THEN
        EXECUTE format(
          'ALTER TABLE public.t_monitor_wallet ALTER COLUMN %I TYPE character(2) USING rtrim(%I)::character(2)',
          v_column, v_column
        );
      END IF;
      EXECUTE format(
        'ALTER TABLE public.t_monitor_wallet ALTER COLUMN %I SET DEFAULT %L',
        v_column, 'NN'
      );
    END LOOP;
  END IF;

  ALTER TABLE public.t_monitor_wallet
    ADD COLUMN IF NOT EXISTS monitor_usdt_transaction character(2) NOT NULL DEFAULT 'YY';

  IF to_regclass('public.monitor_wallet') IS NULL THEN
    EXECUTE 'CREATE VIEW public.monitor_wallet AS SELECT * FROM public.t_monitor_wallet';
  END IF;
END $$;
COMMIT;
