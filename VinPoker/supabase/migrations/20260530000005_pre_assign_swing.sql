-- Sprint 3.5: Pre-assign dealer 6 phút trước swing + auto-fill bàn trống

-- 1. Thêm state pre_assigned để lock dealer đang được reserve
ALTER TABLE dealer_attendance
  DROP CONSTRAINT IF EXISTS dealer_attendance_current_state_check,
  ADD CONSTRAINT dealer_attendance_current_state_check
    CHECK (current_state IN ('available', 'assigned', 'on_break', 'checked_out', 'pre_assigned'));

-- 2. Biết dealer đang được reserve cho bàn nào
ALTER TABLE dealer_attendance
  ADD COLUMN IF NOT EXISTS pre_assigned_table_id UUID REFERENCES game_tables(id);

-- 3. Pre-assign columns trên dealer_assignments
ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS pre_assigned_attendance_id UUID REFERENCES dealer_attendance(id),
  ADD COLUMN IF NOT EXISTS pre_assigned_at TIMESTAMPTZ;

-- 4. Index cho Pass 2 (pre-assign pending)
CREATE INDEX IF NOT EXISTS idx_assignments_pre_assign_pending
  ON dealer_assignments(swing_due_at)
  WHERE status = 'assigned'
    AND pre_assigned_attendance_id IS NULL
    AND swing_processed_at IS NULL;

-- 5. Index cho Pass 3 (pre-assign ready to execute)
CREATE INDEX IF NOT EXISTS idx_assignments_pre_assign_ready
  ON dealer_assignments(swing_due_at)
  WHERE status = 'assigned'
    AND pre_assigned_attendance_id IS NOT NULL
    AND swing_processed_at IS NULL;

-- 6. Index cho Pass 1 (auto-fill bàn trống)
DROP INDEX IF EXISTS idx_game_tables_status_active;
CREATE INDEX IF NOT EXISTS idx_game_tables_status_active
  ON game_tables(id) WHERE status = 'active';

-- 7. RPC: execute_pre_assigned_swing
CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
  p_old_assignment_id UUID,
  p_old_version       INTEGER,
  p_club_id           UUID,
  p_triggered_by      TEXT DEFAULT 'cron'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_rec         dealer_assignments%ROWTYPE;
  v_pre_att_id      UUID;
  v_pre_att_rec     dealer_attendance%ROWTYPE;
  v_new_assignment_id UUID;
  v_table_name      TEXT;
  v_old_dealer_name TEXT;
BEGIN
  -- 1. Lock old assignment (CAS)
  SELECT da.* INTO v_old_rec
  FROM dealer_assignments da
  WHERE da.id = p_old_assignment_id
    AND da.version = p_old_version
    AND da.status = 'assigned'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'race_lost');
  END IF;

  v_pre_att_id := v_old_rec.pre_assigned_attendance_id;

  -- Get table name and old dealer name for logging
  SELECT gt.table_name INTO v_table_name
  FROM game_tables gt WHERE gt.id = v_old_rec.table_id;

  SELECT d.full_name INTO v_old_dealer_name
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.id = v_old_rec.attendance_id;

  -- 2. Verify pre-assigned dealer còn valid
  IF v_pre_att_id IS NOT NULL THEN
    SELECT * INTO v_pre_att_rec
    FROM dealer_attendance
    WHERE id = v_pre_att_id
      AND current_state = 'pre_assigned'
    FOR UPDATE;

    IF NOT FOUND THEN
      -- Dealer đã mất → signal caller để fallback
      UPDATE dealer_assignments
      SET pre_assigned_attendance_id = NULL,
          pre_assigned_at = NULL
      WHERE id = p_old_assignment_id;

      RETURN jsonb_build_object(
        'status', 'pre_assigned_lost',
        'table_name', v_table_name,
        'old_dealer_name', v_old_dealer_name
      );
    END IF;
  END IF;

  -- 3. Release old assignment
  UPDATE dealer_assignments
  SET status = 'completed',
      released_at = NOW(),
      swing_processed_at = NOW(),
      version = version + 1
  WHERE id = p_old_assignment_id;

  -- 4. Reset old dealer → available
  UPDATE dealer_attendance
  SET current_state = 'available'
  WHERE id = v_old_rec.attendance_id;

  -- 5. Create new assignment nếu có pre-assigned dealer
  IF v_pre_att_id IS NOT NULL THEN
    INSERT INTO dealer_assignments(
      table_id, attendance_id, assigned_at, status, version,
      idempotency_key
    )
    VALUES (
      v_old_rec.table_id, v_pre_att_id, NOW(), 'assigned', 1,
      'pre-swing-' || p_old_assignment_id || '-' || extract(epoch FROM NOW())
    )
    RETURNING id INTO v_new_assignment_id;

    -- 6. Activate new dealer
    UPDATE dealer_attendance
    SET current_state = 'assigned',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    WHERE id = v_pre_att_id;
  END IF;

  -- 7. Audit log
  INSERT INTO public.swing_audit_logs(
    club_id, table_id, action, old_dealer_id, new_dealer_id,
    details, triggered_by
  )
  VALUES (
    p_club_id, v_old_rec.table_id,
    CASE WHEN v_pre_att_id IS NOT NULL THEN 'pre_assigned_swing' ELSE 'swung_no_dealer' END,
    v_old_rec.attendance_id, v_pre_att_id,
    jsonb_build_object('table_name', v_table_name, 'old_dealer_name', v_old_dealer_name),
    p_triggered_by
  );

  RETURN jsonb_build_object(
    'status', CASE WHEN v_pre_att_id IS NOT NULL THEN 'swung' ELSE 'swung_no_dealer' END,
    'new_assignment_id', v_new_assignment_id,
    'table_name', v_table_name
  );
END;
$$;


