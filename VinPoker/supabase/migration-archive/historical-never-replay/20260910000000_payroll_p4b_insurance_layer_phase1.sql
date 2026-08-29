-- ════════════════════════════════════════════════════════════════════════════
-- PAYROLL P4b — Insurance Participation Layer — PHASE 1 (config schema only)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  SOURCE-ONLY — NOT APPLIED here. Live apply is OWNER-GATED (controlled
--     Management-API op). NO `supabase db push`, NO `deploy_db=true`, schema_migrations
--     untouched. See docs/payroll/P4b_PHASE1_ROLLOUT.md.
--
-- WHAT THIS IS: two ADDITIVE config tables that model WHO participates in statutory
-- insurance (most VinPoker dealers are cash-only → NONE) and the law rates/caps by
-- region. NOTHING reads these tables yet.
--
-- ⚠️  PHASE 1 CHANGES NO PAYROLL NUMBERS. It does NOT touch `calculate_dealer_payroll`
--     or any RPC/function. No seed data is inserted here (region rates ship as a
--     guarded, owner-applied script: scripts/payroll/seed_insurance_policy_rates_2026.sql).
--     The decision "missing profile ⇒ NONE vs legacy" is made later in P4b-3, NOT here.
--
-- DOES NOT TOUCH: calculate_dealer_payroll (P0/P2/P3 live), Dealer Swing, Tracker,
-- Cashier, Online Poker, Finance, GTO, saved/locked payroll.
--
-- ROLLBACK: docs/emergency_rollbacks/PRE_P4b_PHASE1_20260910000000.sql (DROP the two
-- tables — they are new and unreferenced, so the drop is non-destructive to payroll).
-- ════════════════════════════════════════════════════════════════════════════

-- NOTE: intentionally no explicit BEGIN/COMMIT so this file can be dry-run validated
-- inside an outer BEGIN…ROLLBACK; the owner-gated apply wraps it in one transaction.

-- ── 1. insurance_policy_rates — statutory law snapshot, versioned by effective date ──
--     Region caps/rates are snapshotted so a later law change never silently recomputes
--     a closed payroll period (P4b-3 reads the row whose window covers the period).
CREATE TABLE IF NOT EXISTS public.insurance_policy_rates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from        date NOT NULL,
  effective_to          date,
  region_code           text NOT NULL CHECK (region_code IN ('I','II','III','IV')),
  regional_min_wage_vnd bigint NOT NULL CHECK (regional_min_wage_vnd >= 0),
  bhtn_cap_vnd          bigint NOT NULL CHECK (bhtn_cap_vnd >= 0),  -- = 20 × regional_min_wage_vnd (NOT the BHXH cap)
  bhxh_cap_vnd          bigint NOT NULL CHECK (bhxh_cap_vnd >= 0),
  bhyt_cap_vnd          bigint NOT NULL CHECK (bhyt_cap_vnd >= 0),
  employee_bhxh_rate    numeric NOT NULL CHECK (employee_bhxh_rate >= 0 AND employee_bhxh_rate <= 1),
  employee_bhyt_rate    numeric NOT NULL CHECK (employee_bhyt_rate >= 0 AND employee_bhyt_rate <= 1),
  employee_bhtn_rate    numeric NOT NULL CHECK (employee_bhtn_rate >= 0 AND employee_bhtn_rate <= 1),
  employer_bhxh_rate    numeric NOT NULL DEFAULT 0 CHECK (employer_bhxh_rate >= 0 AND employer_bhxh_rate <= 1),
  employer_bhyt_rate    numeric NOT NULL DEFAULT 0 CHECK (employer_bhyt_rate >= 0 AND employer_bhyt_rate <= 1),
  employer_bhtn_rate    numeric NOT NULL DEFAULT 0 CHECK (employer_bhtn_rate >= 0 AND employer_bhtn_rate <= 1),
  source_note           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ipr_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_insurance_policy_rates_region_from
  ON public.insurance_policy_rates (region_code, effective_from);
CREATE INDEX IF NOT EXISTS idx_insurance_policy_rates_region
  ON public.insurance_policy_rates (region_code, effective_from, effective_to);

-- ── 2. dealer_insurance_profiles — per-dealer participation config ─────────────────
--     Default participation is NONE (cash-only). A row only matters once P4b-3 reads it.
CREATE TABLE IF NOT EXISTS public.dealer_insurance_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id            uuid NOT NULL REFERENCES public.dealers(id) ON DELETE CASCADE,
  club_id              uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  series_id            uuid,  -- nullable; no FK yet (no series table). Required when mode = SERIES_ONLY.
  effective_from       date NOT NULL,
  effective_to         date,
  insurance_mode       text NOT NULL DEFAULT 'NONE'
                       CHECK (insurance_mode IN ('NONE','STATUTORY','SERIES_ONLY')),
  insurance_salary_vnd bigint CHECK (insurance_salary_vnd IS NULL OR insurance_salary_vnd >= 0),
  region_code          text CHECK (region_code IS NULL OR region_code IN ('I','II','III','IV')),
  include_bhxh         boolean NOT NULL DEFAULT true,
  include_bhyt         boolean NOT NULL DEFAULT true,
  include_bhtn         boolean NOT NULL DEFAULT true,
  notes                text,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_dip_effective_range CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT chk_dip_series_requires_id CHECK (insurance_mode <> 'SERIES_ONLY' OR series_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_dealer_insurance_profiles_dealer
  ON public.dealer_insurance_profiles (dealer_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_dealer_insurance_profiles_club
  ON public.dealer_insurance_profiles (club_id, effective_from);
-- At most one OPEN (effective_to IS NULL) non-series profile per dealer+club.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dealer_insurance_open
  ON public.dealer_insurance_profiles (dealer_id, club_id)
  WHERE effective_to IS NULL AND series_id IS NULL;

-- ── updated_at triggers (project-standard helper) ─────────────────────────────────
DROP TRIGGER IF EXISTS update_insurance_policy_rates_updated_at ON public.insurance_policy_rates;
CREATE TRIGGER update_insurance_policy_rates_updated_at
  BEFORE UPDATE ON public.insurance_policy_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_dealer_insurance_profiles_updated_at ON public.dealer_insurance_profiles;
CREATE TRIGGER update_dealer_insurance_profiles_updated_at
  BEFORE UPDATE ON public.dealer_insurance_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Row Level Security ─────────────────────────────────────────────────────────────
ALTER TABLE public.insurance_policy_rates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_insurance_profiles ENABLE ROW LEVEL SECURITY;

-- insurance_policy_rates: public-law reference. Any authenticated user may READ;
-- only super_admin (or service_role) may write.
DROP POLICY IF EXISTS "insurance_policy_rates_read" ON public.insurance_policy_rates;
CREATE POLICY "insurance_policy_rates_read" ON public.insurance_policy_rates
  FOR SELECT USING (auth.uid() IS NOT NULL OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "insurance_policy_rates_admin_write" ON public.insurance_policy_rates;
CREATE POLICY "insurance_policy_rates_admin_write" ON public.insurance_policy_rates
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR auth.role() = 'service_role')
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role) OR auth.role() = 'service_role');

-- dealer_insurance_profiles: club admin / club owner / super_admin manage their club's
-- rows; the dealer may read their own; service_role for edge functions.
DROP POLICY IF EXISTS "dealer_insurance_profiles_manage" ON public.dealer_insurance_profiles;
CREATE POLICY "dealer_insurance_profiles_manage" ON public.dealer_insurance_profiles
  FOR ALL
  USING (
    public.is_club_admin(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.owner_id = auth.uid())
  )
  WITH CHECK (
    public.is_club_admin(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "dealer_insurance_profiles_service" ON public.dealer_insurance_profiles;
CREATE POLICY "dealer_insurance_profiles_service" ON public.dealer_insurance_profiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "dealer_insurance_profiles_select_own" ON public.dealer_insurance_profiles;
CREATE POLICY "dealer_insurance_profiles_select_own" ON public.dealer_insurance_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.dealers d
      WHERE d.id = dealer_insurance_profiles.dealer_id AND d.user_id = auth.uid()
    )
  );

-- ── Grants (RLS filters; authenticated needs table privileges for PostgREST) ───────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_policy_rates    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_insurance_profiles TO authenticated;

-- ── Documentation comments ─────────────────────────────────────────────────────────
COMMENT ON TABLE public.insurance_policy_rates IS
  'P4b: statutory insurance rates/caps by region, snapshotted by effective date. bhtn_cap_vnd = 20 × regional_min_wage_vnd. Read-only reference for payroll (P4b-3); not yet consumed.';
COMMENT ON TABLE public.dealer_insurance_profiles IS
  'P4b: per-dealer insurance participation. Default mode NONE (cash-only → no BHXH/BHYT/BHTN). STATUTORY / SERIES_ONLY opt a dealer in. Not yet consumed by calculate_dealer_payroll (P4b-3).';
COMMENT ON COLUMN public.dealer_insurance_profiles.insurance_mode IS
  'NONE = cash-only (no insurance). STATUTORY = full statutory participation. SERIES_ONLY = insured only within a covered series (series_id required).';
