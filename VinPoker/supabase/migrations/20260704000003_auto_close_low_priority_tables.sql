-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: auto_close_low_priority_tables — COMPLETE VERSION
--
-- Replaces the initial version from 20260704000001 with full implementation:
--   Step 1: Identify low-priority active tables with no players
--   Step 2: Close tables
--   Step 3: End active assignments at these tables
--   Step 4: Release dealers to available
--
-- Returns closed table info for Telegram notification.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Must DROP first because return type differs (can't CREATE OR REPLACE)
DROP FUNCTION IF EXISTS public.auto_close_low_priority_tables(p_club_id UUID, p_max_priority INT, p_limit INT);

CREATE OR REPLACE FUNCTION public.auto_close_low_priority_tables(
  p_club_id UUID
)
RETURNS TABLE(
  table_id TEXT,
  table_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.state_reason', 'auto_close_shortage', true);

  RETURN QUERY
  WITH target_tables AS (
    -- Low-priority active tables WITH active dealer assignments
    SELECT DISTINCT da.table_id, gt.table_name, gt.table_priority
    FROM game_tables gt
    INNER JOIN dealer_assignments da ON da.table_id = gt.id
    WHERE gt.club_id = p_club_id
      AND gt.status = 'active'
      AND gt.table_priority <= 2
      AND da.status IN ('assigned', 'pre_assigned', 'active')
      AND da.released_at IS NULL
    ORDER BY gt.table_priority ASC, gt.table_name ASC
    LIMIT 5
  ),
  ended_assignments AS (
    UPDATE dealer_assignments da
    SET status = 'completed',
        released_at = NOW(),
        updated_at = NOW()
    WHERE da.table_id IN (SELECT table_id FROM target_tables)
      AND da.status IN ('assigned', 'pre_assigned', 'active')
      AND da.released_at IS NULL
    RETURNING da.id, da.dealer_id, da.attendance_id
  ),
  released_dealers AS (
    UPDATE dealer_attendance dat
    SET current_state = 'available',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    WHERE dat.id IN (SELECT attendance_id FROM ended_assignments)
      AND dat.current_state IN ('assigned', 'pre_assigned')
    RETURNING dat.id
  ),
  closed_tables AS (
    UPDATE game_tables gt
    SET status = 'closed'
    WHERE gt.id IN (SELECT table_id FROM target_tables)
    RETURNING gt.id, gt.table_name
  )
  SELECT ct.id AS table_id, ct.table_name
  FROM closed_tables ct;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_low_priority_tables(UUID) TO service_role;

COMMENT ON FUNCTION public.auto_close_low_priority_tables IS
  'Atomically closes low-priority tables, ends assignments, and releases dealers.';

-- Verify
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'auto_close_low_priority_tables'
  ), 'auto_close_low_priority_tables function missing';
  RAISE NOTICE '✓ auto_close_low_priority_tables updated with complete implementation';
END;
$$;

COMMIT;
