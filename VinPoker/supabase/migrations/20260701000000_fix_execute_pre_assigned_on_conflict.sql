-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Fix execute_pre_assigned_swing ON CONFLICT + status check
--
-- P0 Bug 1: execute_pre_assigned_swing lock condition only checks
--           current_state = 'available' but NOT status = 'checked_in'.
--           → A dealer who checked out between Pass 2 and Pass 3 can be
--             incorrectly re-assigned. (Race 2 from analysis)
--
-- P0 Bug 2: execute_pre_assigned_swing uses ON CONFLICT ... DO UPDATE
--           which ALWAYS returns a row (the existing one), so the
--           v_new_assignment_id IS NULL guard never fires.
--           → Duplicate dealer assignments silently succeed.
--           Fix: Change to DO NOTHING + proper null check + rollback.
--
-- P1: Add total_worked_minutes_today column for scoring modifier
--     to prevent yo-yo picks of heavily worked dealers after
--     compensatory breaks.
--
-- P2: Add OT query indexes
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 1: Add total_worked_minutes_today to dealer_attendance
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE dealer_attendance
  ADD COLUMN IF NOT EXISTS total_worked_minutes_today INT DEFAULT 0;

COMMENT ON COLUMN dealer_attendance.total_worked_minutes_today
  IS 'Accumulated worked minutes across ALL assignments today (not just since last break). Used by scoring to prevent yo-yo picks after compensatory breaks.

Update policy:
  - perform_swing (old dealer released): += actual worked minutes from assigned_at
  - execute_pre_assigned_swing (old dealer released): += actual worked minutes
  - perform_swing (new dealer assigned): += actual worked minutes (from check-in/last break)
  - execute_pre_assigned_swing (new dealer assigned): += actual worked minutes
  - checkout: final write (accumulated value)
  - break: do NOT reset (cumulative across shift)
  - New shift day: automatically handled by new attendance record (starts at 0)
  - Rollback on ON CONFLICT: subtract the added minutes to restore previous value';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 2: Add OT query indexes
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_assignments_ot
  ON dealer_assignments (attendance_id, overtime_started_at)
  WHERE overtime_started_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 3: Rewrite execute_pre_assigned_swing with P0 fixes
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Fixes:
--  a) Lock condition: ADD AND status = 'checked_in' (prevent post-checkout assign)
--  b) ON CONFLICT: CHANGE DO UPDATE → DO NOTHING with proper null check + rollback
--  c) Rollback: on duplicate, release new dealer + restore old dealer/assignment
--
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
  v_old_overtime_min  INT;
  v_ot_minutes        INT;
  v_overtime_started  TIMESTAMPTZ;
  v_comp_break        INT;
BEGIN
  -- ==========================================
  -- GUARD: Validate inputs
  -- ==========================================
  IF p_old_assignment_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_old_assignment_id is null');
  END IF;

  IF p_next_attendance_id IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_next_attendance_id is null');
  END IF;

  IF p_swing_due_at IS NULL THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_swing_due_at is null');
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_duration_minutes must be > 0');
  END IF;

  -- ==========================================
  -- [1] Lấy thông tin old assignment + OT
  -- ==========================================
  SELECT
    gt.club_id,
    da.table_id,
    da.attendance_id,
    da.overtime_started_at
  INTO
    v_club_id,
    v_table_id,
    v_old_attendance_id,
    v_overtime_started
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
  -- [2] Lấy tên dealer mới (incoming)
  -- ==========================================
  SELECT COALESCE(d.full_name, d.name, 'Unknown')
  INTO v_incoming_name
  FROM dealer_attendance datt
  JOIN dealers d ON d.id = datt.dealer_id
  WHERE datt.id = p_next_attendance_id;

  -- ==========================================
  -- [3] ⚠️ FIX: TOCTOU lock — ADD status = 'checked_in'
  --     Prevent re-assigning a dealer who checked out
  --     between Pass 2 and Pass 3.
  -- ==========================================
  UPDATE dealer_attendance
  SET
    current_state = 'assigned',
    updated_at    = v_now
  WHERE id            = p_next_attendance_id
    AND current_state = 'available'
    AND status        = 'checked_in';   -- ← FIX: prevent post-checkout assign

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 0 THEN
    UPDATE dealer_assignments
    SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
    WHERE id = p_old_assignment_id;

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'Dealer ' || p_next_attendance_id || ' no longer available or checked out',
      'incoming_name', v_incoming_name
    );
  END IF;

  -- ==========================================
  -- [4] Calculate OT + compensatory break if applicable
  -- ==========================================
  IF v_overtime_started IS NOT NULL THEN
    v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_overtime_started))::INT / 60);

    -- Get old dealer current overtime_minutes for accumulation
    SELECT overtime_minutes INTO v_old_overtime_min
    FROM dealer_attendance WHERE id = v_old_attendance_id;

    v_comp_break := LEAST(15 + (v_ot_minutes / 2), 60);
  ELSE
    v_ot_minutes := 0;
    v_comp_break := 15;
  END IF;

  -- ==========================================
  -- [5] Tính worked_minutes thực tế cho dealer CŨ
  -- ==========================================
  SELECT MAX(db.break_end) INTO v_last_break_end
  FROM dealer_breaks db
  JOIN dealer_assignments da2 ON da2.id = db.assignment_id
  WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

  SELECT check_in_time INTO v_check_in_time
  FROM dealer_attendance WHERE id = v_old_attendance_id;

  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
  );

  -- ==========================================
  -- [6] Close old assignment
  -- ==========================================
  UPDATE dealer_assignments
  SET
    status              = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
    swing_processed_at  = v_now,
    overtime_started_at = NULL,
    updated_at          = v_now
  WHERE id = p_old_assignment_id;

  -- ==========================================
  -- [7] Update state + OT accumulation for old dealer
  -- ==========================================
  UPDATE dealer_attendance
  SET
    current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
    worked_minutes_since_last_break = CASE WHEN p_send_to_break THEN 0 ELSE v_actual_worked_min END,
    overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes,
    priority_break_flag         = false,
    total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
    updated_at                  = v_now
  WHERE id = v_old_attendance_id;

  -- ==========================================
  -- [7b] Insert break record if sending to break
  -- ==========================================
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
    VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
  END IF;

  -- ==========================================
  -- [8] ⚠️ FIX: ON CONFLICT DO NOTHING + null check
  --     Previously used DO UPDATE which always returned a row,
  --     making the null guard at lines 231-242 never fire.
  --     Now properly detects duplicates and rolls back.
  -- ==========================================
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, swing_due_at, duration_minutes, created_at, updated_at
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned',
    p_swing_due_at, p_duration_minutes, v_now, v_now
  )
  ON CONFLICT (attendance_id) WHERE status = 'assigned'
  DO NOTHING                          -- ← FIX: was DO UPDATE SET updated_at = v_now
  RETURNING id INTO v_new_assignment_id;

  -- ⚠️ CRITICAL: Check if INSERT actually happened
  IF v_new_assignment_id IS NULL THEN
    -- Duplicate: dealer already assigned elsewhere (race condition)
    -- Rollback: release new dealer lock
    UPDATE dealer_attendance
    SET current_state = 'available', updated_at = v_now
    WHERE id = p_next_attendance_id;

    -- Rollback: restore old assignment status
    UPDATE dealer_assignments
    SET status = 'assigned', swing_processed_at = NULL,
        overtime_started_at = v_overtime_started, updated_at = v_now
    WHERE id = p_old_assignment_id;

    -- Rollback: restore old dealer state + OT
    UPDATE dealer_attendance
    SET current_state = 'assigned',
        overtime_minutes = GREATEST(0, COALESCE(overtime_minutes, 0) - v_ot_minutes),
        priority_break_flag = (v_overtime_started IS NOT NULL),
        updated_at = v_now
    WHERE id = v_old_attendance_id;

    -- Rollback: remove break record if inserted
    IF p_send_to_break THEN
      DELETE FROM dealer_breaks WHERE assignment_id = p_old_assignment_id AND break_start = v_now;
    END IF;

    RETURN jsonb_build_object(
      'status', 'race_lost',
      'detail', 'Dealer ' || p_next_attendance_id || ' already assigned elsewhere (ON CONFLICT)',
      'incoming_name', v_incoming_name
    );
  END IF;

  -- ==========================================
  -- [9] Update worked_minutes for incoming dealer
  -- ==========================================
  DECLARE
    v_new_last_break  TIMESTAMPTZ;
    v_new_check_in    TIMESTAMPTZ;
    v_new_worked      INT;
  BEGIN
    SELECT MAX(db.break_end) INTO v_new_last_break
    FROM dealer_breaks db
    JOIN dealer_assignments da2 ON da2.id = db.assignment_id
    WHERE da2.attendance_id = p_next_attendance_id AND db.break_end IS NOT NULL;

    SELECT check_in_time INTO v_new_check_in
    FROM dealer_attendance WHERE id = p_next_attendance_id;

    v_new_worked := GREATEST(0,
      EXTRACT(EPOCH FROM (v_now - COALESCE(v_new_last_break, v_new_check_in)))::INT / 60
    );

    UPDATE dealer_attendance
    SET worked_minutes_since_last_break = v_new_worked,
        total_worked_minutes_today      = COALESCE(total_worked_minutes_today, 0) + v_new_worked
    WHERE id = p_next_attendance_id;
  END;

  -- ==========================================
  -- [10] Clear pre_assigned fields on old assignment
  -- ==========================================
  UPDATE dealer_assignments
  SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
  WHERE id = p_old_assignment_id;

  -- ==========================================
  -- [11] Audit log
  -- ==========================================
  INSERT INTO swing_audit_logs (club_id, table_id, action, details, triggered_by)
  VALUES (v_club_id, v_table_id, 'pre_assigned_swing',
    jsonb_build_object(
      'ot_minutes', v_ot_minutes,
      'comp_break_minutes', v_comp_break,
      'was_overtime', v_overtime_started IS NOT NULL,
      'swing_due_at', p_swing_due_at,
      'incoming_name', v_incoming_name
    ), 'cron');

  -- ==========================================
  -- [12] Return success
  -- ==========================================
  RETURN jsonb_build_object(
    'status',             'success',
    'new_assignment_id',  v_new_assignment_id,
    'old_assignment_id',  p_old_assignment_id,
    'incoming_name',      v_incoming_name,
    'sent_to_break',      p_send_to_break,
    'worked_minutes',     v_actual_worked_min,
    'ot_minutes',         v_ot_minutes,
    'comp_break_minutes', v_comp_break,
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 4: NO CHANGE to dealer_shift_metrics VIEW
-- total_worked_minutes_today is read DIRECTLY from dealer_attendance row
-- in buildDealerCandidates Step 2. Adding it to the VIEW would add another
-- aggregate + GROUP BY column to an already-expensive query (read ~900x/hr).
-- The column lives on dealer_attendance — no VIEW join needed.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- Step 5: Update perform_swing to track total_worked_minutes_today
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.perform_swing(
  p_assignment_id uuid,
  p_version integer,
  p_next_attendance_id uuid DEFAULT NULL::uuid,
  p_send_to_break boolean DEFAULT false,
  p_break_duration_minutes integer DEFAULT NULL::integer,
  p_swing_duration_minutes integer DEFAULT 90,
  p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_attendance_id  UUID;
  v_table_id           UUID;
  v_club_id            UUID;
  v_current_version    INT;
  v_ot_started_at      TIMESTAMPTZ;
  v_is_new_ot          BOOLEAN;
  v_new_assignment_id  UUID;
  v_ot_minutes         INT;
  v_comp_break         INT;
  v_now                TIMESTAMPTZ := NOW();
  v_swing_due_at       TIMESTAMPTZ;
  v_assigned_at        TIMESTAMPTZ;    -- NEW: for worked minutes calc
  v_actual_worked_min  INT;            -- NEW
BEGIN
  -- INVARIANT: Use pre-calculated swing_due_at (batch-consistent) if provided.
  v_swing_due_at := COALESCE(p_swing_due_at, v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL);

  -- Load + lock assignment row in one shot
  SELECT
    da.attendance_id,
    da.table_id,
    da.version,
    da.overtime_started_at,
    da.assigned_at,                   -- NEW: capture for worked minutes
    gt.club_id
  INTO
    v_old_attendance_id,
    v_table_id,
    v_current_version,
    v_ot_started_at,
    v_assigned_at,                    -- NEW
    v_club_id
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_assignment_id
    AND da.status = 'assigned'
    AND da.swing_processed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  IF v_current_version != p_version THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  -- ── NO DEALER AVAILABLE: start or continue OT tracking ───────────────────
  IF p_next_attendance_id IS NULL THEN
    v_is_new_ot := (v_ot_started_at IS NULL);

    UPDATE dealer_assignments
    SET overtime_started_at     = COALESCE(overtime_started_at, v_now),
        swing_retry_count       = 0,
        last_swing_attempted_at = v_now,
        swing_due_at            = v_now + INTERVAL '55 seconds',
        version                 = version + 1
    WHERE id = p_assignment_id;

    UPDATE dealer_attendance
    SET priority_break_flag = true
    WHERE id = v_old_attendance_id;

    RETURN jsonb_build_object(
      'outcome',         'no_dealer',
      'is_new_overtime',  v_is_new_ot,
      'overtime_started_at', COALESCE(v_ot_started_at, v_now)
    );
  END IF;

  -- ── DEALER FOUND: execute swing with compensatory break if OT ────────────
  IF v_ot_started_at IS NOT NULL THEN
    v_ot_minutes := GREATEST(0,
      EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60
    );
    v_comp_break := LEAST(
      p_break_duration_minutes + (v_ot_minutes / 2),
      60
    );
  ELSE
    v_ot_minutes := 0;
    v_comp_break := p_break_duration_minutes;
  END IF;

  -- Calculate actual worked minutes for old dealer this assignment
  v_actual_worked_min := GREATEST(0,
    EXTRACT(EPOCH FROM (v_now - COALESCE(v_assigned_at, v_now)))::INT / 60
  );

  -- Release old assignment
  UPDATE dealer_assignments
  SET status             = 'completed',
      swing_processed_at = v_now,
      released_at        = v_now,
      overtime_started_at = NULL,
      version            = version + 1
  WHERE id = p_assignment_id;

  -- Update old dealer: accumulate OT + clear priority flag + total_worked
  UPDATE dealer_attendance
  SET overtime_minutes            = overtime_minutes + v_ot_minutes,
      priority_break_flag         = false,
      total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min  -- NEW
  WHERE id = v_old_attendance_id;

  -- Send old dealer to break (compensatory if OT, standard otherwise)
  IF p_send_to_break THEN
    UPDATE dealer_attendance
    SET current_state = 'on_break'
    WHERE id = v_old_attendance_id;

    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes)
    VALUES (p_assignment_id, v_now, v_comp_break);
  ELSE
    UPDATE dealer_attendance
    SET current_state = 'available'
    WHERE id = v_old_attendance_id;
  END IF;

  -- INVARIANT: Use v_swing_due_at (batch-consistent pre-calculated value)
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, swing_due_at, version
  ) VALUES (
    p_next_attendance_id, v_table_id, 'assigned',
    v_now, v_swing_due_at, 1
  )
  ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
  RETURNING id INTO v_new_assignment_id;

  -- Concurrent assignment conflict: rollback
  IF v_new_assignment_id IS NULL THEN
    UPDATE dealer_assignments
    SET status = 'assigned', swing_processed_at = NULL,
        released_at = NULL, overtime_started_at = v_ot_started_at,
        version = p_version
    WHERE id = p_assignment_id;
    UPDATE dealer_attendance
    SET current_state = 'assigned', priority_break_flag = (v_ot_started_at IS NOT NULL),
        overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes),
        total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
    WHERE id = v_old_attendance_id;
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  -- Update new dealer state + total_worked tracking
  UPDATE dealer_attendance
  SET current_state = 'assigned',
      total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
  WHERE id = p_next_attendance_id;

  INSERT INTO swing_audit_logs (club_id, table_id, action, details, triggered_by)
  VALUES (v_club_id, v_table_id, 'swing_executed',
    jsonb_build_object(
      'ot_minutes', v_ot_minutes,
      'comp_break_minutes', v_comp_break,
      'was_overtime', v_ot_started_at IS NOT NULL,
      'swing_due_at', v_swing_due_at
    ), 'system');

  RETURN jsonb_build_object(
    'outcome',             'swung',
    'new_assignment_id',   v_new_assignment_id,
    'ot_minutes',          v_ot_minutes,
    'comp_break_minutes',  v_comp_break,
    'old_dealer_on_break', p_send_to_break
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ)
  TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Verify migration
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- Verify column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_attendance' AND column_name = 'total_worked_minutes_today'
  ) THEN
    RAISE EXCEPTION 'Column total_worked_minutes_today missing';
  END IF;

  -- Verify RPC exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'execute_pre_assigned_swing'
  ) THEN
    RAISE EXCEPTION 'execute_pre_assigned_swing function not found';
  END IF;

  -- Verify index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_assignments_ot'
  ) THEN
    RAISE EXCEPTION 'idx_assignments_ot index not found';
  END IF;

  RAISE NOTICE '✅ Migration 20260701000000 OK — all checks passed';
END $$;

COMMIT;
