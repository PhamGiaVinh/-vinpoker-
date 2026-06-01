-- Phase 2: Minimum break duration + complete_dealer_break rewrite

-- 1. Thêm minimum_break_duration_minutes vào swing_config (default 10 phút)
ALTER TABLE swing_config
  ADD COLUMN IF NOT EXISTS minimum_break_duration_minutes INTEGER NOT NULL DEFAULT 10;

-- 2. Rewrite complete_dealer_break: tính actual duration, check min, reset có điều kiện
CREATE OR REPLACE FUNCTION public.complete_dealer_break(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break_id UUID;
  v_break_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_actual_duration NUMERIC;
  v_minimum_duration INTEGER := 10;
  v_club_id UUID;
BEGIN
  -- 1. Lock và lấy break record + break_start
  SELECT db.id, db.break_start, d.club_id
  INTO v_break_id, v_break_start, v_club_id
  FROM public.dealer_breaks db
  JOIN public.dealer_assignments da ON da.id = db.assignment_id
  JOIN public.dealer_attendance da2 ON da2.id = da.attendance_id
  JOIN public.dealers d ON d.id = da2.dealer_id
  WHERE da.attendance_id = p_attendance_id
    AND db.break_end IS NULL
  ORDER BY db.break_start DESC
  LIMIT 1
  FOR UPDATE OF db SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_open_break');
  END IF;

  -- 2. Tính actual duration (phút)
  v_actual_duration := EXTRACT(EPOCH FROM (v_now - v_break_start)) / 60;

  -- 3. Lấy minimum_break_duration từ swing_config
  SELECT COALESCE(sc.minimum_break_duration_minutes, 10)
  INTO v_minimum_duration
  FROM public.swing_config sc
  WHERE sc.club_id = v_club_id AND sc.table_type = 'tournament'
  LIMIT 1;

  -- 4. Close break
  UPDATE public.dealer_breaks SET break_end = v_now WHERE id = v_break_id;

  -- 5. Update attendance: chỉ reset worked_minutes nếu break đủ dài
  UPDATE public.dealer_attendance
  SET current_state = 'available',
      worked_minutes_since_last_break = CASE
        WHEN v_actual_duration >= v_minimum_duration THEN 0
        ELSE worked_minutes_since_last_break + v_actual_duration
      END,
      priority_break_flag = false
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'break_id', v_break_id,
    'actual_duration_minutes', round(v_actual_duration::numeric, 1),
    'minimum_duration', v_minimum_duration,
    'reset_worked', v_actual_duration >= v_minimum_duration
  );
END;
$$;
