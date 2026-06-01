-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Fix next dealer predictions — V4
--
-- Bug fixes:
--   1. STABLE → VOLATILE. STABLE allows planner cache within a transaction.
--      process-swing calls this during Pass 2 and Pass 3 in the same cron
--      cycle — without VOLATILE it would see Pass 2 results during Pass 3.
--   2. Remove att.current_state != 'on_break'. This filter removes tables
--      whose dealer just entered in_transition (forced break), hiding OT 
--      tables from the dashboard. assignment status is sufficient.
--   3. Rename to get_table_assignments_with_next. "predict_next_dealers"
--      implies scoring/ML logic exists. It doesn't — it only fetches the
--      confirmed pre_assigned_attendance_id. Honest name.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop old function (all overloads)
DROP FUNCTION IF EXISTS public.predict_next_dealers(p_club_id UUID);
DROP FUNCTION IF EXISTS public.predict_next_dealers(p_club_id UUID, p_shift_id UUID);

CREATE OR REPLACE FUNCTION public.get_table_assignments_with_next(p_club_id UUID)
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
VOLATILE                          -- [FIX 1] VOLATILE = never cache, always re-execute
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
    da.status = 'assigned'                                    -- assignment status is sufficient
    -- [FIX 2] REMOVED: AND att.current_state != 'on_break'   -- filters OT/in_transition tables
    AND da.swing_processed_at IS NULL                          -- exclude completed swings
    AND gt.club_id = p_club_id
  ORDER BY
    -- OT tables first
    da.overtime_started_at ASC NULLS LAST,
    -- Then by soonest swing due
    da.swing_due_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_table_assignments_with_next(UUID) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_table_assignments_with_next IS
  'Fetches current + next dealer for each active assignment. Returns OT tables first, then by swing urgency.';

-- Keep backward compatibility: old name calls new function
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
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.get_table_assignments_with_next(p_club_id);
$$;

GRANT EXECUTE ON FUNCTION public.predict_next_dealers(UUID) TO anon, authenticated, service_role;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_table_assignments_with_next'
  ), 'get_table_assignments_with_next function missing';
  RAISE NOTICE '✓ get_table_assignments_with_next created (VOLATILE, renamed, fixed WHERE)';
END;
$$;

COMMIT;
