\set ON_ERROR_STOP on
-- Exact-ID, owner-gated repair for the verified Bàn 8 orphan session only.
-- Do not run as part of migration apply. Re-run the preflight immediately
-- before execution; any changed identity or active child row aborts.
-- Rollback: not automatic. Restore from the approved recovery point or review
-- an exact-ID reopen operation before making any further table assignment.

BEGIN;

DO $$
DECLARE
  v_matches integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_matches
  FROM public.table_sessions session_row
  JOIN public.game_tables game_table
    ON game_table.id = session_row.game_table_id
  JOIN public.tournament_tables assignment
    ON assignment.id = 'b53b4cc9-aefd-4d1f-b36c-b006b9e313cf'::uuid
   AND assignment.table_session_id = session_row.id
   AND assignment.game_table_id = game_table.id
   AND assignment.tournament_id = session_row.tournament_id
  WHERE session_row.id = '21236017-8cf8-4997-ab0f-c5baa4ccb650'::uuid
    AND session_row.tournament_id = '5a51bec5-4da0-4dd9-861a-cc4e7678478c'::uuid
    AND session_row.game_table_id = 'f539c337-0d80-42f3-ab1e-9287f466cda4'::uuid
    AND game_table.table_number = 8
    AND session_row.closed_at IS NULL
    AND assignment.status <> 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_seats seat_row
      WHERE seat_row.table_session_id = session_row.id AND seat_row.is_active
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.dealer_assignments dealer_row
      WHERE dealer_row.table_session_id = session_row.id
        AND dealer_row.released_at IS NULL
        AND dealer_row.status IN ('assigned', 'on_break')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.table_session_seat_locks lock_row
      WHERE lock_row.table_session_id = session_row.id AND lock_row.unlocked_at IS NULL
    );

  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'FLOOR_V3_ORPHAN_REPAIR_PREFLIGHT_CHANGED';
  END IF;
END;
$$;

UPDATE public.table_sessions
SET closed_at = pg_catalog.now(),
    close_reason = 'owner_approved_exact_orphan_repair_20260927',
    revision = revision + 1
WHERE id = '21236017-8cf8-4997-ab0f-c5baa4ccb650'::uuid
  AND closed_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.table_sessions
    WHERE id = '21236017-8cf8-4997-ab0f-c5baa4ccb650'::uuid
      AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'FLOOR_V3_ORPHAN_REPAIR_POSTCHECK_FAILED';
  END IF;
END;
$$;

COMMIT;
