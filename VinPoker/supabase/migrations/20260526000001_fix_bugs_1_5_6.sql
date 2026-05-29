-- ==============================================================
-- Bug Fixes 1–6: Table-tour constraint, close-table, re-check-in,
-- race condition, payroll break deduction, special dates
-- ==============================================================

-- ==============================================================
-- BUG 1: Table-Tour Constraint
-- ==============================================================
ALTER TABLE public.game_tables ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.dealer_shifts(id) ON DELETE SET NULL;

ALTER TABLE public.game_tables DROP CONSTRAINT IF EXISTS game_tables_club_id_table_name_key;

ALTER TABLE public.game_tables ADD CONSTRAINT game_tables_club_table_shift_unique UNIQUE(club_id, table_name, shift_id);

-- Remove duplicate unassigned tables before creating unique index
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT club_id, table_name, array_agg(id ORDER BY created_at) AS ids
    FROM public.game_tables
    WHERE shift_id IS NULL
    GROUP BY club_id, table_name
    HAVING COUNT(*) > 1
  LOOP
    DELETE FROM public.game_tables
    WHERE shift_id IS NULL
      AND club_id = rec.club_id
      AND table_name = rec.table_name
      AND id <> rec.ids[1];
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_tables_unassigned_unique
ON public.game_tables (club_id, table_name) WHERE shift_id IS NULL;

-- ==============================================================
-- BUG 2: Add reason column to dealer_breaks
-- ==============================================================
ALTER TABLE public.dealer_breaks ADD COLUMN IF NOT EXISTS reason TEXT;

-- ==============================================================
-- BUG 3: Dealer Attendance Log for check-in/check-out history
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_attendance_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attendance_id UUID NOT NULL REFERENCES public.dealer_attendance(id) ON DELETE CASCADE,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.dealer_shifts(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL DEFAULT CURRENT_DATE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_log_attendance ON public.dealer_attendance_log(attendance_id);
CREATE INDEX IF NOT EXISTS idx_attendance_log_dealer_date ON public.dealer_attendance_log(dealer_id, shift_date);

ALTER TABLE public.dealer_attendance_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance_log_select"
  ON public.dealer_attendance_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.club_dealer_controls cdc
      JOIN public.dealers d ON d.club_id = cdc.club_id
      WHERE d.id = dealer_attendance_log.dealer_id
        AND cdc.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "attendance_log_insert"
  ON public.dealer_attendance_log FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.club_dealer_controls cdc
      JOIN public.dealers d ON d.club_id = cdc.club_id
      WHERE d.id = dealer_attendance_log.dealer_id
        AND cdc.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- BUG 4: Row-level locking RPC for race condition
-- ==============================================================
CREATE OR REPLACE FUNCTION public.select_dealer_for_update(p_attendance_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM id FROM public.dealer_attendance
  WHERE id = p_attendance_id AND current_state = 'available'
  FOR UPDATE NOWAIT;
  RETURN FOUND;
EXCEPTION WHEN lock_not_available THEN
  RETURN false;
END;
$$;

-- ==============================================================
-- BUG 5: Fix get_shift_payroll_summary — deduct break time
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
    CASE d.tier
      WHEN 'A' THEN 150000
      WHEN 'B' THEN 120000
      ELSE 100000
    END AS base_pay,
    COALESCE(SUM(da.overtime_minutes), 0) *
      CASE d.tier
        WHEN 'A' THEN 3000
        WHEN 'B' THEN 2500
        ELSE 2000
      END AS overtime_pay
  FROM public.dealers d
  JOIN public.dealer_attendance da ON da.dealer_id = d.id
  LEFT JOIN public.dealer_assignments dassign ON dassign.attendance_id = da.id
  WHERE d.club_id = p_club_id AND da.shift_date = p_shift_date
  GROUP BY d.id, d.full_name, d.tier
  ORDER BY d.tier, d.full_name;
END;
$$;

-- ==============================================================
-- BUG 6: Special Dates table + Predict Demand RPC
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.special_dates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  multiplier FLOAT NOT NULL DEFAULT 1.5,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, date)
);

CREATE INDEX IF NOT EXISTS idx_special_dates_club_date ON public.special_dates(club_id, date);

ALTER TABLE public.special_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "special_dates_select"
  ON public.special_dates FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "special_dates_insert"
  ON public.special_dates FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "special_dates_update"
  ON public.special_dates FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "special_dates_delete"
  ON public.special_dates FOR DELETE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE OR REPLACE FUNCTION public.predict_dealer_demand(
  p_club_id UUID,
  p_date DATE
)
RETURNS TABLE (
  suggested_dealers INT,
  multiplier FLOAT,
  reasoning TEXT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dow INT;
  v_avg_count NUMERIC;
  v_multiplier FLOAT := 1.0;
  v_label TEXT;
BEGIN
  v_dow := EXTRACT(DOW FROM p_date);

  -- Average distinct dealers checked in on same DOW
  SELECT COALESCE(AVG(cnt), 0) INTO v_avg_count
  FROM (
    SELECT COUNT(DISTINCT da.dealer_id) AS cnt
    FROM public.dealer_attendance da
    JOIN public.dealers d ON d.id = da.dealer_id
    WHERE d.club_id = p_club_id
      AND da.shift_date < p_date
      AND da.shift_date >= p_date - INTERVAL '90 days'
      AND EXTRACT(DOW FROM da.shift_date) = v_dow
      AND da.status IN ('checked_in', 'checked_out')
    GROUP BY da.shift_date
  ) sub;

  -- Check special dates
  SELECT sd.multiplier, sd.label INTO v_multiplier, v_label
  FROM public.special_dates sd
  WHERE sd.club_id = p_club_id AND sd.date = p_date;

  IF v_multiplier IS NULL THEN v_multiplier := 1.0; END IF;

  RETURN QUERY
  SELECT
    GREATEST(CEIL(v_avg_count * v_multiplier)::INT, 1) AS suggested_dealers,
    v_multiplier AS multiplier,
    CASE
      WHEN v_label IS NOT NULL THEN format('Ngày đặc biệt: %s (x%s)', v_label, v_multiplier::TEXT)
      ELSE format('Trung bình các ngày %s trước: %s dealer', v_dow::TEXT, ROUND(v_avg_count::NUMERIC, 1)::TEXT)
    END AS reasoning;
END;
$$;

-- ==============================================================
-- Trigger: auto-log attendance status changes
-- ==============================================================
CREATE OR REPLACE FUNCTION public.log_attendance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.dealer_attendance_log (
      attendance_id, dealer_id, shift_id, shift_date,
      old_status, new_status,
      check_in_time, check_out_time,
      changed_by
    ) VALUES (
      NEW.id, NEW.dealer_id, NEW.shift_id, NEW.shift_date,
      OLD.status, NEW.status,
      NEW.check_in_time, NEW.check_out_time,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_log ON public.dealer_attendance;
CREATE TRIGGER trg_attendance_log
  AFTER UPDATE OF status ON public.dealer_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.log_attendance_change();
