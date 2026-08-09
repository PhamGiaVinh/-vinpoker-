-- TEST canonical replay compatibility overlay.
--
-- The production project contains payroll base tables created by remote-only
-- history. The tracked catalog starts using those tables before the recovery
-- baseline. Recreate only the missing base objects in the disposable TEST copy;
-- later canonical migrations still own hardening, RLS, lifecycle columns, and
-- business functions.

ALTER TABLE public.club_settings
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';

ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT false;

-- Remote history exposed this timestamp to the August pre-assignment cleanup,
-- but the tracked catalog never introduced it before that migration.
ALTER TABLE public.dealer_attendance
  ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_released_at TIMESTAMPTZ;

-- 20260609000004 is a ledger-only placeholder for columns that were applied
-- remotely. Recreate those non-production schema facts for a fresh TEST replay.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS rake_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'NLH',
  ADD COLUMN IF NOT EXISTS late_reg_close_level INTEGER,
  ADD COLUMN IF NOT EXISTS minutes_per_level INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS free_rake_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_rake_slots INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_rake_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_players INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_status TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Live history accepts lifecycle states beyond the original four-value enum
-- (for example completed/final_table); later source migrations depend on that.
ALTER TABLE public.tournaments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.tournaments
  ALTER COLUMN status TYPE TEXT USING status::TEXT;
ALTER TABLE public.tournaments ALTER COLUMN status SET DEFAULT 'scheduled';

ALTER TABLE public.tournament_seats
  ADD COLUMN IF NOT EXISTS player_name TEXT NOT NULL DEFAULT 'Player',
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE public.dealers
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  calculated_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (club_id, period_year, period_month)
);

CREATE TABLE IF NOT EXISTS public.dealer_payroll (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  employment_type TEXT NOT NULL,
  base_salary_vnd BIGINT,
  hourly_rate_vnd BIGINT,
  monthly_salary_vnd BIGINT,
  regular_hours NUMERIC DEFAULT 0,
  ot_hours NUMERIC DEFAULT 0,
  total_hours NUMERIC DEFAULT 0,
  total_shifts INTEGER DEFAULT 0,
  regular_pay_vnd BIGINT DEFAULT 0,
  ot_multiplier NUMERIC DEFAULT 1,
  ot_pay_vnd BIGINT DEFAULT 0,
  gross_pay_vnd BIGINT DEFAULT 0,
  total_adjustments_vnd BIGINT DEFAULT 0,
  net_pay_vnd BIGINT DEFAULT 0,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  calculated_by UUID,
  calculated_at TIMESTAMPTZ,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  paid_by UUID,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,
  payment_reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_id UUID NOT NULL REFERENCES public.dealer_payroll(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL,
  amount_vnd BIGINT NOT NULL,
  reason TEXT NOT NULL,
  reference_id UUID,
  created_by UUID,
  approved_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
