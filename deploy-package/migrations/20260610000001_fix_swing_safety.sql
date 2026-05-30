-- =============================================================================
-- Migration: Fix swing safety — no-release on no-dealer, retry counter,
--             distributed cron lock, matching RPC param names
-- =============================================================================

-- ── Part 1: Add tracking columns to dealer_assignments ──────────────────────

ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS swing_retry_count        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_swing_attempted_at  TIMESTAMPTZ;

COMMENT ON COLUMN dealer_assignments.swing_retry_count IS
  'Incremented each time perform_swing finds no replacement dealer. Max 3 before swing_skipped.';
COMMENT ON COLUMN dealer_assignments.last_swing_attempted_at IS
  'Set on each failed attempt (no dealer). Used to deduplicate retries within a cron tick.';

-- Add swing_skipped to the status CHECK constraint if one exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'dealer_assignments' AND column_name = 'status'
  ) THEN
    ALTER TABLE dealer_assignments
      DROP CONSTRAINT IF EXISTS dealer_assignments_status_check;
    ALTER TABLE dealer_assignments
      ADD CONSTRAINT dealer_assignments_status_check
        CHECK (status IN ('assigned', 'on_break', 'completed', 'swing_skipped'));
  END IF;
END $$;

-- ── Part 2: Distributed cron lock table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS club_processing_locks (
  club_id     UUID        PRIMARY KEY,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Acquire: insert with expiry, fail silently if held by another instance
CREATE OR REPLACE FUNCTION try_acquire_club_lock(p_club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO club_processing_locks (club_id, expires_at)
  VALUES (p_club_id, NOW() + INTERVAL '90 seconds')
  ON CONFLICT (club_id) DO UPDATE
    SET club_id = EXCLUDED.club_id
    WHERE club_processing_locks.expires_at < NOW()
  RETURNING TRUE;
$$;

-- Release: delete the lock row
CREATE OR REPLACE FUNCTION release_club_lock(p_club_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM club_processing_locks WHERE club_id = p_club_id;
$$;

GRANT EXECUTE ON FUNCTION try_acquire_club_lock(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION release_club_lock(UUID) TO service_role;

-- ── Part 3: Rewrite perform_swing RPC — matching edge function param names ──

DROP FUNCTION IF EXISTS perform_swing(
  p_old_assignment_id UUID, p_old_version INT, p_old_attendance_id UUID,
  p_new_attendance_id UUID, p_table_id UUID, p_club_id UUID, p_shift_id UUID,
  p_swing_reason TEXT, p_should_break BOOLEAN, p_break_reason TEXT,
  p_break_duration INT, p_new_dealer_id UUID, p_idempotency_key TEXT,
  p_triggered_by TEXT, p_table_name TEXT, p_old_dealer_name TEXT,
  p_new_dealer_name TEXT
);

CREATE OR REPLACE FUNCTION perform_swing(
  p_assignment_id         UUID,
  p_version               INT,
  p_next_attendance_id    UUID,     -- NULL = no replacement found
  p_send_to_break         BOOLEAN,
  p_break_duration_minutes INT,
  p_swing_duration_minutes INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old         RECORD;
  v_now         TIMESTAMPTZ := NOW();
  v_new_att_id  UUID;
  v_title       TEXT;
  v_max_retries CONSTANT INT := 3;
BEGIN
  -- Load current assignment WITH lock (FOR UPDATE — not SKIP LOCKED)
  -- We MUST wait if another session is processing this exact assignment
  SELECT da.id, da.attendance_id, da.table_id, da.status,
         da.swing_retry_count, da.last_swing_attempted_at, da.version,
         da.swing_due_at,
         da.pre_assigned_attendance_id, da.pre_assigned_at,
         gt.table_name, gt.club_id,
         d.full_name AS old_dealer_name,
         da2.dealer_id AS old_dealer_id
  INTO v_old
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  JOIN dealer_attendance da2 ON da2.id = da.attendance_id
  JOIN dealers d ON d.id = da2.dealer_id
  WHERE da.id = p_assignment_id
    AND da.version = p_version
    AND da.status = 'assigned'
    AND da.swing_processed_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  v_title := v_old.table_name;

  -- ── CASE 1: No replacement dealer available ──────────────────────────────
  IF p_next_attendance_id IS NULL THEN
    -- Exceeded max retries → mark as swing_skipped (zombie kill)
    IF v_old.swing_retry_count >= v_max_retries THEN
      UPDATE dealer_assignments
      SET status = 'swing_skipped',
          swing_processed_at = v_now,
          last_swing_attempted_at = v_now
      WHERE id = p_assignment_id;

      INSERT INTO swing_audit_logs (club_id, shift_id, assignment_id, table_id, action, details)
      VALUES (v_old.club_id, NULL, p_assignment_id, v_old.table_id, 'swing_skipped',
        jsonb_build_object('table_name', v_title, 'retry_count', v_old.swing_retry_count,
                           'reason', 'no_dealer_after_max_retries'));

      RETURN jsonb_build_object('outcome', 'swing_skipped',
        'table_name', v_title, 'retry_count', v_old.swing_retry_count);
    END IF;

    -- Not yet maxed out → increment counter, push swing_due_at forward
    -- so the next cron tick doesn't immediately re-pick this same assignment
    UPDATE dealer_assignments
    SET swing_retry_count = swing_retry_count + 1,
        last_swing_attempted_at = v_now,
        swing_due_at = v_now + INTERVAL '90 seconds'
    WHERE id = p_assignment_id;

    INSERT INTO swing_audit_logs (club_id, shift_id, assignment_id, table_id, action, details)
    VALUES (v_old.club_id, NULL, p_assignment_id, v_old.table_id, 'swing_no_dealer',
      jsonb_build_object('table_name', v_title, 'retry_count', v_old.swing_retry_count + 1,
                         'reason', 'no_dealer_retrying'));

    RETURN jsonb_build_object('outcome', 'no_dealer',
      'table_name', v_title, 'retry_count', v_old.swing_retry_count + 1);
  END IF;

  -- ── CASE 2: Replacement found — execute swing ────────────────────────────

  -- 2a. Release old assignment
  UPDATE dealer_assignments
  SET status = 'completed',
      released_at = v_now,
      swing_processed_at = v_now,
      version = version + 1
  WHERE id = p_assignment_id;

  -- 2b. Free old dealer (or send to break)
  IF p_send_to_break THEN
    INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason)
    VALUES (p_assignment_id, v_now, p_break_duration_minutes, 'swing_break');

    UPDATE dealer_attendance
    SET current_state = 'on_break',
        priority_break_flag = false
    WHERE id = v_old.attendance_id;
  ELSE
    UPDATE dealer_attendance
    SET current_state = 'available'
    WHERE id = v_old.attendance_id;
  END IF;

  -- 2c. Assign new dealer — insert WITH idempotency_key to prevent duplicates
  INSERT INTO dealer_assignments (
    attendance_id, table_id, status, assigned_at, swing_due_at, version,
    idempotency_key
  )
  VALUES (
    p_next_attendance_id, v_old.table_id, 'assigned', v_now,
    v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL,
    1,
    'swing-' || p_assignment_id || '-' || v_old.swing_retry_count
  )
  ON CONFLICT ON CONSTRAINT idx_unique_active_attendance DO NOTHING;

  IF NOT FOUND THEN
    -- Incoming dealer was already assigned elsewhere (race)
    -- Rollback: restore old assignment
    UPDATE dealer_assignments
    SET status = 'assigned',
        swing_processed_at = NULL,
        released_at = NULL,
        version = version - 1
    WHERE id = p_assignment_id;

    UPDATE dealer_attendance
    SET current_state = 'assigned'
    WHERE id = v_old.attendance_id;

    RETURN jsonb_build_object('outcome', 'conflict',
      'table_name', v_title, 'message', 'Incoming dealer already assigned elsewhere');
  END IF;

  -- 2d. Mark incoming dealer as assigned
  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_next_attendance_id;

  SELECT full_name INTO v_new_att_id FROM dealers
  JOIN dealer_attendance ON dealers.id = dealer_attendance.dealer_id
  WHERE dealer_attendance.id = p_next_attendance_id;

  -- 2e. Audit log
  INSERT INTO swing_audit_logs (club_id, shift_id, assignment_id, table_id,
    action, old_dealer_id, new_dealer_id, details)
  VALUES (v_old.club_id, NULL, p_assignment_id, v_old.table_id,
    'swing_success',
    v_old.old_dealer_id,
    (SELECT dealer_id FROM dealer_attendance WHERE id = p_next_attendance_id),
    jsonb_build_object('table_name', v_title,
      'old_dealer_name', v_old.old_dealer_name,
      'new_dealer_name', v_new_att_id));

  RETURN jsonb_build_object('outcome', 'swung',
    'table_name', v_title,
    'old_dealer_on_break', p_send_to_break);
END;
$$;

-- ── Part 4: Rewrite execute_pre_assigned_swing RPC ──────────────────────────

DROP FUNCTION IF EXISTS execute_pre_assigned_swing(
  p_old_assignment_id UUID, p_old_version INT, p_club_id UUID, p_triggered_by TEXT
);

CREATE OR REPLACE FUNCTION execute_pre_assigned_swing(
  p_assignment_id  UUID,
  p_version        INT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old             RECORD;
  v_pre_att_rec     RECORD;
  v_now             TIMESTAMPTZ := NOW();
  v_new_assignment_id UUID;
  v_title           TEXT;
  v_max_retries     CONSTANT INT := 3;
BEGIN
  -- Lock the assignment row
  SELECT da.*, gt.table_name, gt.club_id
  INTO v_old
  FROM dealer_assignments da
  JOIN game_tables gt ON gt.id = da.table_id
  WHERE da.id = p_assignment_id
    AND da.version = p_version
    AND da.status = 'assigned'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  v_title := v_old.table_name;

  -- Verify pre-assigned dealer
  IF v_old.pre_assigned_attendance_id IS NOT NULL THEN
    SELECT * INTO v_pre_att_rec
    FROM dealer_attendance
    WHERE id = v_old.pre_assigned_attendance_id
      AND current_state = 'pre_assigned'
      AND status = 'checked_in'
    FOR UPDATE;

    IF NOT FOUND THEN
      -- Pre-assigned dealer lost → clear pre_assign, caller will fallback
      UPDATE dealer_assignments
      SET pre_assigned_attendance_id = NULL,
          pre_assigned_at = NULL
      WHERE id = p_assignment_id;

      RETURN jsonb_build_object('outcome', 'pre_assigned_lost',
        'table_name', v_title);
    END IF;
  ELSE
    -- No pre-assigned dealer at all → same as lost
    RETURN jsonb_build_object('outcome', 'pre_assigned_lost',
      'table_name', v_title);
  END IF;

  -- ── Execute pre-assigned swing ────────────────────────────────────────────

  UPDATE dealer_assignments
  SET status = 'completed',
      released_at = v_now,
      swing_processed_at = v_now,
      version = version + 1
  WHERE id = p_assignment_id;

  UPDATE dealer_attendance
  SET current_state = 'available'
  WHERE id = v_old.attendance_id;

  INSERT INTO dealer_assignments (
    table_id, attendance_id, assigned_at, status, version, idempotency_key
  )
  VALUES (
    v_old.table_id, v_old.pre_assigned_attendance_id, v_now, 'assigned', 1,
    'pre-swing-' || p_assignment_id || '-' || extract(epoch FROM v_now)
  )
  RETURNING id INTO v_new_assignment_id;

  UPDATE dealer_attendance
  SET current_state = 'assigned',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
  WHERE id = v_old.pre_assigned_attendance_id;

  INSERT INTO swing_audit_logs (club_id, table_id, action, details)
  VALUES (v_old.club_id, v_old.table_id, 'pre_assigned_swing',
    jsonb_build_object('table_name', v_title));

  RETURN jsonb_build_object('outcome', 'swung',
    'table_name', v_title,
    'new_assignment_id', v_new_assignment_id);
END;
$$;

-- ── Part 5: Timezone support ────────────────────────────────────────────────

ALTER TABLE club_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';

CREATE OR REPLACE FUNCTION club_local_date(p_club_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT (NOW() AT TIME ZONE COALESCE(
    (SELECT timezone FROM club_settings WHERE club_id = p_club_id),
    'Asia/Ho_Chi_Minh'
  ))::DATE;
$$;

GRANT EXECUTE ON FUNCTION club_local_date(UUID) TO service_role;
