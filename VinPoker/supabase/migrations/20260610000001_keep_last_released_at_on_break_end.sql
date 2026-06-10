-- Fix break pool guard: do NOT clear last_released_at when break ends.
-- The guard in pickNextDealer needs last_released_at to remain set so it can
-- enforce minInterSwingRestMinutes from the moment the dealer was released
-- (entered break pool). Clearing it on break exit defeats the guard.
--
-- Affected functions:
--   1. end_expired_breaks       (auto-ending expired breaks)
--   2. transition_dealer_state  (manual/regular break end)

-- 1. Fix end_expired_breaks
CREATE OR REPLACE FUNCTION public.end_expired_breaks(
  p_club_id UUID DEFAULT NULL
)
RETURNS TABLE(
  attendance_id UUID,
  dealer_name TEXT,
  break_start TIMESTAMPTZ,
  expected_duration_minutes INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH expired AS (
    SELECT DISTINCT ON (da.id)
      da.id AS att_id,
      d.full_name AS d_name,
      db.break_start AS br_start,
      db.expected_duration_minutes AS exp_min
    FROM dealer_attendance da
    JOIN dealers d ON d.id = da.dealer_id
    JOIN dealer_assignments dass ON dass.attendance_id = da.id
    JOIN dealer_breaks db ON db.assignment_id = dass.id
    WHERE da.current_state = 'on_break'
      AND da.status = 'checked_in'
      AND db.break_end IS NULL
      AND NOW() > db.break_start + (db.expected_duration_minutes || ' minutes')::INTERVAL
      AND (p_club_id IS NULL OR d.club_id = p_club_id)
    ORDER BY da.id, db.break_start DESC
  )
  UPDATE dealer_attendance da
  SET
    current_state = 'available',
    priority_break_flag = false,
    worked_minutes_since_last_break = 0,
    updated_at = NOW()
  FROM expired
  WHERE da.id = expired.att_id
  RETURNING
    da.id,
    expired.d_name,
    expired.br_start,
    expired.exp_min;
END;
$$;

-- 2. Fix transition_dealer_state: remove last_released_at = NULL on break end
CREATE OR REPLACE FUNCTION public.transition_dealer_state(
  p_attendance_id UUID,
  p_new_state     TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_state TEXT;
  v_valid     BOOLEAN;
BEGIN
  SELECT current_state INTO v_old_state
  FROM dealer_attendance
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ATTENDANCE_NOT_FOUND');
  END IF;

  IF v_old_state = p_new_state THEN
    RETURN jsonb_build_object(
      'ok', true, 'from', v_old_state, 'to', p_new_state, 'noop', true
    );
  END IF;

  v_valid := CASE
    WHEN v_old_state = 'available'     AND p_new_state IN ('pre_assigned','assigned','in_transition','on_break','checked_out') THEN true
    WHEN v_old_state = 'pre_assigned'  AND p_new_state IN ('assigned','available','checked_out') THEN true
    WHEN v_old_state = 'assigned'      AND p_new_state IN ('on_break','in_transition','available','checked_out') THEN true
    WHEN v_old_state = 'in_transition' AND p_new_state IN ('assigned','available','on_break','checked_out') THEN true
    WHEN v_old_state = 'on_break'      AND p_new_state IN ('available','in_transition','checked_out') THEN true
    WHEN v_old_state = 'swing_ready'   AND p_new_state IN ('in_transition','available','checked_out') THEN true
    ELSE false
  END;

  IF NOT v_valid THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'INVALID_TRANSITION',
      'from', v_old_state,
      'to', p_new_state
    );
  END IF;

  PERFORM set_config(
    'app.state_reason',
    COALESCE(p_reason, 'transition_dealer_state'),
    true
  );

  -- Branch on reason for worked_minutes handling
  IF p_new_state = 'available' AND p_reason = 'meal_break_end' THEN
    -- FREEZE: meal break end — do NOT reset worked_minutes
    UPDATE dealer_attendance
    SET current_state = p_new_state,
        updated_at = NOW()
    WHERE id = p_attendance_id;

  ELSIF p_new_state = 'available' AND p_reason IN ('regular_break_end', 'complete_dealer_break', 'end_expired_break') THEN
    -- RESET: regular break end — reset worked_minutes to 0
    -- NOTE: last_released_at is intentionally NOT cleared here.
    -- The break pool guard (pickNextDealer) relies on last_released_at to
    -- enforce minInterSwingRestMinutes from when the dealer entered break pool.
    -- Clearing it would defeat the guard and allow immediate re-assignment.
    UPDATE dealer_attendance
    SET current_state = p_new_state,
        worked_minutes_since_last_break = 0,
        priority_break_flag = false,
        updated_at = NOW()
    WHERE id = p_attendance_id;

  ELSIF p_new_state = 'checked_out' THEN
    -- Cancel any active meal break on check-out
    UPDATE public.dealer_meal_breaks
    SET status = 'cancelled', break_end = NOW()
    WHERE attendance_id = p_attendance_id AND status = 'active';

    UPDATE dealer_attendance
    SET current_state = p_new_state,
        updated_at = NOW()
    WHERE id = p_attendance_id;

  ELSE
    -- Default transition (no special handling)
    UPDATE dealer_attendance
    SET current_state = p_new_state,
        updated_at = NOW()
    WHERE id = p_attendance_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'from', v_old_state, 'to', p_new_state);
END;
$$;
