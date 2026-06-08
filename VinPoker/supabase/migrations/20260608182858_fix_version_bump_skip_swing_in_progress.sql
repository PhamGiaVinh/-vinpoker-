-- Fix: bump_dealer_assignment_version should NOT increment version
-- when only swing_in_progress changes (lock/unlock cycle).
-- This caused version drift: each cron tick bumped version by 2,
-- eventually causing perform_swing's version check to fail permanently.

CREATE OR REPLACE FUNCTION public.bump_dealer_assignment_version()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Skip version bump if ONLY swing_in_progress changed (lock/unlock cycle)
  IF NEW.version = OLD.version  -- not already bumped by the UPDATE itself
     AND NEW.swing_in_progress IS DISTINCT FROM OLD.swing_in_progress
     AND NEW.status = OLD.status
     AND NEW.released_at IS NOT DISTINCT FROM OLD.released_at
     AND NEW.swing_processed_at IS NOT DISTINCT FROM OLD.swing_processed_at
     AND NEW.overtime_started_at IS NOT DISTINCT FROM OLD.overtime_started_at
     AND NEW.pre_assigned_attendance_id IS NOT DISTINCT FROM OLD.pre_assigned_attendance_id
     AND NEW.last_ot_alert_at IS NOT DISTINCT FROM OLD.last_ot_alert_at
  THEN
    NEW.updated_at := now();
    IF OLD.should_audit_version = true THEN
      INSERT INTO public.dealer_assignment_version_audit (
        row_id, old_version, new_version, old_status, new_status, app_state_reason
      ) VALUES (
        OLD.id, OLD.version, OLD.version, OLD.status, NEW.status,
        'trigger_skip_swing_lock' || COALESCE(': ' || current_setting('app.actor', true), '')
      );
    END IF;
    RETURN NEW;
  END IF;

  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  
  IF OLD.should_audit_version = true THEN
    INSERT INTO public.dealer_assignment_version_audit (
      row_id, old_version, new_version, old_status, new_status, app_state_reason
    ) VALUES (
      OLD.id, OLD.version, NEW.version, OLD.status, NEW.status,
      'trigger_bump' || COALESCE(': ' || current_setting('app.actor', true), '')
    );
  END IF;
  
  RETURN NEW;
END;
$function$;