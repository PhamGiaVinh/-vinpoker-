-- ═══════════════════════════════════════════════════════════════════════════════
-- PAYROLL PAYMENT LIFECYCLE PL-PR1 — foundation (SOURCE-ONLY, NOT APPLIED LIVE)
--
-- Extends the payroll lifecycle past 'locked':
--   locked → payment_prepared → paid → reconciled
--
-- Design doc + role matrix + UAT test plan:
--   docs/payroll/PL1_PAYMENT_LIFECYCLE_DESIGN.md
--
-- Contents:
--   1. chk_payroll_status: add payment_prepared / paid / reconciled
--   2. payroll_periods: additive nullable lifecycle actor/timestamp columns
--   3. payment_records table (one ACTIVE record per period = double-pay guard;
--      unique payment_ref per club; RLS read-only for club staff, writes only
--      through SECURITY DEFINER RPCs)
--   4. RPCs: prepare_payroll_payment / mark_payroll_paid / reconcile_payroll_payment
--      - optimistic FOR UPDATE status checks (transition_payroll_status convention)
--      - SERVER-SIDE role checks via has_role() + club_cashiers club link
--        (note: the existing transition_payroll_status has NO server-side role
--        checks; payment = real money, so PL adds them)
--      - reconciler MUST differ from payer (role separation, hard rule v1)
--      - audit row per transition (action='UPDATE' per audit CHECK constraint,
--        reason markers 'PL1 ...')
--   5. save_payroll_period guard extension (STRICTLY REQUIRED, justified):
--      previously only status='locked' blocked re-save; without extending it,
--      a 'paid' period could be silently re-saved/overwritten. Now blocks
--      locked/payment_prepared/paid/reconciled.
--
-- App KHÔNG giữ tiền — these states RECORD payment status; no money moves here.
--
-- ROLLBACK (pre-apply state; this migration is not yet applied anywhere):
--   - DROP FUNCTION prepare_payroll_payment / mark_payroll_paid / reconcile_payroll_payment
--   - DROP TABLE payment_records
--   - restore chk_payroll_status to the 5-status version (see design doc §Rollback)
--   - restore save_payroll_period from 20260819000003 (B7 canonical, md5 65d547eb…)
--   - new payroll_periods columns may stay (nullable, additive) or be dropped if all NULL
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Status constraint ──────────────────────────────────────────────────────
ALTER TABLE public.payroll_periods
  DROP CONSTRAINT IF EXISTS chk_payroll_status;
ALTER TABLE public.payroll_periods
  ADD CONSTRAINT chk_payroll_status
    CHECK (status IN ('draft','submitted','approved','locked','rejected',
                      'payment_prepared','paid','reconciled'));

-- ─── 2. Lifecycle columns on payroll_periods (additive, nullable) ──────────────
ALTER TABLE public.payroll_periods
  ADD COLUMN IF NOT EXISTS payment_prepared_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS payment_prepared_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

-- ─── 3. payment_records ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.payroll_periods(id),
  club_id UUID NOT NULL REFERENCES public.clubs(id),
  status TEXT NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared','paid','reconciled')),
  -- server-computed snapshot of what is owed at prepare time
  total_net_vnd BIGINT NOT NULL DEFAULT 0,
  dealer_count INT NOT NULL DEFAULT 0,
  payment_method TEXT,
  payment_ref TEXT,
  note TEXT,
  prepared_by UUID NOT NULL REFERENCES auth.users(id),
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by UUID REFERENCES auth.users(id),
  paid_at TIMESTAMPTZ,
  reconciled_by UUID REFERENCES auth.users(id),
  reconciled_at TIMESTAMPTZ,
  reconciliation_ref TEXT,
  reconciliation_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- double-pay guards
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_records_period
  ON public.payment_records(period_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_records_club_payment_ref
  ON public.payment_records(club_id, payment_ref) WHERE payment_ref IS NOT NULL;

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_records_select ON public.payment_records;
CREATE POLICY payment_records_select ON public.payment_records
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'club_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.club_cashiers cc
      WHERE cc.club_id = payment_records.club_id AND cc.user_id = auth.uid()
    )
  );
-- intentionally NO insert/update/delete policies:
-- all writes go through the SECURITY DEFINER RPCs below.

-- ─── 4a. prepare_payroll_payment: locked → payment_prepared ────────────────────
CREATE OR REPLACE FUNCTION public.prepare_payroll_payment(
  p_period_id UUID,
  p_user_id UUID,
  p_payment_method TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_period RECORD;
  v_record_id UUID;
  v_total_net BIGINT;
  v_dealer_count INT;
BEGIN
  SELECT id, club_id, status INTO v_period
  FROM payroll_periods WHERE id = p_period_id FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;
  IF v_period.status != 'locked' THEN
    RAISE EXCEPTION 'Expected status locked, but current status is %', v_period.status;
  END IF;

  -- server-side authorization: club-linked cashier or admin
  IF NOT (
    has_role(p_user_id, 'super_admin'::app_role)
    OR has_role(p_user_id, 'club_admin'::app_role)
    OR (
      (has_role(p_user_id, 'cashier'::app_role) OR has_role(p_user_id, 'club_cashier'::app_role))
      AND EXISTS (SELECT 1 FROM club_cashiers cc
                  WHERE cc.club_id = v_period.club_id AND cc.user_id = p_user_id)
    )
  ) THEN
    RAISE EXCEPTION 'Actor % is not authorized to prepare payment for this club', p_user_id;
  END IF;

  -- snapshot what is owed (server-computed stored rows only)
  SELECT COALESCE(SUM(net_pay_vnd), 0)::BIGINT, COUNT(*)::INT
  INTO v_total_net, v_dealer_count
  FROM dealer_payroll
  WHERE period_id = p_period_id AND status != 'excluded';

  BEGIN
    INSERT INTO payment_records (
      period_id, club_id, status, total_net_vnd, dealer_count,
      payment_method, note, prepared_by, prepared_at
    ) VALUES (
      p_period_id, v_period.club_id, 'prepared', v_total_net, v_dealer_count,
      p_payment_method, p_note, p_user_id, now()
    ) RETURNING id INTO v_record_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A payment record already exists for this period (double-pay guard)';
  END;

  UPDATE payroll_periods
  SET status = 'payment_prepared',
      payment_prepared_by = p_user_id,
      payment_prepared_at = now(),
      updated_at = now()
  WHERE id = p_period_id;

  INSERT INTO payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) VALUES (
    'payroll_periods', p_period_id, v_period.club_id, 'UPDATE',
    jsonb_build_object('status', 'locked'),
    jsonb_build_object('status', 'payment_prepared', 'payment_method', p_payment_method,
                       'total_net_vnd', v_total_net, 'dealer_count', v_dealer_count,
                       'payment_record_id', v_record_id),
    p_user_id, 'PL1 prepare payment'
  );

  RETURN v_record_id;
END;
$function$;

-- ─── 4b. mark_payroll_paid: payment_prepared → paid ────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_payroll_paid(
  p_period_id UUID,
  p_user_id UUID,
  p_payment_ref TEXT,
  p_paid_at TIMESTAMPTZ DEFAULT now(),
  p_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_period RECORD;
  v_record RECORD;
BEGIN
  SELECT id, club_id, status INTO v_period
  FROM payroll_periods WHERE id = p_period_id FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;
  IF v_period.status != 'payment_prepared' THEN
    RAISE EXCEPTION 'Expected status payment_prepared, but current status is %', v_period.status;
  END IF;

  IF p_payment_ref IS NULL OR length(trim(p_payment_ref)) = 0 THEN
    RAISE EXCEPTION 'payment_ref is required to mark a payroll as paid';
  END IF;

  IF NOT (
    has_role(p_user_id, 'super_admin'::app_role)
    OR has_role(p_user_id, 'club_admin'::app_role)
    OR (
      (has_role(p_user_id, 'cashier'::app_role) OR has_role(p_user_id, 'club_cashier'::app_role))
      AND EXISTS (SELECT 1 FROM club_cashiers cc
                  WHERE cc.club_id = v_period.club_id AND cc.user_id = p_user_id)
    )
  ) THEN
    RAISE EXCEPTION 'Actor % is not authorized to mark paid for this club', p_user_id;
  END IF;

  SELECT id, status INTO v_record
  FROM payment_records WHERE period_id = p_period_id FOR UPDATE;

  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'No payment record found for this period — run prepare first';
  END IF;
  IF v_record.status != 'prepared' THEN
    RAISE EXCEPTION 'Payment record is already %, cannot pay again (double-pay guard)', v_record.status;
  END IF;

  BEGIN
    UPDATE payment_records
    SET status = 'paid',
        payment_ref = p_payment_ref,
        paid_by = p_user_id,
        paid_at = COALESCE(p_paid_at, now()),
        note = COALESCE(p_note, note),
        updated_at = now()
    WHERE id = v_record.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'payment_ref % already used for this club (duplicate payment reference)', p_payment_ref;
  END;

  UPDATE payroll_periods
  SET status = 'paid',
      paid_by = p_user_id,
      paid_at = COALESCE(p_paid_at, now()),
      updated_at = now()
  WHERE id = p_period_id;

  INSERT INTO payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) VALUES (
    'payroll_periods', p_period_id, v_period.club_id, 'UPDATE',
    jsonb_build_object('status', 'payment_prepared'),
    jsonb_build_object('status', 'paid', 'payment_ref', p_payment_ref,
                       'payment_record_id', v_record.id),
    p_user_id, 'PL1 mark paid'
  );

  RETURN TRUE;
END;
$function$;

-- ─── 4c. reconcile_payroll_payment: paid → reconciled ──────────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_payroll_payment(
  p_period_id UUID,
  p_user_id UUID,
  p_reconciliation_ref TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_period RECORD;
  v_record RECORD;
BEGIN
  SELECT id, club_id, status INTO v_period
  FROM payroll_periods WHERE id = p_period_id FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;
  IF v_period.status != 'paid' THEN
    RAISE EXCEPTION 'Expected status paid, but current status is %', v_period.status;
  END IF;

  -- reconcile is admin-only
  IF NOT (
    has_role(p_user_id, 'super_admin'::app_role)
    OR has_role(p_user_id, 'club_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Actor % is not authorized to reconcile (club_admin/super_admin only)', p_user_id;
  END IF;

  SELECT id, status, paid_by INTO v_record
  FROM payment_records WHERE period_id = p_period_id FOR UPDATE;

  IF v_record.id IS NULL OR v_record.status != 'paid' THEN
    RAISE EXCEPTION 'No paid payment record found for this period';
  END IF;

  -- role separation: the person who paid cannot reconcile their own payment
  IF v_record.paid_by = p_user_id THEN
    RAISE EXCEPTION 'Reconciler must be different from the payer (role separation)';
  END IF;

  UPDATE payment_records
  SET status = 'reconciled',
      reconciled_by = p_user_id,
      reconciled_at = now(),
      reconciliation_ref = p_reconciliation_ref,
      reconciliation_note = p_note,
      updated_at = now()
  WHERE id = v_record.id;

  UPDATE payroll_periods
  SET status = 'reconciled',
      reconciled_by = p_user_id,
      reconciled_at = now(),
      updated_at = now()
  WHERE id = p_period_id;

  INSERT INTO payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) VALUES (
    'payroll_periods', p_period_id, v_period.club_id, 'UPDATE',
    jsonb_build_object('status', 'paid'),
    jsonb_build_object('status', 'reconciled', 'reconciliation_ref', p_reconciliation_ref,
                       'payment_record_id', v_record.id),
    p_user_id, 'PL1 reconcile payment'
  );

  RETURN TRUE;
END;
$function$;

-- ─── grants: authenticated only (internal authz inside each RPC) ───────────────
REVOKE ALL ON FUNCTION public.prepare_payroll_payment(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_payroll_paid(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reconcile_payroll_payment(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_payroll_payment(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_payroll_paid(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_payroll_payment(UUID, UUID, TEXT, TEXT) TO authenticated, service_role;

-- ─── 5. save_payroll_period guard extension (appended programmatically) ────────
-- The full updated function definition follows; it is the B7 body
-- (20260819000003, md5 65d547eb…) with EXACTLY ONE line changed:
--   OLD: ... AND status = 'locked' ...
--   NEW: ... AND status IN ('locked','payment_prepared','paid','reconciled') ...
-- so periods in any payment-lifecycle state can no longer be re-saved/overwritten.

CREATE OR REPLACE FUNCTION public.save_payroll_period(p_club_id uuid, p_year integer, p_month integer, p_start_date date, p_end_date date, p_payroll_rows jsonb, p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_period_id UUID;
  v_row JSONB;
  v_calc JSONB;
  v_dealer_id UUID;
  v_client_gross BIGINT := 0;
  v_client_net BIGINT := 0;
  v_server_gross BIGINT := 0;
  v_server_net BIGINT := 0;
  v_rows_saved INT := 0;
  v_rows_skipped INT := 0;
BEGIN
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, TRUE);

  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id AND period_year = p_year AND period_month = p_month
  FOR UPDATE;

  IF v_period_id IS NULL THEN
    INSERT INTO payroll_periods (club_id, period_year, period_month, period_start, period_end, status, calculated_by)
    VALUES (p_club_id, p_year, p_month, p_start_date, p_end_date, 'draft', p_user_id)
    RETURNING id INTO v_period_id;
  ELSE
    IF EXISTS (SELECT 1 FROM payroll_periods WHERE id = v_period_id AND status IN ('locked','payment_prepared','paid','reconciled')) THEN
      RAISE EXCEPTION 'Payroll period is locked or in payment lifecycle and cannot be modified. Period ID: %', v_period_id;
    END IF;
    UPDATE payroll_periods SET calculated_by = p_user_id, updated_at = now() WHERE id = v_period_id;
  END IF;

  -- B7: SERVER RECOMPUTE ON SAVE - client-supplied amounts are IGNORED.
  -- The payload only selects WHICH dealers to include (roster); every stored
  -- number comes from calculate_dealer_payroll() server-side at save instant.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_payroll_rows) LOOP
    v_dealer_id := (v_row->>'dealer_id')::UUID;

    -- roster guard: dealer must belong to this club and be active
    IF NOT EXISTS (
      SELECT 1 FROM dealers d
      WHERE d.id = v_dealer_id AND d.club_id = p_club_id AND d.status = 'active'
    ) THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    v_calc := calculate_dealer_payroll(v_dealer_id, p_start_date, p_end_date);
    IF v_calc ? 'error' THEN
      v_rows_skipped := v_rows_skipped + 1;
      CONTINUE;
    END IF;

    -- client-vs-server drift accounting for the audit trail
    v_client_gross := v_client_gross + COALESCE(NULLIF(v_row->>'gross_pay_vnd','')::NUMERIC, 0)::BIGINT;
    v_client_net   := v_client_net   + COALESCE(NULLIF(v_row->>'net_pay_vnd','')::NUMERIC, 0)::BIGINT;
    v_server_gross := v_server_gross + COALESCE((v_calc->>'gross_pay_vnd')::NUMERIC, 0)::BIGINT;
    v_server_net   := v_server_net   + COALESCE((v_calc->>'net_pay_vnd')::NUMERIC, 0)::BIGINT;

    INSERT INTO dealer_payroll (
      dealer_id, club_id, period_id, employment_type, monthly_salary_vnd,
      hourly_rate_vnd, ot_multiplier, total_shifts, total_hours, regular_hours,
      ot_hours, base_salary_vnd, regular_pay_vnd, ot_pay_vnd, gross_pay_vnd,
      total_adjustments_vnd, tips_amount_vnd, bhxh_deduction_vnd,
      bhyt_deduction_vnd, bhtn_deduction_vnd, pit_deduction_vnd,
      net_pay_vnd, net_pay_after_tax_vnd, status, calculated_by
    ) VALUES (
      v_dealer_id, p_club_id, v_period_id,
      v_calc->>'employment_type',
      (v_calc->>'monthly_salary_vnd')::NUMERIC,
      (v_calc->>'hourly_rate_vnd')::NUMERIC,
      (v_calc->>'ot_multiplier')::NUMERIC,
      (v_calc->>'total_shifts')::INT,
      (v_calc->>'total_hours')::NUMERIC,
      (v_calc->>'regular_hours')::NUMERIC,
      (v_calc->>'ot_hours')::NUMERIC,
      (v_calc->>'base_salary_vnd')::NUMERIC,
      (v_calc->>'regular_pay_vnd')::NUMERIC,
      (v_calc->>'ot_pay_vnd')::NUMERIC,
      (v_calc->>'gross_pay_vnd')::NUMERIC,
      (v_calc->>'total_adjustments_vnd')::NUMERIC,
      COALESCE((v_calc->>'tips_amount_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhxh_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhyt_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'bhtn_deduction_vnd')::NUMERIC, 0)::BIGINT,
      COALESCE((v_calc->>'pit_deduction_vnd')::NUMERIC, 0)::BIGINT,
      (v_calc->>'net_pay_vnd')::NUMERIC,
      COALESCE((v_calc->>'net_pay_after_tax_vnd')::NUMERIC, (v_calc->>'net_pay_vnd')::NUMERIC)::BIGINT,
      'pending', p_user_id
    )
    ON CONFLICT (period_id, dealer_id) DO UPDATE SET
      employment_type = EXCLUDED.employment_type,
      monthly_salary_vnd = EXCLUDED.monthly_salary_vnd,
      hourly_rate_vnd = EXCLUDED.hourly_rate_vnd,
      ot_multiplier = EXCLUDED.ot_multiplier,
      total_shifts = EXCLUDED.total_shifts,
      total_hours = EXCLUDED.total_hours,
      regular_hours = EXCLUDED.regular_hours,
      ot_hours = EXCLUDED.ot_hours,
      base_salary_vnd = EXCLUDED.base_salary_vnd,
      regular_pay_vnd = EXCLUDED.regular_pay_vnd,
      ot_pay_vnd = EXCLUDED.ot_pay_vnd,
      gross_pay_vnd = EXCLUDED.gross_pay_vnd,
      total_adjustments_vnd = EXCLUDED.total_adjustments_vnd,
      tips_amount_vnd = EXCLUDED.tips_amount_vnd,
      bhxh_deduction_vnd = EXCLUDED.bhxh_deduction_vnd,
      bhyt_deduction_vnd = EXCLUDED.bhyt_deduction_vnd,
      bhtn_deduction_vnd = EXCLUDED.bhtn_deduction_vnd,
      pit_deduction_vnd = EXCLUDED.pit_deduction_vnd,
      net_pay_vnd = EXCLUDED.net_pay_vnd,
      net_pay_after_tax_vnd = EXCLUDED.net_pay_after_tax_vnd,
      status = EXCLUDED.status,
      calculated_by = EXCLUDED.calculated_by,
      updated_at = now();
    v_rows_saved := v_rows_saved + 1;
  END LOOP;

  -- Soft-delete: mark excluded instead of hard delete
  -- Preserves adjustments linked to excluded dealer rows
  UPDATE dealer_payroll
  SET status = 'excluded', updated_at = now()
  WHERE period_id = v_period_id
    AND dealer_id NOT IN (
      SELECT (elem->>'dealer_id')::UUID
      FROM jsonb_array_elements(p_payroll_rows) AS elem
    );

  -- B7: audit the save with client-vs-server drift evidence
  INSERT INTO payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) VALUES (
    'payroll_periods', v_period_id, p_club_id, 'UPDATE',
    jsonb_build_object('client_gross_total', v_client_gross, 'client_net_total', v_client_net),
    jsonb_build_object('server_gross_total', v_server_gross, 'server_net_total', v_server_net,
                       'rows_saved', v_rows_saved, 'rows_skipped', v_rows_skipped),
    p_user_id, 'B7 server recompute on save'
  );

  RETURN v_period_id;
END;
$function$;
