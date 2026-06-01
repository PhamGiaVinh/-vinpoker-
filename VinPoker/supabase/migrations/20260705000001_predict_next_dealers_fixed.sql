-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: predict_next_dealers — FIXED
--
-- Fixes: assigns different dealers to different tables (table_rank = dealer_rank)
-- Old version assigned same dealer to all tables.
--
-- Logic:
--   Table 1 → best dealer, Table 2 → second best, etc.
--   Pre-assigned tables show the pre-assigned dealer with 'high' confidence.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop ALL overloads to avoid ambiguity
DROP FUNCTION IF EXISTS public.predict_next_dealers(p_club_id UUID);
DROP FUNCTION IF EXISTS public.predict_next_dealers(p_club_id UUID, p_shift_id UUID);

CREATE OR REPLACE FUNCTION public.predict_next_dealers(
  p_club_id UUID,
  p_shift_id UUID
)
RETURNS TABLE(
  table_id TEXT,
  predicted_dealer_id UUID,
  predicted_dealer_name TEXT,
  confidence TEXT,
  reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH active_tables AS (
    SELECT
      da.table_id,
      da.id as assignment_id,
      da.pre_assigned_attendance_id,
      ROW_NUMBER() OVER (ORDER BY da.assigned_at ASC) as table_rank
    FROM dealer_assignments da
    INNER JOIN game_tables gt ON gt.id = da.table_id
    WHERE gt.club_id = p_club_id
      AND gt.shift_id = p_shift_id
      AND da.status = 'active'
      AND da.released_at IS NULL
  ),
  available_dealers AS (
    SELECT
      dat.id as attendance_id,
      dat.dealer_id,
      d.full_name,
      dat.priority_break_flag,
      dat.worked_minutes_since_last_break,
      CASE
        WHEN dat.priority_break_flag THEN 1000
        ELSE 0
      END - dat.worked_minutes_since_last_break as score,
      ROW_NUMBER() OVER (
        ORDER BY
          dat.priority_break_flag DESC,
          dat.worked_minutes_since_last_break ASC,
          RANDOM()
      ) as dealer_rank
    FROM dealer_attendance dat
    INNER JOIN dealers d ON d.id = dat.dealer_id
    WHERE d.club_id = p_club_id
      AND dat.shift_id = p_shift_id
      AND dat.current_state = 'available'
      AND dat.check_in_time IS NOT NULL
      AND dat.check_out_time IS NULL
  ),
  dealer_count AS (
    SELECT COUNT(*) as total FROM available_dealers
  ),
  predictions AS (
    SELECT
      t.table_id,
      CASE
        WHEN t.pre_assigned_attendance_id IS NOT NULL THEN
          (SELECT dealer_id FROM dealer_attendance WHERE id = t.pre_assigned_attendance_id)
        ELSE
          (SELECT dealer_id FROM available_dealers WHERE dealer_rank = t.table_rank LIMIT 1)
      END as predicted_dealer_id,
      CASE
        WHEN t.pre_assigned_attendance_id IS NOT NULL THEN
          (SELECT full_name FROM dealers WHERE id = (
            SELECT dealer_id FROM dealer_attendance WHERE id = t.pre_assigned_attendance_id
          ))
        ELSE
          (SELECT full_name FROM available_dealers WHERE dealer_rank = t.table_rank LIMIT 1)
      END as predicted_dealer_name,
      CASE
        WHEN t.pre_assigned_attendance_id IS NOT NULL THEN 'high'
        WHEN (SELECT total FROM dealer_count) >= t.table_rank THEN 'high'
        WHEN (SELECT total FROM dealer_count) >= 1 THEN 'medium'
        ELSE 'low'
      END as confidence,
      CASE
        WHEN t.pre_assigned_attendance_id IS NOT NULL THEN 'Pre-assigned'
        WHEN (SELECT total FROM dealer_count) = 0 THEN 'No dealers available'
        WHEN (SELECT total FROM dealer_count) < t.table_rank THEN 'Not enough dealers (need more)'
        WHEN (SELECT priority_break_flag FROM available_dealers WHERE dealer_rank = t.table_rank) THEN 'Priority break dealer'
        ELSE 'Least worked dealer'
      END as reason
    FROM active_tables t
  )
  SELECT * FROM predictions;
END;
$$;

GRANT EXECUTE ON FUNCTION public.predict_next_dealers(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.predict_next_dealers IS
  'Predicts next dealer for each active table. Table 1 gets best dealer, Table 2 gets second best, etc.';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'predict_next_dealers'
  ), 'predict_next_dealers function missing';
  RAISE NOTICE '✓ predict_next_dealers_fixed created';
END;
$$;

COMMIT;
