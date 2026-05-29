-- Sprint 3.6: pre_assigned cleanup & fatigue protection
-- 1. Add pre_assigned_at to dealer_attendance for stale-lock detection
ALTER TABLE dealer_attendance
  ADD COLUMN IF NOT EXISTS pre_assigned_at TIMESTAMPTZ;

-- 2. Index for cleanup query (WHERE current_state = 'pre_assigned' AND pre_assigned_at < ...)
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_stale_pre_assigned
  ON dealer_attendance(pre_assigned_at)
  WHERE current_state = 'pre_assigned';

-- 3. Index for available dealers query (heavily used by pickNextDealer)
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_available
  ON dealer_attendance(current_state, shift_date)
  WHERE current_state IN ('available', 'pre_assigned');

-- 4. Track swing fallback reason (pre_assigned_lost, no_dealer, etc)
ALTER TABLE dealer_assignments
  ADD COLUMN IF NOT EXISTS swing_fallback_reason TEXT;

-- 5. Index for dealer_breaks swing_due_at queries
CREATE INDEX IF NOT EXISTS idx_dealer_breaks_break_end
  ON dealer_breaks(break_end DESC NULLS LAST);
