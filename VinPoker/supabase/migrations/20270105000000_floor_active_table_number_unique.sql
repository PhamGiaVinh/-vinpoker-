-- ============================================================================
-- Floor table-number invariant (SOURCE-ONLY; NOT APPLIED by this change)
--
-- One *active* table number may exist per tournament. Closed/broken rows remain
-- as audit history and can be reopened by open_tournament_table, so they are
-- deliberately outside this partial unique index.
--
-- APPLY GATE: owner-controlled DB runbook only. This migration fails closed if
-- existing active duplicates are present; repair must target exact IDs in a
-- separate approved operation. Do not use a broad delete or rename here.
--
-- ROLLBACK: DROP INDEX CONCURRENTLY IF EXISTS
--   public.tournament_tables_one_active_number_per_tournament;
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables
    WHERE status = 'active'
      AND table_number IS NOT NULL
    GROUP BY tournament_id, table_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'floor_active_table_number_duplicate: repair exact active tournament_tables records before applying this guard';
  END IF;
END;
$$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tournament_tables_one_active_number_per_tournament
  ON public.tournament_tables (tournament_id, table_number)
  WHERE status = 'active'
    AND table_number IS NOT NULL;
