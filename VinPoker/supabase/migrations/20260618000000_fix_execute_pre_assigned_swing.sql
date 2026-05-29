-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Fix execute_pre_assigned_swing RPC
-- 
-- P0 Fix: param names + response key consistency
-- P1 Fix: add swing_due_at, duration_minutes, incoming_name, ON CONFLICT
-- P2 Fix: add send_to_break support with break record creation
-- ═══════════════════════════════════════════════════════════════════════════════

-- Step 1: Add duration_minutes column (if not exists)
ALTER TABLE dealer_assignments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- Step 2: Drop old overloads
-- Current signature: execute_pre_assigned_swing(p_old_assignment_id UUID, p_old_version INTEGER, p_club_id UUID, p_triggered_by TEXT DEFAULT 'cron')
DROP FUNCTION IF EXISTS public.execute_pre_assigned_swing(UUID, INTEGER, UUID, TEXT);

-- Step 3: Create new RPC
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id   UUID,
  p_next_attendance_id  UUID,
  p_swing_due_at        TIMESTAMPTZ,
  p_duration_minutes    INT,
  p_send_to_break       BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now               TIMESTAMPTZ := NOW();
  v_club_id           UUID;
  v_table_id          UUID;
  v_old_attendance_id UUID;
  v_new_assignment_id UUID;
  v_rows_updated      INT;
  v_actual_worked_min INT;
  v_last_break_end    TIMESTAMPTZ;
  v_check_in_time     TIMESTAMPTZ;
  v_incoming_name     TEXT;
BEGIN
  -- ==========================================
  -- GUARD: Validate inputs
  -- ==========================================
  IF p_old_assignment_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error',  'INVALID_INPUT: p_old_assignment_id is null'
    );
  END IF;

  IF p_next_attendance_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error',  'INVALID_INPUT: p_next_attendance_id is null'
    );
  END IF;

  IF p_swing_due_at IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error',  'INVALID_INPUT: p_swing_due_at is null'
    );
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error',  'INVALID_INPUT: p_duration_minutes must be > 0'
    );
  END IF;

  -- ==========================================
  -- [1] Lấy thông tin old assignment
  -- ==========================================
  SELECT
    gt.club_id,
    da.table_id,
    da.attendance_id
  INTO
    v_club_id,
    v_table_id,
    v_old_attendance_id
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_old_assignment_id
    AND da.status = 'assigned';

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error',  'OLD_ASSIGNMENT_NOT_FOUND_OR_NOT_ASSIGNED',
      'detail', p_old_assignment_id
    );
  END IF;

  -- ==========================================
  -- [2] Lấy tên dealer mới (incoming) — P1 fix
  -- ==========================================
  SELECT COALESCE(d.full_name, d.name, 'Unknown')
  INTO v_incoming_name
  FROM dealer_attendance datt
  JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  -- ==========================================
  -- [3] TOCTOU Fix: Atomic lock dealer mới
  --     Verify + update trong 1 statement
  -- ==========================================
  UPDATE dealer_attendance
  SET
    current_state = 'assigned',
    updated_at    = v_now
  WHERE id            = p_next_attendance_id
    AND current_state = 'available';   -- Atomic check

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    -- Dealer không còn available (race condition)
    -- Clear pre-assign để cycle sau không retry
    UPDATE dealer_assignments
    SET
      pre_assigned_attendance_id = NULL,
      pre_assigned_at            = NULL,
      updated_at                 = v_now
    WHERE id = p_old_assignment_id;

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'Dealer ' || p_next_attendance_id || ' no longer available',
      'incoming_name', v_incoming_name
    );
  END IF;

  -- ==========================================
  -- [4] Tính worked_minutes thực tế cho dealer CŨ
  -- ==========================================
  SELECT MAX(db.break_end)
  INTO v_last_break_end
  FROM dealer_breaks db
  JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id
    AND db.break_end IS NOT NULL;

  SELECT check_in_time
  INTO v_check_in_time
  FROM dealer_attendance
  WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(
    0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  -- ==========================================
  -- [5] Close assignment cũ — P2 fix: on_break nếu send_to_break
  -- ==========================================
  UPDATE dealer_assignments
  SET
    status              = CASE
                            WHEN p_send_to_break THEN 'on_break'
                            ELSE 'completed'
                          END,
    swing_processed_at  = v_now,
    updated_at          = v_now
  WHERE id = p_old_assignment_id;

  -- ==========================================
  -- [6] Update state dealer CŨ — P2 fix
  -- ==========================================
  UPDATE dealer_attendance
  SET
    current_state = CASE
                      WHEN p_send_to_break THEN 'on_break'
                      ELSE 'available'
                    END,
    worked_minutes_since_last_break = CASE
                                        WHEN p_send_to_break THEN 0
                                        ELSE v_actual_worked_min
                                      END,
    updated_at = v_now
  WHERE id = v_old_attendance_id;

  -- ==========================================
  -- [6b] Nếu send_to_break → insert break record — P2 fix
  -- ==========================================
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (
      assignment_id,
      break_start,
      expected_duration_minutes,
      reason,
      created_at
    ) VALUES (
      p_old_assignment_id,
      v_now,
      15,
      'auto_break_on_swing',
      v_now
    );
  END IF;

  -- ==========================================
  -- [7] Insert assignment MỚI — P1 fix
  --     swing_due_at + duration_minutes từ application
  --     ON CONFLICT guard bằng unique index
  -- ==========================================
  INSERT INTO dealer_assignments (
    attendance_id,
    table_id,
    status,
    swing_due_at,
    duration_minutes,
    created_at,
    updated_at
  ) VALUES (
    p_next_attendance_id,
    v_table_id,
    'assigned',
    p_swing_due_at,
    p_duration_minutes,
    v_now,
    v_now
  )
  ON CONFLICT (attendance_id) WHERE status = 'assigned'
  DO UPDATE SET
    updated_at = v_now
  RETURNING id INTO v_new_assignment_id;

  -- ==========================================
  -- [8] Update worked_minutes dealer MỚI
  -- ==========================================
  DECLARE
    v_new_last_break  TIMESTAMPTZ;
    v_new_check_in    TIMESTAMPTZ;
    v_new_worked      INT;
  BEGIN
    SELECT MAX(db.break_end)
    INTO v_new_last_break
    FROM dealer_breaks db
    JOIN dealer_assignments da2 ON da2.id = db.assignment_id
    WHERE da2.attendance_id = p_next_attendance_id
      AND db.break_end IS NOT NULL;

    SELECT check_in_time
    INTO v_new_check_in
    FROM dealer_attendance
    WHERE id = p_next_attendance_id;

    v_new_worked := GREATEST(
      0,
      EXTRACT(EPOCH FROM (v_now - COALESCE(v_new_last_break, v_new_check_in)))::INT / 60
    );

    UPDATE dealer_attendance
    SET worked_minutes_since_last_break = v_new_worked
    WHERE id = p_next_attendance_id;
  END;

  -- ==========================================
  -- [9] Clear pre_assigned fields trên old assignment
  -- ==========================================
  UPDATE dealer_assignments
  SET
    pre_assigned_attendance_id = NULL,
    pre_assigned_at            = NULL,
    updated_at                 = v_now
  WHERE id = p_old_assignment_id;

  -- ==========================================
  -- [10] Return success — P0 fix: key là "status"
  -- ==========================================
  RETURN jsonb_build_object(
    'status',             'success',
    'new_assignment_id',  v_new_assignment_id,
    'old_assignment_id',  p_old_assignment_id,
    'incoming_name',      v_incoming_name,
    'sent_to_break',      p_send_to_break,
    'worked_minutes',     v_actual_worked_min,
    'swing_due_at',       p_swing_due_at,
    'duration_minutes',   p_duration_minutes
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status',   'error',
    'error',    'UNHANDLED_EXCEPTION',
    'detail',   SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;

-- Step 3: Verify function signature
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'execute_pre_assigned_swing'
  ) THEN
    RAISE EXCEPTION 'execute_pre_assigned_swing function not found after migration';
  END IF;
END $$;

-- === Test guards (expected: error responses, NOT crashes) ===

-- Test 1: null old assignment → error
SELECT execute_pre_assigned_swing(
  NULL::UUID,
  '00000000-0000-0000-0000-000000000001'::UUID,
  NOW() + INTERVAL '30 minutes',
  30,
  false
);

-- Test 2: fake old assignment (non-existent) → OLD_ASSIGNMENT_NOT_FOUND
SELECT execute_pre_assigned_swing(
  '00000000-0000-0000-0000-000000000000'::UUID,
  '00000000-0000-0000-0000-000000000001'::UUID,
  NOW() + INTERVAL '30 minutes',
  30,
  false
);
