-- ==============================================================
-- Swing Enhancements: game_type, pay_rates, complete_break
-- ==============================================================

-- ==============================================================
-- 1. Add game_type to game_tables for per-table skill matching
-- ==============================================================
ALTER TABLE public.game_tables ADD COLUMN IF NOT EXISTS game_type TEXT;

UPDATE public.game_tables SET game_type = 'NLH' WHERE game_type IS NULL;

ALTER TABLE public.game_tables ALTER COLUMN game_type SET NOT NULL;
ALTER TABLE public.game_tables ADD CONSTRAINT game_tables_game_type_check
  CHECK (game_type IN ('NLH', 'PLO', 'OFC', 'Mixed'));

-- ==============================================================
-- 2. dealer_pay_rates table (configurable, replaces CASE)
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_pay_rates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('A', 'B', 'C')),
  base_rate NUMERIC NOT NULL DEFAULT 100000,
  overtime_rate NUMERIC NOT NULL DEFAULT 2000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_dealer_pay_rates_club ON public.dealer_pay_rates(club_id);

ALTER TABLE public.dealer_pay_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_pay_rates_select"
  ON public.dealer_pay_rates FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_pay_rates_insert"
  ON public.dealer_pay_rates FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_pay_rates_update"
  ON public.dealer_pay_rates FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_pay_rates_delete"
  ON public.dealer_pay_rates FOR DELETE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

INSERT INTO public.dealer_pay_rates (club_id, tier, base_rate, overtime_rate)
SELECT c.id, 'A', 150000, 3000 FROM public.clubs c
ON CONFLICT (club_id, tier) DO NOTHING;

INSERT INTO public.dealer_pay_rates (club_id, tier, base_rate, overtime_rate)
SELECT c.id, 'B', 120000, 2500 FROM public.clubs c
ON CONFLICT (club_id, tier) DO NOTHING;

INSERT INTO public.dealer_pay_rates (club_id, tier, base_rate, overtime_rate)
SELECT c.id, 'C', 100000, 2000 FROM public.clubs c
ON CONFLICT (club_id, tier) DO NOTHING;

-- ==============================================================
-- 3. Update get_shift_payroll_summary — read from dealer_pay_rates
-- ==============================================================
CREATE OR REPLACE FUNCTION public.get_shift_payroll_summary(
  p_club_id UUID,
  p_shift_date DATE
)
RETURNS TABLE (
  dealer_name TEXT,
  tier TEXT,
  total_minutes INT,
  overtime_minutes INT,
  tables_served INT,
  swings_done INT,
  base_pay NUMERIC,
  overtime_pay NUMERIC
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.full_name,
    d.tier,
    COALESCE(SUM(
      EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, now()) - da.check_in_time)) / 60
      - COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(db.break_end, now()) - db.break_start)) / 60)
        FROM public.dealer_breaks db
        JOIN public.dealer_assignments dass ON dass.id = db.assignment_id
        WHERE dass.attendance_id = da.id
      ), 0)
    )::INT, 0) AS total_minutes,
    COALESCE(SUM(da.overtime_minutes), 0) AS overtime_minutes,
    COUNT(DISTINCT dassign.table_id)::INT AS tables_served,
    COUNT(DISTINCT dassign.id)::INT AS swings_done,
    COALESCE(dpr.base_rate, 100000) AS base_pay,
    COALESCE(SUM(da.overtime_minutes), 0) * COALESCE(dpr.overtime_rate, 2000) AS overtime_pay
  FROM public.dealers d
  JOIN public.dealer_attendance da ON da.dealer_id = d.id
  LEFT JOIN public.dealer_assignments dassign ON dassign.attendance_id = da.id
  LEFT JOIN public.dealer_pay_rates dpr ON dpr.club_id = d.club_id AND dpr.tier = d.tier
  WHERE d.club_id = p_club_id AND da.shift_date = p_shift_date
  GROUP BY d.id, d.full_name, d.tier, dpr.base_rate, dpr.overtime_rate
  ORDER BY d.tier, d.full_name;
END;
$$;

-- ==============================================================
-- 4. complete_dealer_break RPC — atomic break completion
-- ==============================================================
CREATE OR REPLACE FUNCTION public.complete_dealer_break(p_attendance_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_break_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT db.id INTO v_break_id
  FROM public.dealer_breaks db
  JOIN public.dealer_assignments da ON da.id = db.assignment_id
  WHERE da.attendance_id = p_attendance_id
    AND db.break_end IS NULL
  ORDER BY db.break_start DESC
  LIMIT 1
  FOR UPDATE OF db SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'no_open_break');
  END IF;

  UPDATE public.dealer_breaks SET break_end = v_now WHERE id = v_break_id;

  UPDATE public.dealer_attendance
  SET current_state = 'available',
      worked_minutes_since_last_break = 0,
      priority_break_flag = false
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object('status', 'ok', 'break_id', v_break_id);
END;
$$;
