-- Phase 1: Break Policy, State Machine, Dealer Metrics, Audit & Metrics Tables

-- ==============================================================
-- 1. SHIFT BREAK POLICIES (per-club configurable)
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.shift_break_policies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  shift_type TEXT NOT NULL DEFAULT 'default' CHECK (shift_type IN ('default', 'morning', 'afternoon', 'graveyard')),
  min_work_before_break_minutes INTEGER NOT NULL DEFAULT 90,
  max_work_before_mandatory_break_minutes INTEGER NOT NULL DEFAULT 120,
  target_break_duration_minutes INTEGER NOT NULL DEFAULT 15,
  max_break_time_variance_minutes INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, shift_type)
);

CREATE INDEX IF NOT EXISTS idx_shift_break_policies_club ON public.shift_break_policies(club_id);

ALTER TABLE public.shift_break_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_break_policies_select"
  ON public.shift_break_policies FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "shift_break_policies_insert"
  ON public.shift_break_policies FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "shift_break_policies_update"
  ON public.shift_break_policies FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "shift_break_policies_delete"
  ON public.shift_break_policies FOR DELETE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Seed default policy for all existing clubs
INSERT INTO public.shift_break_policies (club_id, shift_type)
SELECT id, 'default' FROM public.clubs
ON CONFLICT (club_id, shift_type) DO NOTHING;

-- ==============================================================
-- 2. ADD tour_tier TO dealer_shifts
-- ==============================================================
ALTER TABLE public.dealer_shifts ADD COLUMN IF NOT EXISTS tour_tier TEXT DEFAULT 'MEDIUM' CHECK (tour_tier IN ('HIGH', 'MEDIUM', 'LOW'));

-- ==============================================================
-- 3. ADD STATE MACHINE COLUMNS TO dealer_attendance
-- ==============================================================
ALTER TABLE public.dealer_attendance ADD COLUMN IF NOT EXISTS current_state TEXT DEFAULT 'available'
  CHECK (current_state IN ('available', 'assigned', 'on_break', 'checked_out'));

ALTER TABLE public.dealer_attendance ADD COLUMN IF NOT EXISTS worked_minutes_since_last_break INTEGER DEFAULT 0;

ALTER TABLE public.dealer_attendance ADD COLUMN IF NOT EXISTS priority_break_flag BOOLEAN DEFAULT FALSE;

-- Backfill current_state for existing rows based on status
UPDATE public.dealer_attendance
SET current_state = CASE
  WHEN status = 'checked_out' THEN 'checked_out'
  WHEN status = 'checked_in' THEN 'available'
  WHEN status = 'scheduled' THEN 'available'
  WHEN status = 'absent' THEN 'checked_out'
  WHEN status = 'overtime' THEN 'assigned'
  ELSE 'available'
END
WHERE current_state = 'available' AND status IS NOT NULL;

-- ==============================================================
-- 4. SWING AUDIT LOGS
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.swing_audit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.dealer_shifts(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES public.dealer_assignments(id) ON DELETE SET NULL,
  old_dealer_id UUID REFERENCES public.dealers(id) ON DELETE SET NULL,
  new_dealer_id UUID REFERENCES public.dealers(id) ON DELETE SET NULL,
  table_id UUID REFERENCES public.game_tables(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  triggered_by TEXT NOT NULL DEFAULT 'system',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swing_audit_logs_club ON public.swing_audit_logs(club_id);
CREATE INDEX IF NOT EXISTS idx_swing_audit_logs_created ON public.swing_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swing_audit_logs_action ON public.swing_audit_logs(action);

ALTER TABLE public.swing_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swing_audit_logs_select"
  ON public.swing_audit_logs FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "swing_audit_logs_insert"
  ON public.swing_audit_logs FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 5. SWING METRICS (daily aggregates)
-- ==============================================================
CREATE TABLE IF NOT EXISTS public.swing_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_swings INTEGER DEFAULT 0,
  successful_swings INTEGER DEFAULT 0,
  failed_swings INTEGER DEFAULT 0,
  no_dealer_swings INTEGER DEFAULT 0,
  avg_processing_time_ms INTEGER,
  telegram_failures INTEGER DEFAULT 0,
  UNIQUE(club_id, date)
);

CREATE INDEX IF NOT EXISTS idx_swing_metrics_club_date ON public.swing_metrics(club_id, date);

ALTER TABLE public.swing_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swing_metrics_select"
  ON public.swing_metrics FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "swing_metrics_insert"
  ON public.swing_metrics FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY "swing_metrics_update"
  ON public.swing_metrics FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ==============================================================
-- 6. DEALER SHIFT METRICS VIEW
-- ==============================================================
CREATE OR REPLACE VIEW public.dealer_shift_metrics AS
SELECT
  da.id AS attendance_id,
  da.dealer_id,
  da.shift_id,
  d.club_id,

  -- Work metrics
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (COALESCE(dassign.released_at, NOW()) - dassign.assigned_at)) / 60
  ), 0)::INTEGER AS total_worked_minutes,

  -- Break metrics
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (COALESCE(db.break_end, NOW()) - db.break_start)) / 60
  ), 0)::INTEGER AS total_break_minutes,

  MAX(db.break_end) AS last_break_end,

  -- Assignment metrics
  COUNT(DISTINCT dassign.id)::INTEGER AS total_assignments,

  COUNT(DISTINCT CASE WHEN ds.tour_tier = 'HIGH' THEN dassign.table_id END)::INTEGER AS high_value_assignments,

  -- Freshness (minutes since last break end, or since check-in if never broke)
  EXTRACT(EPOCH FROM (NOW() - COALESCE(MAX(db.break_end), da.check_in_time, NOW()))) / 60 AS minutes_since_rest,

  -- Current state fields
  da.current_state,
  da.priority_break_flag,
  da.worked_minutes_since_last_break

FROM public.dealer_attendance da
JOIN public.dealers d ON d.id = da.dealer_id
LEFT JOIN public.dealer_assignments dassign ON dassign.attendance_id = da.id
LEFT JOIN public.dealer_breaks db ON db.assignment_id = dassign.id
LEFT JOIN public.dealer_shifts ds ON ds.id = da.shift_id
WHERE da.status = 'checked_in'
GROUP BY da.id, da.dealer_id, da.shift_id, d.club_id, da.current_state, da.priority_break_flag, da.worked_minutes_since_last_break;
