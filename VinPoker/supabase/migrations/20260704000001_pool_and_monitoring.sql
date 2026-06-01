-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Dealer Pool Views + Escalation RPCs  — CORRECTED
--
-- Fixes from review:
--   [FIX-ORPHAN]      auto_close_low_priority_tables now releases dealers
--   [FIX-THRESHOLD]   shortage_close_threshold default = 4 (was 30 in plan)
--   [FIX-DOC]         dealer_pool_summary documented as monitoring-only
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Dealer pool summary — monitoring only ───────────────────────────────────
-- [FIX-DOC] This view is STALE by up to 60s. NEVER use for assignment decisions.

CREATE MATERIALIZED VIEW IF NOT EXISTS dealer_pool_summary AS
SELECT
  d.club_id,
  COUNT(*) FILTER (WHERE da.current_state = 'available')     AS available_count,
  COUNT(*) FILTER (WHERE da.current_state = 'pre_assigned')  AS pre_assigned_count,
  COUNT(*) FILTER (WHERE da.current_state = 'on_break')      AS on_break_count,
  COUNT(*) FILTER (WHERE da.current_state = 'assigned')      AS assigned_count,
  COUNT(*) FILTER (WHERE da.current_state = 'in_transition') AS in_transition_count,
  COUNT(*) FILTER (WHERE
    da.current_state = 'assigned'
    AND EXISTS (
      SELECT 1 FROM dealer_assignments das
      WHERE das.attendance_id = da.id
        AND das.overtime_started_at IS NOT NULL
        AND das.status = 'assigned'
    )
  )                                                           AS ot_count,
  COUNT(*)                                                    AS total_checked_in
FROM dealer_attendance da
JOIN dealers d ON d.id = da.dealer_id
WHERE da.status = 'checked_in'
GROUP BY d.club_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_summary_club
  ON dealer_pool_summary(club_id);

COMMENT ON MATERIALIZED VIEW dealer_pool_summary IS
  'MONITORING ONLY — stale up to 60s. Refreshed each process-swing cycle. '
  'Do NOT use for assignment logic (pickNextDealer, fillEmptyTables). '
  'For real-time counts, query dealer_attendance directly.';

CREATE OR REPLACE FUNCTION public.refresh_dealer_pool_summary()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY dealer_pool_summary;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_dealer_pool_summary() TO service_role;

-- ── 2. Auto-close low-priority tables — WITH dealer release ───────────────────
-- [FIX-ORPHAN] Closes table + ends active assignment + returns dealer to pool.
-- All in one atomic CTE — no partial state.

CREATE OR REPLACE FUNCTION public.auto_close_low_priority_tables(
  p_club_id    UUID,
  p_max_priority INT DEFAULT 2,
  p_limit      INT DEFAULT 3
)
RETURNS TABLE(table_id UUID, table_name TEXT, released_attendance_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.state_reason', 'auto_close_shortage', true);

  RETURN QUERY
  WITH closed_tables AS (
    UPDATE game_tables
    SET status = 'closed', updated_at = NOW()
    WHERE id IN (
      SELECT id FROM game_tables
      WHERE club_id = p_club_id
        AND status = 'active'
        AND table_priority <= p_max_priority
      ORDER BY table_priority ASC, updated_at ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, table_name
  ),
  ended_assignments AS (
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = NOW(),
        swing_processed_at = NOW()
    WHERE table_id IN (SELECT id FROM closed_tables)
      AND status = 'assigned'
    RETURNING attendance_id, table_id
  ),
  released_dealers AS (
    UPDATE dealer_attendance
    SET current_state = 'available',
        priority_break_flag = false
    WHERE id IN (SELECT attendance_id FROM ended_assignments)
    RETURNING id
  )
  SELECT ct.id, ct.table_name, ea.attendance_id
  FROM closed_tables ct
  LEFT JOIN ended_assignments ea ON ea.table_id = ct.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_low_priority_tables(UUID, INT, INT) TO service_role;

COMMENT ON FUNCTION public.auto_close_low_priority_tables IS
  'Atomically closes low-priority tables during dealer shortage. '
  'All three operations in one CTE — no orphaned dealers.';

-- ── 3. Club shortage settings ─────────────────────────────────────────────────
-- [FIX-THRESHOLD] Consistent default = 4 (4+ tables no_dealer = shortage)

ALTER TABLE club_settings
  ADD COLUMN IF NOT EXISTS shortage_auto_close_enabled  BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shortage_close_threshold     INT      NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS shortage_notify_telegram     BOOLEAN  NOT NULL DEFAULT true;

COMMENT ON COLUMN club_settings.shortage_close_threshold IS
  'Number of no_dealer results before triggering auto-close. Default 4.';

-- ── Verify ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_matviews
    WHERE schemaname = 'public' AND matviewname = 'dealer_pool_summary'
  ), 'dealer_pool_summary missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'auto_close_low_priority_tables'
  ), 'auto_close_low_priority_tables function missing';

  RAISE NOTICE '✓ Migration 20260704000001 passed all assertions';
END;
$$;

COMMIT;
