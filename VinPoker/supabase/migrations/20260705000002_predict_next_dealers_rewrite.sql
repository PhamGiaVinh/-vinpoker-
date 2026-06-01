-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: predict_next_dealers — REWRITE
--
-- V1 (20260620000000): used game_tables.status = 'active' → 0 rows (all inactive)
-- V2 (20260705000001): changed to 2-param with gt.shift_id filter → frontend
--                     param mismatch + 0 rows (all shift_ids NULL)
-- V3 (THIS): 1-param, sources active tables from dealer_assignments instead of
--            game_tables.status/shift_id. Uses the same query pattern as the
--            frontend's useActiveAssignments hook.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop ALL prior overloads
DROP FUNCTION IF EXISTS public.predict_next_dealers(p_club_id UUID);
DROP FUNCTION IF EXISTS public.predict_next_dealers(p_club_id UUID, p_shift_id UUID);

CREATE OR REPLACE FUNCTION public.predict_next_dealers(p_club_id UUID)
RETURNS TABLE (
  table_id             UUID,
  table_name           TEXT,
  current_dealer       TEXT,
  next_dealer          TEXT,
  next_dealer_tier     TEXT,
  minutes_until_swing  INT,
  overtime_started_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    gt.id                                                       AS table_id,
    gt.table_name                                               AS table_name,
    d_current.full_name                                         AS current_dealer,
    d_next.full_name                                            AS next_dealer,
    d_next.tier                                                 AS next_dealer_tier,
    EXTRACT(EPOCH FROM (da.swing_due_at - NOW()))::INT / 60     AS minutes_until_swing,
    da.overtime_started_at                                      AS overtime_started_at
  FROM dealer_assignments da
  INNER JOIN game_tables gt ON gt.id = da.table_id
  INNER JOIN dealer_attendance att ON att.id = da.attendance_id
  INNER JOIN dealers d_current ON d_current.id = att.dealer_id
  -- Pre-assigned next dealer (LEFT JOIN — optional)
  LEFT JOIN dealer_attendance att_next ON att_next.id = da.pre_assigned_attendance_id
  LEFT JOIN dealers d_next ON d_next.id = att_next.dealer_id
  WHERE
    -- Use assignment status, NOT game_tables.status (all tables are 'inactive')
    da.status = 'assigned'
    -- Exclude dealers on break (matches frontend useActiveAssignments)
    AND att.current_state != 'on_break'
    -- Exclude completed/swing-processed assignments
    AND da.swing_processed_at IS NULL
    -- Scope to club via game_tables (not shift_id — all shift_ids are NULL)
    AND gt.club_id = p_club_id
  ORDER BY
    -- OT tables first
    da.overtime_started_at ASC NULLS LAST,
    -- Then by soonest swing due
    da.swing_due_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.predict_next_dealers(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.predict_next_dealers IS
  'Predicts next dealer for each active assignment in a club. Sources tables from dealer_assignments, not game_tables.status. Returns OT tables first, then by swing urgency.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'predict_next_dealers'
  ), 'predict_next_dealers function missing';
  RAISE NOTICE '✓ predict_next_dealers rewrite created (1-param, assign-based)';
END;
$$;

COMMIT;
