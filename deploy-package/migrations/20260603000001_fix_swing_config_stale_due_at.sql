-- =============================================================================
-- Migration: Fix swing_config duration change (Bug 2 — IMPROVED)
-- =============================================================================

CREATE OR REPLACE FUNCTION recalc_active_swing_due_at(p_club_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
BEGIN
  WITH to_update AS (
    SELECT da.id, da.assigned_at,
           sc.swing_duration_minutes,
           sc.pre_announce_minutes
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
  )
  UPDATE dealer_assignments da
  SET swing_due_at = to_update.assigned_at
                   + (to_update.swing_duration_minutes || ' minutes')::INTERVAL,
      pre_announce_due_at = to_update.assigned_at
                   + (to_update.swing_duration_minutes || ' minutes')::INTERVAL
                   - (to_update.pre_announce_minutes || ' minutes')::INTERVAL
  FROM to_update
  WHERE da.id = to_update.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO swing_audit_logs (club_id, action, details, triggered_by)
  VALUES (p_club_id, 'recalc_swing_due_at',
          jsonb_build_object('updated_count', v_updated, 'capped', v_updated >= 200),
          'system_trigger');
END;
$$;

CREATE OR REPLACE FUNCTION trg_swing_config_duration_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.swing_duration_minutes IS DISTINCT FROM NEW.swing_duration_minutes
     OR OLD.pre_announce_minutes IS DISTINCT FROM NEW.pre_announce_minutes
  THEN
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

DROP TRIGGER IF EXISTS trg_swing_config_duration_changed ON swing_config;

CREATE TRIGGER trg_swing_config_duration_changed
  AFTER UPDATE OF swing_duration_minutes, pre_announce_minutes
  ON swing_config
  FOR EACH ROW
  EXECUTE FUNCTION trg_swing_config_duration_changed();
