-- Floor V3: an available physical table must have a canonical number.
-- Legacy/unreconciled tables may remain NULL/NULL and cannot be opened by V3.
-- Apply only after reviewing the exact-ID physical-number repair runbook.
-- ROLLBACK (owner-gated): ALTER TABLE public.game_tables
--   DROP CONSTRAINT game_tables_v3_available_requires_number;
--   DROP TRIGGER game_tables_v3_keep_number ON public.game_tables;
--   DROP FUNCTION private.game_tables_v3_keep_number();
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.game_tables'::pg_catalog.regclass
      AND conname = 'game_tables_v3_available_requires_number'
  ) THEN
    ALTER TABLE public.game_tables
      ADD CONSTRAINT game_tables_v3_available_requires_number
      CHECK (operational_status IS DISTINCT FROM 'available' OR table_number IS NOT NULL)
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.game_tables
  VALIDATE CONSTRAINT game_tables_v3_available_requires_number;

-- Once a physical table has an audited number, do not let a later maintenance
-- or disabled status erase it while historical sessions still reference it.
CREATE OR REPLACE FUNCTION private.game_tables_v3_keep_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.table_number IS NOT NULL AND NEW.table_number IS NULL THEN
    RAISE EXCEPTION 'numbered physical table cannot lose its number'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.game_tables'::pg_catalog.regclass
      AND tgname = 'game_tables_v3_keep_number'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER game_tables_v3_keep_number
      BEFORE UPDATE OF table_number ON public.game_tables
      FOR EACH ROW EXECUTE FUNCTION private.game_tables_v3_keep_number();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.game_tables_v3_keep_number() FROM PUBLIC, anon, authenticated;

COMMIT;
