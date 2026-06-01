-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: fix_pre_assign_next_dealer_for_table
--
-- Bugfixes:
--   1. Removed p_shift_id (shift_id is NULL for most attendances)
--   2. Changed caller interface: caller uses pickNextDealer() + passes candidate
--      (p_next_attendance_id + p_version) instead of self-picking via scoring
--   3. Fixed status IN ('assigned', 'active') → status = 'assigned'
--   4. Added swing_processed_at IS NULL guard
--   5. Added dealer_unavailable outcome (check-before-write pattern)
--   6. Fixed pre_assigned_table_id type safety (was casting UUID→TEXT→UUID)
--
-- Design notes:
--   - pre_assigned_table_id on dealer_attendance is denormalized for
--     execute_pre_assigned_swing cleanup and stale-detection queries.
--     Canonical source of truth remains dealer_assignments.pre_assigned_attendance_id.
--     Both are updated in the same atomic RPC transaction — no drift.
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drop the old overload with the (club_id, shift_id, assignment_id, table_id) signature
DROP FUNCTION IF EXISTS public.pre_assign_next_dealer_for_table(
  p_club_id UUID, p_shift_id UUID, p_assignment_id UUID, p_table_id TEXT
);

CREATE OR REPLACE FUNCTION public.pre_assign_next_dealer_for_table(
  p_assignment_id      UUID,
  p_club_id            UUID,
  p_next_attendance_id UUID,
  p_version            INT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_version INT;
  v_dealer_id          UUID;
  v_table_id           UUID;
BEGIN
  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 1: Lock + CAS-verify the assignment row
  -- If the assignment is no longer active / already pre-assigned / swung,
  -- bail immediately — nothing has been written yet.
  -- ══════════════════════════════════════════════════════════════════════

  SELECT version, table_id
  INTO v_assignment_version, v_table_id
  FROM dealer_assignments
  WHERE id = p_assignment_id
    AND status = 'assigned'                 -- ✅ correct status value
    AND released_at IS NULL
    AND swing_processed_at IS NULL
    AND pre_assigned_attendance_id IS NULL  -- not already pre-assigned
  FOR UPDATE;                               -- lock row for the tx duration

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

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 2: Check dealer availability BEFORE any writes
  -- Pattern: check-before-write — if dealer is not available, return
  -- immediately without having written anything. No rollback needed.
  -- ══════════════════════════════════════════════════════════════════════

  PERFORM id
  FROM dealer_attendance
  WHERE id = p_next_attendance_id
    AND current_state = 'available'
  FOR UPDATE;  -- lock the dealer row too

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', 'Dealer not in available state'
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 3: Set session context for audit trail
  -- ══════════════════════════════════════════════════════════════════════

  PERFORM set_config(
    'app.state_reason',
    format('pass2_pre_assign_assignment_%s', p_assignment_id),
    true
  );

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 4: Both locks acquired, all checks passed — now write.
  -- ══════════════════════════════════════════════════════════════════════

  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = p_next_attendance_id,
    pre_assigned_at = NOW(),
    version = version + 1,
    updated_at = NOW()
  WHERE id = p_assignment_id
    AND version = p_version;  -- Double-check CAS (safety net)

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'race_lost',
      'detail', 'CAS update failed on assignment'
    );
  END IF;

  UPDATE dealer_attendance
  SET
    current_state = 'pre_assigned',
    pre_assigned_table_id = v_table_id,
    pre_assigned_at = NOW()
  WHERE id = p_next_attendance_id
    AND current_state = 'available';  -- Safety guard (row-level check)

  IF NOT FOUND THEN
    -- Dealer state changed between STEP 2 FOR UPDATE and this UPDATE
    -- (highly improbable due to row lock, but guard for correctness)
    -- Roll back the assignment UPDATE to avoid partial state
    UPDATE dealer_assignments
    SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at = NULL,
      version = p_version,
      updated_at = NOW()
    WHERE id = p_assignment_id;

    RETURN jsonb_build_object(
      'outcome', 'dealer_unavailable',
      'detail', 'Dealer state changed between lock and update'
    );
  END IF;

  -- ══════════════════════════════════════════════════════════════════════
  -- STEP 5: Trigger fires on dealer_attendance (available → pre_assigned)
  --         which inserts audit_logs row automatically.
  -- ══════════════════════════════════════════════════════════════════════

  RETURN jsonb_build_object(
    'outcome', 'pre_assigned'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'outcome', 'error',
      'detail', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pre_assign_next_dealer_for_table(UUID, UUID, UUID, INT) TO service_role;

COMMENT ON FUNCTION public.pre_assign_next_dealer_for_table IS
  'Atomically pre-assigns a dealer to a table assignment. Caller uses pickNextDealer + passes candidate. Returns: pre_assigned | race_lost | dealer_unavailable | error';

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'pre_assign_next_dealer_for_table'
  ), 'pre_assign_next_dealer_for_table function missing';
  RAISE NOTICE '✓ pre_assign_next_dealer_for_table fixed (CAS + check-before-write)';
END;
$$;

COMMIT;
