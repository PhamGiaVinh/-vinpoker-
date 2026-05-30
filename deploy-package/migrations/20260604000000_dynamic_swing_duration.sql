-- =============================================================================
-- Migration: Dynamic Swing Duration (Auto-Adjust)
-- =============================================================================

-- 1. Extend swing_config
ALTER TABLE swing_config
  ADD COLUMN IF NOT EXISTS auto_adjust_duration   BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_duration_minutes  INT      NOT NULL DEFAULT 30
                           CHECK (base_duration_minutes BETWEEN 10 AND 120),
  ADD COLUMN IF NOT EXISTS target_ratio           NUMERIC(4,2) NOT NULL DEFAULT 1.20
                           CHECK (target_ratio > 0),
  ADD COLUMN IF NOT EXISTS min_duration_minutes   INT      NOT NULL DEFAULT 20
                           CHECK (min_duration_minutes >= 5),
  ADD COLUMN IF NOT EXISTS max_duration_minutes   INT      NOT NULL DEFAULT 60
                           CHECK (max_duration_minutes <= 180);

ALTER TABLE swing_config
  ADD CONSTRAINT chk_duration_range
    CHECK (min_duration_minutes < base_duration_minutes
       AND base_duration_minutes < max_duration_minutes);

-- 2. RPC: calculate_dynamic_swing_duration(p_club_id, p_table_type)
-- Weighted pool: available × 1.0 + pre_assigned × 0.5 (on_break/assigned excluded)
-- Formula: BASE / CLAMP(ratio / target_ratio, min_factor, max_factor)
-- Returns fixed swing_duration_minutes when auto_adjust is OFF
CREATE OR REPLACE FUNCTION calculate_dynamic_swing_duration(
  p_club_id UUID,
  p_table_type TEXT DEFAULT 'tournament'
)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_cfg           RECORD;
  v_weighted_pool NUMERIC;
  v_active_tables INT;
  v_ratio         NUMERIC;
  v_factor        NUMERIC;
  v_duration      NUMERIC;
  v_min_factor    NUMERIC;
  v_max_factor    NUMERIC;
BEGIN
  SELECT * INTO v_cfg
  FROM swing_config
  WHERE club_id = p_club_id AND table_type = p_table_type;

  IF NOT FOUND THEN RETURN 45; END IF;
  IF NOT v_cfg.auto_adjust_duration THEN RETURN v_cfg.swing_duration_minutes; END IF;

  SELECT COUNT(*) INTO v_active_tables
  FROM game_tables
  WHERE club_id = p_club_id AND status = 'active';

  IF v_active_tables = 0 THEN RETURN v_cfg.base_duration_minutes; END IF;

  SELECT
    COUNT(*) FILTER (WHERE da.current_state = 'available')    * 1.0 +
    COUNT(*) FILTER (WHERE da.current_state = 'pre_assigned') * 0.5
  INTO v_weighted_pool
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.status = 'checked_in'
    AND da.shift_date = CURRENT_DATE;

  IF v_weighted_pool = 0 THEN RETURN v_cfg.max_duration_minutes; END IF;

  v_ratio      := v_weighted_pool / v_active_tables;
  v_min_factor := v_cfg.base_duration_minutes::NUMERIC / v_cfg.max_duration_minutes;
  v_max_factor := v_cfg.base_duration_minutes::NUMERIC / v_cfg.min_duration_minutes;
  v_factor     := LEAST(GREATEST(v_ratio / v_cfg.target_ratio, v_min_factor), v_max_factor);
  v_duration   := v_cfg.base_duration_minutes::NUMERIC / v_factor;

  RETURN ROUND(LEAST(GREATEST(v_duration, v_cfg.min_duration_minutes), v_cfg.max_duration_minutes))::INT;
END;
$$;

-- 3. Monitoring view for frontend
CREATE OR REPLACE VIEW v_club_swing_status AS
SELECT
  sc.club_id,
  sc.table_type,
  sc.auto_adjust_duration,
  sc.swing_duration_minutes          AS fixed_duration,
  sc.base_duration_minutes,
  sc.min_duration_minutes,
  sc.max_duration_minutes,
  sc.target_ratio,
  COUNT(gt.id)                        AS active_tables,
  SUM(CASE WHEN da.current_state = 'available'    THEN 1   ELSE 0 END) AS available_dealers,
  SUM(CASE WHEN da.current_state = 'pre_assigned' THEN 0.5 ELSE 0 END) AS pre_assigned_weighted,
  calculate_dynamic_swing_duration(sc.club_id, sc.table_type) AS effective_duration_minutes
FROM swing_config sc
LEFT JOIN game_tables gt
  ON gt.club_id = sc.club_id AND gt.status = 'active'
LEFT JOIN dealers d
  ON d.club_id = sc.club_id
LEFT JOIN dealer_attendance da
  ON da.dealer_id = d.id
 AND da.status = 'checked_in'
 AND da.shift_date = CURRENT_DATE
WHERE sc.table_type = 'tournament'
GROUP BY sc.club_id, sc.table_type,
         sc.auto_adjust_duration, sc.swing_duration_minutes,
         sc.base_duration_minutes, sc.min_duration_minutes,
         sc.max_duration_minutes, sc.target_ratio;

-- 4. Updated trigger: passthrough pattern + UPDATE support
--    On INSERT with swing_due_at pre-set → no-op
--    On INSERT without swing_due_at → compute via RPC or fixed config fallback
--    On UPDATE OF assigned_at → always recalculate
CREATE OR REPLACE FUNCTION trg_calc_swing_due_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_table_type  TEXT;
  v_club_id     UUID;
  v_duration    INT;
  v_pre_announce INT;
BEGIN
  -- Passthrough: if Edge Function provided swing_due_at on INSERT, skip
  IF TG_OP = 'INSERT' AND NEW.swing_due_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve club + table type
  SELECT gt.club_id, gt.table_type
  INTO v_club_id, v_table_type
  FROM game_tables gt
  WHERE gt.id = NEW.table_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Use RPC (handles both auto_adjust ON → dynamic, OFF → fixed)
  v_duration := calculate_dynamic_swing_duration(v_club_id, v_table_type);

  NEW.swing_due_at := NEW.assigned_at + (v_duration || ' minutes')::INTERVAL;

  -- pre_announce_due_at
  SELECT sc.pre_announce_minutes INTO v_pre_announce
  FROM swing_config sc
  WHERE sc.club_id = v_club_id AND sc.table_type = v_table_type;

  IF FOUND AND v_pre_announce IS NOT NULL THEN
    NEW.pre_announce_due_at := NEW.swing_due_at - (v_pre_announce || ' minutes')::INTERVAL;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create trigger preserving UPDATE OF assigned_at
DROP TRIGGER IF EXISTS trg_dealer_assignment_due_at ON dealer_assignments;
CREATE TRIGGER trg_dealer_assignment_due_at
  BEFORE INSERT OR UPDATE OF assigned_at ON dealer_assignments
  FOR EACH ROW
  EXECUTE FUNCTION trg_calc_swing_due_at();

-- 5. Update recalc_active_swing_due_at to use dynamic RPC
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
           sc.pre_announce_minutes,
           gt.club_id,
           gt.table_type
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
                   + (calculate_dynamic_swing_duration(to_update.club_id, to_update.table_type) || ' minutes')::INTERVAL,
      pre_announce_due_at = to_update.assigned_at
                   + (calculate_dynamic_swing_duration(to_update.club_id, to_update.table_type) || ' minutes')::INTERVAL
                   - (to_update.pre_announce_minutes || ' minutes')::INTERVAL
  FROM to_update
  WHERE da.id = to_update.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO swing_audit_logs (club_id, action, details, triggered_by)
  VALUES (p_club_id, 'recalc_swing_due_at',
          jsonb_build_object('updated_count', v_updated, 'capped', v_updated >= 200, 'mode', 'dynamic'),
          'system_trigger');
END;
$$;

-- 6. Extend trigger on swing_config to also fire on auto_adjust/base/etc changes
DROP TRIGGER IF EXISTS trg_swing_config_duration_changed ON swing_config;

CREATE TRIGGER trg_swing_config_duration_changed
  AFTER UPDATE OF swing_duration_minutes, pre_announce_minutes,
                   auto_adjust_duration, base_duration_minutes,
                   target_ratio, min_duration_minutes, max_duration_minutes
  ON swing_config
  FOR EACH ROW
  EXECUTE FUNCTION trg_swing_config_duration_changed();
