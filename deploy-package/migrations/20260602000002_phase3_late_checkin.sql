-- Phase 3 Task 3.1: Late check-in tracking
-- Bug: start_time::TIMESTAMPTZ cast uses current date, wrong for night shifts
-- Fix: (shift_date + start_time)::TIMESTAMPTZ combines correct date + time

-- Trigger function: log late check-in (>15 min) into swing_audit_logs
CREATE OR REPLACE FUNCTION func_log_late_checkin()
RETURNS TRIGGER AS $$
DECLARE
  v_late_min INTEGER;
  v_shift_start TIME;
  v_club_id UUID;
BEGIN
  IF NEW.status = 'checked_in' AND (OLD.status IS DISTINCT FROM 'checked_in') THEN
    SELECT ds.start_time, d.club_id
    INTO v_shift_start, v_club_id
    FROM dealer_shifts ds
    JOIN dealers d ON d.id = NEW.dealer_id
    WHERE ds.id = NEW.shift_id;

    IF v_shift_start IS NOT NULL THEN
      v_late_min := GREATEST(0, EXTRACT(EPOCH FROM (
        NEW.check_in_time - (NEW.shift_date + v_shift_start)::TIMESTAMPTZ
      )) / 60)::INTEGER;

      IF v_late_min > 15 THEN
        INSERT INTO swing_audit_logs(club_id, action, old_dealer_id, details, triggered_by)
        VALUES (
          v_club_id,
          'late_checkin',
          NEW.dealer_id,
          jsonb_build_object(
            'late_minutes', v_late_min,
            'shift_start', v_shift_start::TEXT,
            'shift_date', NEW.shift_date::TEXT,
            'attendance_id', NEW.id
          ),
          'system'
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on dealer_attendance
DROP TRIGGER IF EXISTS trg_log_late_checkin ON dealer_attendance;
CREATE TRIGGER trg_log_late_checkin
  AFTER INSERT OR UPDATE OF status ON dealer_attendance
  FOR EACH ROW EXECUTE FUNCTION func_log_late_checkin();

-- Index for late check-in reporting queries
DROP INDEX IF EXISTS idx_audit_late_checkin;
CREATE INDEX IF NOT EXISTS idx_audit_late_checkin
  ON swing_audit_logs(old_dealer_id, created_at DESC)
  WHERE action = 'late_checkin';
