-- ============================================================================
-- tournament_entries.source — add 'offline' (cash / walk-in buy-in)
-- ============================================================================
-- SOURCE-ONLY for the cashier offline buy-in PR. Applied later in a controlled
-- DB session. Extends the existing CHECK ('online','manual','staff') to also
-- allow 'offline'. Idempotent: drops whatever the current source CHECK is named
-- (auto-named inline constraint), then re-adds with the expanded set.
-- ============================================================================

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.tournament_entries'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%source%'
    AND pg_get_constraintdef(oid) ILIKE '%online%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tournament_entries DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.tournament_entries
  ADD CONSTRAINT tournament_entries_source_check
  CHECK (source IN ('online', 'manual', 'staff', 'offline'));
