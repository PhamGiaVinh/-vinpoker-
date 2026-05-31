-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: End expired breaks RPC
--
-- Root cause: evaluateBreakNeed sends ALL dealers to break simultaneously
-- because minutes_since_rest >= maxWork (120min) for everyone checked in ~2hr.
-- Without this RPC, dealers pile up in on_break state with no return path.
-- Pre-assign fails because buildDealerCandidates filters .eq("current_state", "available").
--
-- Fix: Add end_expired_breaks RPC called by process-swing Pass 4 after each cycle.
-- Also fix minutes_since_rest to use released_at (last table release) instead of
-- check_in_time, so evaluateBreakNeed correctly measures time since last release.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Step 1: Fix minutes_since_rest in dealer_shift_metrics ─────────────
-- Original: EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(db.break_end), da.check_in_time, NOW()))) / 60
-- Problem: measures from check_in_time, so a dealer working 2hr shows restMin=120,
--          triggering break even though they only need a 5-min breather between swings.
-- Fix: measure from last RELEASE (released_at on dealer_assignments), which correctly
--      reflects how long the dealer has been OFF a table.
--      minutes_since_rest = time since last released_at (or check_in_time if never released)
DROP VIEW IF EXISTS public.dealer_shift_metrics CASCADE;
CREATE VIEW public.dealer_shift_metrics AS
SELECT
  da.id AS attendance_id,
  da.dealer_id,
  d.full_name,
  d.tier,
  d.skills,
  da.shift_date,
  da.current_state,
  da.priority_break_flag,
  da.worked_minutes_since_last_break,
  da.total_worked_minutes_today,
  da.status,

  -- Break metrics
  COALESCE(
    (
      SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(db.break_end, NOW()) - db.break_start)) / 60)
      FROM dealer_breaks db
      JOIN dealer_assignments dass_break ON dass_break.id = db.assignment_id
      WHERE dass_break.attendance_id = da.id
    ), 0
  )::INTEGER AS total_break_minutes,

  MAX(db.break_end) AS last_break_end,
  MAX(db.break_start) AS last_break_start,

  -- FIXED: minutes_since_rest uses released_at (last table release) instead of check_in_time
  -- This correctly reflects rest time after a swing, preventing false break triggers.
  EXTRACT(EPOCH FROM (
    NOW() - COALESCE(
      -- Time since last table release (most recent released_at for this attendance)
      (
        SELECT MAX(dassign.released_at)
        FROM dealer_assignments dassign
        WHERE dassign.attendance_id = da.id
          AND dassign.released_at IS NOT NULL
      ),
      da.check_in_time,
      NOW()
    )
  )) / 60 AS minutes_since_rest,

  -- Assignment metrics
  (
    SELECT COUNT(*)
    FROM dealer_assignments dassign
    WHERE dassign.attendance_id = da.id
      AND dassign.released_at IS NOT NULL
  )::INTEGER AS total_assignments,

  -- Latest assignment info
  (
    SELECT dassign.table_id
    FROM dealer_assignments dassign
    WHERE dassign.attendance_id = da.id
      AND dassign.released_at IS NOT NULL
    ORDER BY dassign.released_at DESC
    LIMIT 1
  ) AS last_table_id,

  da.pre_assigned_table_id,
  da.pre_assigned_at,
  da.created_at,
  d.club_id,
  d.status AS dealer_status
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
LEFT JOIN dealer_assignments dass ON dass.attendance_id = da.id
LEFT JOIN dealer_breaks db ON db.assignment_id = dass.id
GROUP BY da.id, da.dealer_id, d.full_name, d.tier, d.skills, da.shift_date,
  da.current_state, da.priority_break_flag, da.worked_minutes_since_last_break,
  da.total_worked_minutes_today, da.status, da.pre_assigned_table_id,
  da.pre_assigned_at, da.created_at, d.club_id, d.status;

-- Grant access (matching existing RLS)
ALTER VIEW public.dealer_shift_metrics SET SCHEMA public;
GRANT SELECT ON public.dealer_shift_metrics TO authenticated, anon, service_role;

-- ── Step 2: Create end_expired_breaks RPC ─────────────────────────────
-- Called by process-swing Pass 4 to return dealers from on_break → available
-- after their break duration has expired.
-- This prevents the "all dealers on break, none available" death spiral.
CREATE OR REPLACE FUNCTION public.end_expired_breaks(p_club_id UUID DEFAULT NULL)
RETURNS TABLE(
  attendance_id UUID,
  dealer_name TEXT,
  break_start TIMESTAMPTZ,
  expected_duration_minutes INT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    -- Find on_break dealers whose break duration has expired
    SELECT DISTINCT ON (da.id)
      da.id AS att_id,
      d.full_name AS d_name,
      db.break_start AS br_start,
      db.expected_duration_minutes AS exp_min
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    JOIN dealer_assignments dass ON dass.attendance_id = da.id
    JOIN dealer_breaks db ON db.assignment_id = dass.id
    WHERE da.current_state = 'on_break'
      AND da.status = 'checked_in'
      AND db.break_end IS NULL
      AND NOW() > db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
    ORDER BY da.id, db.break_start DESC
  )
  UPDATE dealer_attendance da
  SET current_state = 'available'
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING
    da.id,
    expired.d_name,
    expired.br_start,
    expired.exp_min;
END;
$$;

-- ── Step 3: Verify ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'end_expired_breaks'
  ) THEN
    RAISE EXCEPTION 'end_expired_breaks function not found after migration';
  END IF;
END $$;
