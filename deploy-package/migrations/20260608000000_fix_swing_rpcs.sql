-- Fix 1: execute_pre_assigned_swing RPC — old_dealer_id must reference dealers(id), not dealer_attendance(id)
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
  v_old_dealer_id   UUID;
  v_old_dealer_name TEXT;
BEGIN
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

  SELECT gt.table_name INTO v_table_name
  FROM game_tables gt WHERE gt.id = v_old_rec.table_id;

  SELECT d.full_name, da.dealer_id INTO v_old_dealer_name, v_old_dealer_id
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE da.id = v_old_rec.attendance_id;

  IF v_pre_att_id IS NOT NULL THEN
    SELECT * INTO v_pre_att_rec
    FROM dealer_attendance
    WHERE id = v_pre_att_id
      AND current_state = 'pre_assigned'
    FOR UPDATE;

    IF NOT FOUND THEN
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

  UPDATE dealer_assignments
  SET status = 'completed',
      released_at = NOW(),
      swing_processed_at = NOW(),
      version = version + 1
  WHERE id = p_old_assignment_id;

  UPDATE dealer_attendance
  SET current_state = 'available'
  WHERE id = v_old_rec.attendance_id;

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

    UPDATE dealer_attendance
    SET current_state = 'assigned',
        pre_assigned_table_id = NULL,
        pre_assigned_at = NULL
    WHERE id = v_pre_att_id;
  END IF;

  INSERT INTO public.swing_audit_logs(
    club_id, table_id, action, old_dealer_id, new_dealer_id,
    details, triggered_by
  )
  VALUES (
    p_club_id, v_old_rec.table_id,
    CASE WHEN v_pre_att_id IS NOT NULL THEN 'pre_assigned_swing' ELSE 'swung_no_dealer' END,
    v_old_dealer_id, v_pre_att_id,
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

-- Fix 2: suggest_swing_config RPC — 'CASH' → 'tournament'
CREATE OR REPLACE FUNCTION suggest_swing_config(p_club_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_tables INT;
  v_peak_dealers INT;
  v_current_dealers INT;
  v_target_ratio NUMERIC;
  v_staffing_status TEXT;
  v_note TEXT;
  v_base_duration INT;
  v_break_duration INT;
  v_history_days INT;
BEGIN
  SELECT COUNT(*) INTO v_active_tables
  FROM game_tables
  WHERE club_id = p_club_id AND status = 'active';

  IF v_active_tables = 0 THEN
    RETURN json_build_object(
      'active_tables', 0, 'note', 'Club không có bàn active'
    );
  END IF;

  SELECT COUNT(*) INTO v_current_dealers
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.shift_date = CURRENT_DATE
    AND da.status = 'checked_in';

  SELECT MAX(daily) INTO v_peak_dealers
  FROM (
    SELECT da.shift_date, COUNT(DISTINCT da.dealer_id) AS daily
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    WHERE d.club_id = p_club_id
      AND da.shift_date >= CURRENT_DATE - 7
      AND da.status = 'checked_in'
    GROUP BY da.shift_date
  ) sub;

  SELECT COUNT(DISTINCT shift_date) INTO v_history_days
  FROM dealer_attendance da
  JOIN dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.shift_date >= CURRENT_DATE - 7
    AND da.status = 'checked_in';

  IF v_history_days < 3 OR v_peak_dealers IS NULL OR v_peak_dealers = 0 THEN
    v_peak_dealers := v_current_dealers;
  END IF;

  v_target_ratio := GREATEST(
    ROUND(v_peak_dealers::NUMERIC / NULLIF(v_active_tables, 0), 2),
    1.2
  );

  SELECT swing_duration_minutes INTO v_base_duration
  FROM swing_config
  WHERE club_id = p_club_id AND table_type = 'tournament'
  LIMIT 1;
  IF v_base_duration IS NULL THEN v_base_duration := 45; END IF;

  v_break_duration := GREATEST(10, ROUND(v_base_duration * 0.33)::INT);

  IF v_current_dealers::NUMERIC / v_active_tables < 0.85 THEN
    v_staffing_status := 'understaffed';
  ELSIF v_current_dealers::NUMERIC / NULLIF(v_active_tables, 0) >= 1.2 THEN
    v_staffing_status := 'overstaffed';
  ELSE
    v_staffing_status := 'normal';
  END IF;

  v_note := CASE v_staffing_status
    WHEN 'understaffed' THEN
      'Club đang thiếu dealer (' || v_current_dealers || '/' || v_active_tables ||
      '). Peak 7 ngày qua là ' || v_peak_dealers ||
      ' dealer. Swing sẽ kéo dài tự động.'
    WHEN 'overstaffed' THEN
      'Club dư dealer (' || v_current_dealers || '/' || v_active_tables || ').'
    ELSE
      'Tỷ lệ dealer/bàn bình thường (' || v_current_dealers || '/' || v_active_tables || ').'
  END;

  RETURN json_build_object(
    'active_tables', v_active_tables,
    'peak_dealers_7d', v_peak_dealers,
    'current_dealers', v_current_dealers,
    'suggested_target_ratio', v_target_ratio,
    'suggested_base_duration', v_base_duration,
    'suggested_break_duration', v_break_duration,
    'staffing_status', v_staffing_status,
    'note', v_note
  );
END;
$$;

-- Fix 3: Clear stuck assignments so swing loop can restart cleanly
UPDATE dealer_assignments
SET swing_processed_at = NOW()
WHERE swing_processed_at IS NULL
  AND status = 'assigned'
  AND swing_due_at < NOW() - interval '1 hour';
