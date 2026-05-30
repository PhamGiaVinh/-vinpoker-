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
