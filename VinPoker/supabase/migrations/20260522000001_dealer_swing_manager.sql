-- Dealer Swing Manager — Full Schema
-- Role + tables + RLS + triggers + RPCs

-- ==============================================================
-- 1. ROLE INFRASTRUCTURE
-- ==============================================================
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dealer_control';

CREATE TABLE IF NOT EXISTS public.club_dealer_controls (
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  granted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_club_dealer_controls_user ON public.club_dealer_controls(user_id);
CREATE INDEX IF NOT EXISTS idx_club_dealer_controls_club ON public.club_dealer_controls(club_id);

ALTER TABLE public.club_dealer_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club_dealer_controls_select_super"
  ON public.club_dealer_controls FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "club_dealer_controls_select_self"
  ON public.club_dealer_controls FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "club_dealer_controls_select_club_owner"
  ON public.club_dealer_controls FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_dealer_controls.club_id AND c.owner_id = auth.uid()));

CREATE POLICY "club_dealer_controls_insert_super"
  ON public.club_dealer_controls FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "club_dealer_controls_delete_super"
  ON public.club_dealer_controls FOR DELETE
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- Helper: is_club_dealer_control
CREATE OR REPLACE FUNCTION public.is_club_dealer_control(_user_id UUID, _club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_dealer_controls cdc
    WHERE cdc.user_id = _user_id AND cdc.club_id = _club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = _club_id AND c.owner_id = _user_id
  )
$$;

-- Helper: dealer_control_club_ids
CREATE OR REPLACE FUNCTION public.dealer_control_club_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.club_dealer_controls WHERE user_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE owner_id = _user_id
$$;

-- ==============================================================
-- 2. CLUB SETTINGS (Telegram chat ID)
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.club_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  telegram_chat_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id)
);

ALTER TABLE public.club_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "club_settings_select_owner_cashier"
  ON public.club_settings FOR SELECT
  USING (
    auth.uid() IN (
      SELECT owner_id FROM public.clubs WHERE id = club_settings.club_id
      UNION
      SELECT user_id FROM public.club_cashiers WHERE club_id = club_settings.club_id
      UNION
      SELECT user_id FROM public.club_dealer_controls WHERE club_id = club_settings.club_id
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "club_settings_insert_owner"
  ON public.club_settings FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.clubs WHERE id = club_settings.club_id AND owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "club_settings_update_owner_super"
  ON public.club_settings FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM public.clubs WHERE id = club_settings.club_id AND owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 3. DEALERS ROSTER
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  tier TEXT NOT NULL DEFAULT 'C' CHECK (tier IN ('A', 'B', 'C')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave')),
  hired_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealers_club ON public.dealers(club_id);
CREATE INDEX IF NOT EXISTS idx_dealers_status ON public.dealers(status);

ALTER TABLE public.dealers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealers_select_control"
  ON public.dealers FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR auth.uid() = user_id
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealers_insert_control"
  ON public.dealers FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealers_update_control"
  ON public.dealers FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE TRIGGER update_dealers_updated_at
  BEFORE UPDATE ON public.dealers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ==============================================================
-- 4. DEALER SHIFTS
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_shifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tour_name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_shifts_club ON public.dealer_shifts(club_id);

ALTER TABLE public.dealer_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_shifts_select_control"
  ON public.dealer_shifts FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_shifts_insert_control"
  ON public.dealer_shifts FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_shifts_update_control"
  ON public.dealer_shifts FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_shifts_delete_control"
  ON public.dealer_shifts FOR DELETE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 5. DEALER ATTENDANCE
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_attendance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.dealer_shifts(id) ON DELETE SET NULL,
  shift_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'checked_in', 'checked_out', 'absent', 'overtime')),
  check_in_time TIMESTAMPTZ,
  check_out_time TIMESTAMPTZ,
  overtime_minutes INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dealer_id, shift_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_dealer_attendance_date ON public.dealer_attendance(shift_date);
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_dealer ON public.dealer_attendance(dealer_id);
CREATE INDEX IF NOT EXISTS idx_dealer_attendance_status ON public.dealer_attendance(status);

ALTER TABLE public.dealer_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_attendance_select"
  ON public.dealer_attendance FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
    OR auth.uid() = (SELECT user_id FROM public.dealers WHERE id = dealer_attendance.dealer_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_attendance_insert_control"
  ON public.dealer_attendance FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_attendance_update_control"
  ON public.dealer_attendance FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 6. GAME TABLES
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.game_tables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  table_type TEXT NOT NULL DEFAULT 'cash' CHECK (table_type IN ('cash', 'tournament', 'vip')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  current_blind_level INT NOT NULL DEFAULT 1,
  down_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_game_tables_club ON public.game_tables(club_id);
CREATE INDEX IF NOT EXISTS idx_game_tables_type ON public.game_tables(table_type);

ALTER TABLE public.game_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "game_tables_select_control"
  ON public.game_tables FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "game_tables_insert_control"
  ON public.game_tables FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "game_tables_update_control"
  ON public.game_tables FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 7. DEALER ASSIGNMENTS (core journal with optimistic locking)
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attendance_id UUID NOT NULL REFERENCES public.dealer_attendance(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'on_break', 'completed')),
  version INT NOT NULL DEFAULT 0,
  swing_processed_at TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_assignments_table ON public.dealer_assignments(table_id);
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_status ON public.dealer_assignments(status);
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_attendance ON public.dealer_assignments(attendance_id);
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_swing ON public.dealer_assignments(swing_processed_at)
  WHERE swing_processed_at IS NULL;

ALTER TABLE public.dealer_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_assignments_select"
  ON public.dealer_assignments FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_assignments_insert_control"
  ON public.dealer_assignments FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_assignments_update_control"
  ON public.dealer_assignments FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Version bump + updated_at trigger
CREATE OR REPLACE FUNCTION public.bump_dealer_assignment_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dealer_assignments_version ON public.dealer_assignments;
CREATE TRIGGER trg_dealer_assignments_version
  BEFORE UPDATE ON public.dealer_assignments
  FOR EACH ROW EXECUTE FUNCTION public.bump_dealer_assignment_version();

-- ==============================================================
-- 8. DEALER BREAKS
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_breaks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES public.dealer_assignments(id) ON DELETE CASCADE,
  break_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  break_end TIMESTAMPTZ,
  expected_duration_minutes INT NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_breaks_assignment ON public.dealer_breaks(assignment_id);

ALTER TABLE public.dealer_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_breaks_select_control"
  ON public.dealer_breaks FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_breaks_insert_control"
  ON public.dealer_breaks FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_breaks_update_control"
  ON public.dealer_breaks FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 9. DEALER SKILLS
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_skills (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('NLH', 'PLO', 'OFC', 'Mixed', 'Tournament')),
  certified_at DATE NOT NULL DEFAULT CURRENT_DATE,
  certified_by UUID REFERENCES auth.users(id),
  UNIQUE(dealer_id, game_type)
);

CREATE INDEX IF NOT EXISTS idx_dealer_skills_dealer ON public.dealer_skills(dealer_id);

ALTER TABLE public.dealer_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_skills_select"
  ON public.dealer_skills FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
    OR auth.uid() = (SELECT user_id FROM public.dealers WHERE id = dealer_skills.dealer_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_skills_insert_control"
  ON public.dealer_skills FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 10. SWING CONFIG (per-club, per-table-type)
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.swing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  table_type TEXT NOT NULL CHECK (table_type IN ('cash', 'tournament', 'vip')),
  swing_duration_minutes INT NOT NULL DEFAULT 45,
  break_duration_minutes INT NOT NULL DEFAULT 20,
  warn_at_minutes INT NOT NULL DEFAULT 5,
  crit_at_minutes INT NOT NULL DEFAULT 1,
  tournament_mode TEXT NOT NULL DEFAULT 'time' CHECK (tournament_mode IN ('time', 'level')),
  break_return_policy TEXT NOT NULL DEFAULT 'fifo' CHECK (break_return_policy IN ('fifo', 'same_table', 'best_available')),
  UNIQUE(club_id, table_type)
);

ALTER TABLE public.swing_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swing_config_select"
  ON public.swing_config FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "swing_config_insert_control"
  ON public.swing_config FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "swing_config_update_control"
  ON public.swing_config FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 11. AUDIT LOGS
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID REFERENCES public.clubs(id),
  actor_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_club ON public.audit_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_logs_select_control"
  ON public.audit_logs FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.is_club_cashier(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Service role inserts via Edge Functions (no INSERT policy needed for anon)

-- ==============================================================
-- 12. DEALER INCIDENTS
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.dealer_incidents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  table_id UUID REFERENCES public.game_tables(id) ON DELETE SET NULL,
  reported_by UUID REFERENCES auth.users(id),
  incident_type TEXT NOT NULL CHECK (incident_type IN ('complaint', 'error', 'no_show', 'misconduct')),
  description TEXT,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_incidents_dealer ON public.dealer_incidents(dealer_id);

ALTER TABLE public.dealer_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dealer_incidents_select_control"
  ON public.dealer_incidents FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "dealer_incidents_insert_control"
  ON public.dealer_incidents FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 13. HELPER RPCs FOR DEALER SWING
-- ==============================================================

-- Get dealer worked times (total minutes per dealer for a shift date)
CREATE OR REPLACE FUNCTION public.get_dealer_worked_times(p_shift_date DATE)
RETURNS TABLE(dealer_id UUID, total_minutes BIGINT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    da.dealer_id,
    COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, now()) - da.check_in_time)) / 60)::BIGINT, 0)
  FROM public.dealer_attendance da
  WHERE da.shift_date = p_shift_date
    AND da.check_in_time IS NOT NULL
  GROUP BY da.dealer_id
$$;

-- Get last table per dealer (to avoid reassigning same table)
CREATE OR REPLACE FUNCTION public.get_dealer_last_tables(p_dealer_ids UUID[])
RETURNS TABLE(dealer_id UUID, table_id UUID)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (datt.dealer_id)
    datt.dealer_id,
    dassign.table_id
  FROM public.dealer_assignments dassign
  JOIN public.dealer_attendance datt ON datt.id = dassign.attendance_id
  WHERE datt.dealer_id = ANY(p_dealer_ids)
  ORDER BY datt.dealer_id, dassign.released_at DESC NULLS LAST
$$;

-- ==============================================================
-- 14. PAYROLL EXPORT RPC
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
    COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(da.check_out_time, now()) - da.check_in_time)) / 60)::INT, 0) AS total_minutes,
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
-- 15. DEFAULT SWING CONFIG (seed for existing clubs)
-- ==============================================================
INSERT INTO public.swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes)
SELECT c.id, 'cash', 45, 20
FROM public.clubs c
WHERE NOT EXISTS (
  SELECT 1 FROM public.swing_config sc WHERE sc.club_id = c.id AND sc.table_type = 'cash'
);

INSERT INTO public.swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes)
SELECT c.id, 'tournament', 30, 20
FROM public.clubs c
WHERE NOT EXISTS (
  SELECT 1 FROM public.swing_config sc WHERE sc.club_id = c.id AND sc.table_type = 'tournament'
);

INSERT INTO public.swing_config (club_id, table_type, swing_duration_minutes, break_duration_minutes)
SELECT c.id, 'vip', 45, 20
FROM public.clubs c
WHERE NOT EXISTS (
  SELECT 1 FROM public.swing_config sc WHERE sc.club_id = c.id AND sc.table_type = 'vip'
);
