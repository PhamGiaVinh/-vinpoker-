-- =============================================================================
-- Migration: Fix TOCTOU Race — Add Retry Loop to Overload 1 Wrapper
--
-- Context:
--   Root cause #2 of swing failures: pickNextDealer finds a dealer (Time-of-Check),
--   but by the time perform_swing runs (Time-of-Use), another process (manual
--   assign, another swing tick) has already taken that dealer. The wrapper
--   silently falls through to the OT path = infinite loop.
--
--   Fix: When the caller-provided p_next_attendance_id is rejected because the
--   dealer is no longer available, retry by querying the pool directly (same
--   logic as pickNextDealer but inside the RPC, inside the same transaction,
--   eliminating the TOCTOU window entirely).
--
--   Key insight: The pool query uses FOR UPDATE SKIP LOCKED, which atomically
--   claims the next available dealer. If another transaction took them first,
--   SKIP LOCKED moves to the next candidate. This is the database-level fix
--   for the TOCTOU bug.
--
-- Signature: (p_assignment_id, p_duration_minutes, p_send_to_break,
--             p_break_duration_minutes, p_max_break_minutes, p_expected_version,
--             p_next_attendance_id)
-- =============================================================================

BEGIN;

-- Drop the existing wrapper
DROP FUNCTION IF EXISTS public.perform_swing(
  UUID, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID
);

CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id          UUID,
  p_duration_minutes       INTEGER,
  p_send_to_break          BOOLEAN DEFAULT false,
  p_break_duration_minutes INTEGER DEFAULT 15,
  p_max_break_minutes      INTEGER DEFAULT 60,
  p_expected_version       INTEGER DEFAULT NULL,
  p_next_attendance_id     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_attendance_id  UUID;
  v_table_id           UUID;
  v_club_id            UUID;
  v_shift_id           UUID;
  v_current_version    INT;
  v_ot_started_at      TIMESTAMPTZ;
  v_pre_assigned_id    UUID;
  v_next_attendance_id UUID;
  v_swing_result       JSONB;
  v_swing_due_at       TIMESTAMPTZ;
  v_retry_count        INT := 0;
  v_max_retries        CONSTANT INT := 3;
BEGIN
  -- ============================================================
  -- STEP 1: VALIDATE & LOCK OLD ASSIGNMENT
  -- ============================================================
  SELECT da.version, da.table_id, da.attendance_id, da.pre_assigned_attendance_id,
         da.overtime_started_at,
         gt.club_id,
         dat.shift_id
  INTO   v_current_version, v_table_id, v_old_attendance_id, v_pre_assigned_id,
         v_ot_started_at,
         v_club_id,
         v_shift_id
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  JOIN dealer_attendance dat ON dat.id = da.attendance_id
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.swing_processed_at IS NULL
  FOR UPDATE OF da;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'not_found',
      'message', 'Assignment not found or already swung'
    );
  END IF;

  -- Version guard (optimistic locking)
  IF p_expected_version IS NOT NULL AND v_current_version != p_expected_version THEN
    RETURN jsonb_build_object(
      'outcome', 'version_conflict',
      'message', 'Assignment was modified by another process',
      'expected_version', p_expected_version,
      'actual_version', v_current_version
    );
  END IF;

  -- ============================================================
  -- STEP 2: TRY PRE-ASSIGNED DEALER FIRST
  -- ============================================================
  v_next_attendance_id := NULL;

  IF v_pre_assigned_id IS NOT NULL THEN
    SELECT dat.id
    INTO   v_next_attendance_id
    FROM dealer_attendance dat
    WHERE dat.id = v_pre_assigned_id
      AND dat.current_state = 'pre_assigned'
    FOR UPDATE;
  END IF;

  -- ============================================================
  -- STEP 3: RACE-RESISTANT DEALER PICK
  -- ============================================================
  -- First try the caller-provided dealer (from pickNextDealer in process-swing).
  -- If that dealer was snatched by another process (TOCTOU), retry with a direct
  -- pool query using FOR UPDATE SKIP LOCKED — this eliminates the race window
  -- because the SELECT and lock happen in the same transaction.
  --
  -- The pool query mirrors pickNextDealer's Level 1 logic (available, checked_in,
  -- same shift, least worked first).

  <<dealer_pick>>
  LOOP
    -- Try caller-provided dealer (first attempt only)
    IF v_retry_count = 0 AND v_next_attendance_id IS NULL AND p_next_attendance_id IS NOT NULL THEN
      SELECT dat.id
      INTO   v_next_attendance_id
      FROM dealer_attendance dat
      WHERE dat.id = p_next_attendance_id
        AND dat.current_state = 'available'
        AND dat.status = 'checked_in'
      FOR UPDATE;
    END IF;

    -- If caller-provided dealer was snatched (TOCTOU) or never provided, query pool
    -- Note: club_id is on dealers table, not dealer_attendance
    IF v_next_attendance_id IS NULL THEN
      SELECT dat.id
      INTO   v_next_attendance_id
      FROM dealer_attendance dat
      JOIN dealers d ON d.id = dat.dealer_id
      WHERE d.club_id = v_club_id
        AND dat.shift_id = v_shift_id
        AND dat.current_state = 'available'
        AND dat.status = 'checked_in'
        AND dat.check_in_time IS NOT NULL
        AND dat.check_out_time IS NULL
        -- Exclude the outgoing dealer (can't swing to yourself)
        AND dat.id != v_old_attendance_id
      ORDER BY
        dat.worked_minutes_since_last_break ASC NULLS LAST,
        dat.priority_break_flag ASC,
        RANDOM()
      LIMIT 1
      FOR UPDATE SKIP LOCKED;
    END IF;

    -- Found a dealer → proceed to swing
    IF v_next_attendance_id IS NOT NULL THEN
      EXIT dealer_pick;
    END IF;

    -- No dealer found at any level
    IF v_retry_count >= v_max_retries THEN
      EXIT dealer_pick;
    END IF;

    v_retry_count := v_retry_count + 1;
  END LOOP;

  -- ============================================================
  -- STEP 4: OT PATH (no dealer available after all retries)
  -- ============================================================
  IF v_next_attendance_id IS NULL THEN
    IF v_ot_started_at IS NULL THEN
      UPDATE dealer_assignments
      SET overtime_started_at = NOW()
      WHERE id = p_assignment_id;
    END IF;

    RETURN jsonb_build_object(
      'outcome',              'no_dealer',
      'is_new_overtime',      (v_ot_started_at IS NULL),
      'overtime_started_at',  COALESCE(v_ot_started_at, NOW()),
      'retry_attempts',       v_retry_count
    );
  END IF;

  -- ============================================================
  -- STEP 5: DELEGATE TO 7-PARAM CORE ENGINE
  -- ============================================================
  v_swing_due_at := NOW() + (p_duration_minutes || ' minutes')::INTERVAL;

  SELECT public.perform_swing(
    p_assignment_id          := p_assignment_id,
    p_version                := COALESCE(p_expected_version, v_current_version),
    p_next_attendance_id     := v_next_attendance_id,
    p_send_to_break          := p_send_to_break,
    p_break_duration_minutes := p_break_duration_minutes,
    p_swing_duration_minutes := p_duration_minutes,
    p_swing_due_at           := v_swing_due_at
  ) INTO v_swing_result;

  RETURN v_swing_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.perform_swing(UUID, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID) TO service_role;

COMMENT ON FUNCTION public.perform_swing(UUID, INTEGER, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID) IS
  'Wrapper 7-param swing with p_max_break_minutes + TOCTOU retry. When caller-provided dealer is snatched, retries with direct SKIP LOCKED pool query to eliminate race window. Max 3 retries.';

COMMIT;
