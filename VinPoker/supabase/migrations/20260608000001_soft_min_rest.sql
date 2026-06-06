-- ════════════════════════════════════════════════════════════════════════════
-- Migration 20260608000001_soft_min_rest.sql
-- Bàn 10 bug fix: enforce 10-min minimum rest by DELAYING swing_due_at
--   (not by skipping the dealer). Server-side rest calc via CTE on
--   dealer_assignments.released_at — atomic with FOR UPDATE lock, no TOCTOU.
--
-- Signature unchanged: callers (pass2-pre-assign.ts) pass same 4 args.
--   Return JSON extended with:
--     - dealer_id (audit)
--     - effective_swing_due_at (after delay)
--     - original_swing_due_at
--     - rest_deficit_min (delay applied, 0 = no delay)
--     - current_rest_min (informational)
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════
-- 1. Index for fast last-release lookup per attendance
-- ════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_attendance_released_at
  ON dealer_assignments (attendance_id, released_at DESC)
  WHERE released_at IS NOT NULL;

-- ════════════════════════════════════════════════════════
-- 2. Replace pre_assign_next_dealer_for_table
--    Same 4-arg signature. Server-side rest calc added in STEP 2d.
--    STEP 4 writes effective_swing_due_at (original + delay).
-- ════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pre_assign_next_dealer_for_table(
  p_assignment_id     uuid,
  p_club_id           uuid,
  p_next_attendance_id uuid,
  p_version           integer
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_assignment_version  INT;
  v_dealer_id           UUID;
  v_table_id            UUID;
  v_conflict_status     TEXT;
  v_conflict_table_id   UUID;
  v_current_rest_min    INT;
  v_min_rest_min        INT := 10;
  v_needed_delay_min    INT;
  v_original_due_at     TIMESTAMPTZ;
  v_effective_due_at    TIMESTAMPTZ;
BEGIN
  -- ════════════════════════════════════════════════════════════════════
  -- STEP 1: Lock + CAS-verify the assignment row
  -- ════════════════════════════════════════════════════════════════════

  SELECT version, table_id, swing_due_at
  INTO v_assignment_version, v_table_id, v_original_due_at
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND status = 'assigned'
    AND released_at IS NULL
    AND swing_processed_at IS NULL
    AND pre_assigned_attendance_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'race_lost',
      'detail', 'Assignment no longer active or already pre-assigned'
    );
  END IF;

  IF v_assignment_version != p_version THEN
    RETURN jsonb_build_object(
      'outcome', 'race_lost',
      'detail', format('Version mismatch: expected %s, got %s', p_version, v_assignment_version)
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 2: Check dealer availability BEFORE any writes
  -- ════════════════════════════════════════════════════════════════════

  PERFORM id
  FROM dealer_attendance
  WHERE id = p_next_attendance_id
    AND current_state = 'available'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', 'Dealer not in available state'
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 2b: Guard — dealer must NOT have an active assignment at a
  -- different table.
  -- ════════════════════════════════════════════════════════════════════

  SELECT dass.status, dass.table_id
  INTO v_conflict_status, v_conflict_table_id
  FROM dealer_assignments dass
  WHERE dass.attendance_id = p_next_attendance_id
    AND dass.status IN ('assigned', 'on_break', 'pre_assigned')
    AND dass.released_at IS NULL
    AND dass.table_id != v_table_id
  LIMIT 1;

  IF v_conflict_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', format('Dealer has active assignment at another table (status=%s, table=%s)',
        v_conflict_status, v_conflict_table_id::TEXT)
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 2c: Guard — dealer must NOT be pre-assigned to another table.
  -- ════════════════════════════════════════════════════════════════════

  SELECT dass.status, dass.table_id
  INTO v_conflict_status, v_conflict_table_id
  FROM dealer_assignments dass
  WHERE dass.pre_assigned_attendance_id = p_next_attendance_id
    AND dass.status IN ('assigned', 'on_break')
    AND dass.released_at IS NULL
    AND dass.table_id != v_table_id
  LIMIT 1;

  IF v_conflict_status IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', format('Dealer already pre-assigned to another table (status=%s, table=%s)',
        v_conflict_status, v_conflict_table_id::TEXT)
    );
  END IF;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 2d: Server-side rest calc (NEW for Bàn 10 bug fix)
  -- CTE on dealer_assignments.released_at — atomic within FOR UPDATE block.
  -- v_current_rest_min: minutes since this dealer's last release.
  --   999 if no prior release (first assignment of shift).
  -- v_needed_delay_min: how many minutes to delay swing_due_at
  --   to enforce v_min_rest_min (10 min).
  -- v_effective_due_at: original + delay.
  -- ════════════════════════════════════════════════════════════════════

  WITH last_release AS (
    SELECT MAX(released_at) AS last_released_at
    FROM dealer_assignments
    WHERE attendance_id = p_next_attendance_id
      AND released_at IS NOT NULL
  )
  SELECT COALESCE(
    EXTRACT(EPOCH FROM (NOW() - lr.last_released_at))::INT / 60,
    999
  ) INTO v_current_rest_min
  FROM last_release lr;

  v_needed_delay_min := GREATEST(0, v_min_rest_min - v_current_rest_min);
  v_effective_due_at := v_original_due_at + (v_needed_delay_min || ' minutes')::INTERVAL;

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 3: Set session context for audit trail
  -- ════════════════════════════════════════════════════════════════════

  PERFORM set_config(
    'app.state_reason',
    format('pass2_pre_assign_assignment_%s', p_assignment_id),
    true
  );

  -- ════════════════════════════════════════════════════════════════════
  -- STEP 4: Both locks acquired, all checks passed — now write.
  -- UPDATED: swing_due_at uses v_effective_due_at (original + delay).
  -- ════════════════════════════════════════════════════════════════════

  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = p_next_attendance_id,
    pre_assigned_at            = NOW(),
    swing_due_at               = v_effective_due_at,
    version                    = version + 1,
    updated_at                 = NOW()
  WHERE id = p_assignment_id
    AND version = p_version;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'race_lost',
      'detail', 'CAS update failed on assignment'
    );
  END IF;

  UPDATE dealer_attendance
  SET
    current_state          = 'pre_assigned',
    pre_assigned_table_id  = v_table_id,
    pre_assigned_at        = NOW()
  WHERE id = p_next_attendance_id
    AND current_state = 'available';

  IF NOT FOUND THEN
    UPDATE dealer_assignments
    SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      swing_due_at               = v_original_due_at,
      version                    = p_version,
      updated_at                 = NOW()
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', 'Dealer state changed between lock and update'
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome',                'pre_assigned',
    'dealer_id',              v_dealer_id,
    'effective_swing_due_at', v_effective_due_at,
    'original_swing_due_at',  v_original_due_at,
    'rest_deficit_min',       v_needed_delay_min,
    'current_rest_min',       v_current_rest_min
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'outcome', 'error',
      'detail', SQLERRM
    );
END;
$function$;

COMMENT ON FUNCTION public.pre_assign_next_dealer_for_table(uuid, uuid, uuid, integer)
  IS 'Pre-assign next dealer for table with soft 10-min rest enforcement. '
     || 'Returns effective_swing_due_at delayed by rest_deficit_min. '
     || 'No signature change; pass2-pre-assign.ts extended to read new fields.';
