-- =============================================================================
-- Fix: recalc_active_swing_due_at must NEVER increase remaining time
-- Bug: changing swing_config reset swing_due_at = assigned_at + new_duration,
--      destroying progress (e.g. 1 min remaining → 25 min remaining)
-- Fix: only shorten remaining time (floor 1 min), never extend it
-- =============================================================================

-- 1. Fix recalc_active_swing_due_at: preserve remaining time
CREATE OR REPLACE FUNCTION recalc_active_swing_due_at(p_club_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
BEGIN
  WITH to_update AS (
    SELECT da.id,
           da.assigned_at,
           da.swing_due_at AS old_swing_due_at,
           sc.pre_announce_minutes,
           gt.club_id,
           gt.table_type,
           calculate_dynamic_swing_duration(gt.club_id, gt.table_type) AS new_duration_min
    FROM dealer_assignments da
    JOIN game_tables gt ON gt.id = da.table_id AND gt.club_id = p_club_id
    JOIN swing_config sc ON sc.club_id = gt.club_id
                        AND sc.table_type = gt.table_type
    WHERE da.status = 'assigned'
      AND da.swing_processed_at IS NULL
      AND da.pre_assigned_attendance_id IS NULL
    ORDER BY da.assigned_at ASC
    LIMIT 200
    FOR UPDATE OF da SKIP LOCKED
  ),
  calculated AS (
    SELECT id,
           old_swing_due_at,
           assigned_at + (new_duration_min || ' minutes')::INTERVAL AS proposed_due_at,
           pre_announce_minutes,
           CASE
             WHEN assigned_at + (new_duration_min || ' minutes')::INTERVAL > old_swing_due_at
             THEN old_swing_due_at
             ELSE GREATEST(assigned_at + (new_duration_min || ' minutes')::INTERVAL, NOW() + INTERVAL '1 minute')
           END AS final_due_at
    FROM to_update
  )
  UPDATE dealer_assignments da
  SET swing_due_at = calculated.final_due_at,
      pre_announce_due_at = calculated.final_due_at
                         - (calculated.pre_announce_minutes || ' minutes')::INTERVAL
  FROM calculated
  WHERE da.id = calculated.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO swing_audit_logs (club_id, action, details, triggered_by)
  VALUES (p_club_id, 'recalc_swing_due_at',
          jsonb_build_object('updated_count', v_updated, 'capped', v_updated >= 200, 'mode', 'preserve_remaining'),
          'system_trigger');
END;
$$;

-- 2. Fix trg_swing_config_duration_changed: also react to dynamic param changes
CREATE OR REPLACE FUNCTION trg_swing_config_duration_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config_changed BOOLEAN := false;
BEGIN
  v_config_changed := OLD.swing_duration_minutes IS DISTINCT FROM NEW.swing_duration_minutes
                    OR OLD.pre_announce_minutes IS DISTINCT FROM NEW.pre_announce_minutes
                    OR OLD.auto_adjust_duration IS DISTINCT FROM NEW.auto_adjust_duration
                    OR OLD.base_duration_minutes IS DISTINCT FROM NEW.base_duration_minutes
                    OR OLD.target_ratio IS DISTINCT FROM NEW.target_ratio
                    OR OLD.min_duration_minutes IS DISTINCT FROM NEW.min_duration_minutes
                    OR OLD.max_duration_minutes IS DISTINCT FROM NEW.max_duration_minutes;

  IF v_config_changed THEN
    IF OLD.pre_announce_minutes IS DISTINCT FROM NEW.pre_announce_minutes THEN
      UPDATE dealer_assignments da
      SET pre_announced = false
      WHERE da.status = 'assigned'
        AND da.swing_processed_at IS NULL
        AND da.pre_assigned_attendance_id IS NULL
        AND da.swing_due_at > NOW()
        AND da.table_id IN (
          SELECT gt.id FROM game_tables gt WHERE gt.club_id = NEW.club_id
        );
    END IF;

    PERFORM recalc_active_swing_due_at(NEW.club_id);
  END IF;

  RETURN NEW;
END;
$$;