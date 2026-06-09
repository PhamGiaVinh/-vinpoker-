-- Migration: Meal Break Feature (ăn cơm)
-- Adds: dealer_meal_breaks table, rate limit trigger, meal_break_available_at column

BEGIN;

-- 1. Create dealer_meal_breaks table
CREATE TABLE IF NOT EXISTS public.dealer_meal_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID NOT NULL REFERENCES public.dealer_attendance(id) ON DELETE CASCADE,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,

  break_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  break_end TIMESTAMPTZ,

  base_duration_minutes INT NOT NULL,
  bonus_minutes INT NOT NULL DEFAULT 15,
  total_duration_minutes INT NOT NULL,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),

  pool_size_at_start INT,
  tables_active_at_start INT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_meal_breaks_active
  ON public.dealer_meal_breaks(attendance_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_meal_breaks_rate_limit
  ON public.dealer_meal_breaks(dealer_id, break_start DESC);

CREATE INDEX IF NOT EXISTS idx_meal_breaks_club_active
  ON public.dealer_meal_breaks(club_id, break_start)
  WHERE status = 'active';

-- 3. Rate limit trigger: 1 meal break per 7 hours per dealer
CREATE OR REPLACE FUNCTION public.fn_check_meal_break_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dealer_meal_breaks
    WHERE dealer_id = NEW.dealer_id
      AND status IN ('active', 'completed')
      AND break_start > NOW() - INTERVAL '7 hours'
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'RATE_LIMIT_EXCEEDED: Meal break only allowed once every 7 hours.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_meal_break_rate_limit
  BEFORE INSERT ON public.dealer_meal_breaks
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_check_meal_break_rate();

-- 4. Add last_meal_break_at column to dealer_attendance (for frontend countdown)
ALTER TABLE public.dealer_attendance
  ADD COLUMN IF NOT EXISTS last_meal_break_at TIMESTAMPTZ;

-- 5. Update transition_dealer_state: handle meal_break_end (freeze) and checked_out (cancel)
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
    UPDATE dealer_attendance
    SET current_state = p_new_state,
        worked_minutes_since_last_break = 0,
        priority_break_flag = false,
        last_released_at = NULL,
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

-- 6. RLS policies for dealer_meal_breaks
ALTER TABLE public.dealer_meal_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meal_breaks_select_control"
  ON public.dealer_meal_breaks FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "meal_breaks_insert_control"
  ON public.dealer_meal_breaks FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "meal_breaks_update_control"
  ON public.dealer_meal_breaks FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMIT;