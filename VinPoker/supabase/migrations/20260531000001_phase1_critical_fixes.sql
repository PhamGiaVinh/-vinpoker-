-- Phase 1: Critical fixes (trigger, unique constraint, floor_manager_chat_id)

-- 1. Fix trigger func_calc_swing_due_at — JOIN qua game_tables, không self-join dealer_assignments
CREATE OR REPLACE FUNCTION trg_calc_swing_due_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_duration INT;
  v_pre_announce INT;
BEGIN
  SELECT sc.swing_duration_minutes, sc.pre_announce_minutes
  INTO v_duration, v_pre_announce
  FROM game_tables gt
  JOIN swing_config sc ON sc.club_id = gt.club_id AND sc.table_type = gt.table_type
  WHERE gt.id = NEW.table_id
  LIMIT 1;

  NEW.swing_due_at := NEW.assigned_at + (COALESCE(v_duration, 45) || ' minutes')::INTERVAL;
  NEW.pre_announce_due_at := NEW.swing_due_at - (COALESCE(v_pre_announce, 10) || ' minutes')::INTERVAL;

  RETURN NEW;
END;
$$;

-- 2. Unique constraint: mỗi bàn chỉ 1 dealer active
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_assignment
  ON dealer_assignments(table_id) WHERE status = 'assigned';

-- 3. Floor manager chat ID trong club_settings
ALTER TABLE club_settings
  ADD COLUMN IF NOT EXISTS floor_manager_chat_id TEXT;

-- 4. Index để tìm available/pre_assigned dealers nhanh hơn
DROP INDEX IF EXISTS idx_dealer_attendance_available;
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_available
  ON dealer_attendance(current_state, shift_date)
  WHERE current_state IN ('available', 'pre_assigned');

-- 5. Index cho stale pre_assigned cleanup (dùng pre_assigned_at, có sẵn từ migration 20260530000006)
DROP INDEX IF EXISTS idx_dealer_attendance_stale_pre_assigned;
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_pre_assigned_stale
  ON dealer_attendance(pre_assigned_at)
  WHERE current_state = 'pre_assigned';

-- 6. Index cho dealer_breaks query (minutesSinceRest)
DROP INDEX IF EXISTS idx_dealer_breaks_break_end;
CREATE INDEX IF NOT EXISTS idx_dealer_breaks_assignment_end
  ON dealer_breaks(assignment_id, break_end DESC NULLS LAST);
