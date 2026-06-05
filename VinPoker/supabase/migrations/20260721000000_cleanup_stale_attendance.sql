-- =============================================================================
-- Migration: Cleanup Stale Attendance Records
--
-- Context:
--   Root cause of "Bàn 100 swing lúc 04:11 +590:43 OT" — 17 stale attendance
--   records (11 'assigned' + 6 'pre_assigned') with check_out_time IS NULL
--   from 1.8 to 3.8 days ago falsely poison the busyDealerIds check in
--   pickNextDealer.ts, making the pool appear permanently empty.
--
-- Changes:
--   1. cleanup_stale_attendance(club_id) RPC — transitions zombie records to
--      'checked_out' state with an estimated checkout time (preserving audit trail)
--   2. Scheduled daily cleanup via pg_cron
--   3. Unique index preventing NEW stale records from accumulating
-- =============================================================================

BEGIN;

-- ===========================================================================
-- 1. cleanup_stale_attendance RPC
-- ===========================================================================
--   Closes attendance records that were left in assigned/pre_assigned/in_transition
-- for > 24 hours without a proper checkout. Instead of silently deleting,
-- we set them to 'checked_out' state with estimated checkout time.
--
-- Parameters:
--   p_club_id               UUID        — target club (NULL = all clubs)
--   p_stale_threshold_hours INTEGER     — default 24 hours
--
-- Returns:
--   JSON summary of cleaned records
-- ===========================================================================

CREATE OR REPLACE FUNCTION cleanup_stale_attendance(
  p_club_id               UUID DEFAULT NULL,
  p_stale_threshold_hours INTEGER DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cutoff       TIMESTAMPTZ;
  v_cleaned      INT := 0;
  v_dealer_ids   UUID[];
  v_result       JSONB;
BEGIN
  v_cutoff := NOW() - (p_stale_threshold_hours || ' hours')::INTERVAL;

  -- Collect affected dealer IDs for reporting
  -- Join through dealers to get club_id (not on dealer_attendance directly)
  SELECT ARRAY_AGG(DISTINCT da.dealer_id)
  INTO v_dealer_ids
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE (p_club_id IS NULL OR d.club_id = p_club_id)
    AND da.check_out_time IS NULL
    AND da.check_in_time < v_cutoff
    AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition');

  -- Release any dangling assignments attached to these stale attendances
  WITH released_assignments AS (
    UPDATE dealer_assignments da2
    SET
      status = 'completed',
      released_at = NOW(),
      swing_processed_at = COALESCE(swing_processed_at, NOW()),
      updated_at = NOW()
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    WHERE da2.attendance_id = da.id
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
      AND da.check_out_time IS NULL
      AND da.check_in_time < v_cutoff
      AND da.current_state IN ('assigned', 'pre_assigned', 'in_transition')
      AND da2.released_at IS NULL
      AND da2.status = 'assigned'
    RETURNING da2.id
  )
  SELECT COUNT(*) INTO v_cleaned FROM released_assignments;

  -- Mark stale attendances as 'abandoned' with estimated checkout
  UPDATE dealer_attendance
  SET
    current_state  = 'checked_out',
    status         = 'checked_out',
    check_out_time = check_in_time + INTERVAL '8 hours'  -- assume 8h shift
  FROM dealers d
  WHERE d.id = dealer_attendance.dealer_id
    AND (p_club_id IS NULL OR d.club_id = p_club_id)
    AND dealer_attendance.check_out_time IS NULL
    AND dealer_attendance.check_in_time < v_cutoff
    AND dealer_attendance.current_state IN ('assigned', 'pre_assigned', 'in_transition');

  v_result := jsonb_build_object(
    'cleaned_assignments', v_cleaned,
    'affected_dealers',    COALESCE(array_length(v_dealer_ids, 1), 0),
    'threshold_hours',     p_stale_threshold_hours,
    'cutoff',              v_cutoff,
    'dealer_ids',          COALESCE(v_dealer_ids, ARRAY[]::UUID[])
  );

  RAISE NOTICE '[cleanup_stale_attendance] % assignments released, % dealers affected',
    v_cleaned, COALESCE(array_length(v_dealer_ids, 1), 0);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_stale_attendance(UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION cleanup_stale_attendance IS
  'Closes attendance records stuck in assigned/pre_assigned/in_transition for >24h.
   Transitions them to "checked_out" status with estimated checkout = check_in + 8h.
   Run periodically to prevent zombie records from poisoning dealer pool selection.';

-- ===========================================================================
-- 2. Scheduled daily cleanup via pg_cron (6 AM club time)
-- ===========================================================================
SELECT cron.schedule(
  'cleanup-stale-attendance',
  '0 6 * * *',
  $$SELECT cleanup_stale_attendance(NULL, 24)$$
);

-- ===========================================================================
-- 3. Partial unique index: only 1 active attendance per dealer per club
-- ===========================================================================
-- Prevents NEW stale records from accumulating in future.
-- Note: dealer_id only (club_id not available on dealer_attendance)
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_attendance_per_dealer
  ON dealer_attendance (dealer_id)
  WHERE check_out_time IS NULL
    AND status = 'checked_in'
    AND current_state IN ('assigned', 'pre_assigned', 'in_transition');

COMMIT;
