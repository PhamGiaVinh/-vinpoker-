-- ═══════════════════════════════════════════════════════════════════════════════
-- ACCOUNTANT AUTHZ (Kế toán Workspace V2) — SOURCE-ONLY: NOT applied live.
--
-- Apply is a SEPARATE owner-gated CONTROLLED OP (see footer): STEP0a full dependency
-- preflight → STEP0b live-vs-source drift check (ABORT on any diff beyond the [ACCT]
-- lines) → STEP0c PRE_APPLY snapshot bundle (pg_get_functiondef of all 8 replaced
-- functions + pg_policies) → STEP0d golden BEFORE → STEP1 apply → STEP2 verify +
-- negative tests. NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
-- WHAT: grants the club-scoped ACCOUNTANT role (club_accountants, live since
-- 20261233000000) its working permissions, per the owner-approved permission matrix:
--
--   Dealer-payroll action                | Accountant | Owner/Admin
--   -------------------------------------+------------+------------
--   calculate / read                     |    YES     |    YES
--   save draft                           |    YES     |    YES
--   adjustments while draft/rejected     |    YES     |    YES
--   submit (draft→submitted)             |    YES     |    YES
--   approve / reject (submitted→…)       |    NO      |    YES
--   lock (approved→locked)               |    NO      |    YES
--   prepare payment (after lock)         |    YES     |    YES
--   mark paid / reconcile                |    YES     |    YES
--
-- DESIGN RULES (review round 1, P0 fixes):
--   * The shared gate assert_payroll_actor is NOT modified (P0-1). Each *_secure
--     wrapper gets an explicit [ACCT] branch; transition_payroll_status_secure gates
--     PER TRANSITION so an accountant can never approve/reject/lock (falls through to
--     the unchanged assert_payroll_actor, which rejects accountants).
--   * staff_link_user gets a concurrency-safe rewrite (UPDATE … RETURNING) + an
--     append-only audit row (P0-2). Accountant may create the FIRST link only;
--     first-link-wins is unchanged (UPDATE fires only when user_id IS NULL) so neither
--     owner nor accountant can steal/overwrite an existing link; there is no
--     unlink/relink RPC — unlinking stays an owner-manual operation by construction.
--   * NEW search_staff_link_candidates: minimal, masked profile lookup so the UI never
--     reads public.profiles directly (P0-2).
--   * All replaced bodies are copied VERBATIM from the canonical latest source and the
--     controlled-op verifies live == canonical BEFORE apply (P0-3). Diffs are marked
--     [ACCT] / [ACCT-GATE] / [VALID].
--   * All new policies are ADDITIVE + idempotent (DROP IF EXISTS only on names this
--     migration owns). The FOR ALL isolation policies are never touched.
--   * payment_records is payroll-only by construction (period_id NOT NULL + unique per
--     period — see 20261028000000 doctrine note), so a club-scoped SELECT policy is
--     safe; `period_id IS NOT NULL` is still required as belt-and-braces (P0-6).
--
-- ⚠️ SECURITY FIX INCLUDED (P0-6 finding): calculate_club_payroll was SECURITY DEFINER
--   with NO internal authz — ANY authenticated user could read ANY club's full payroll
--   (names, salaries, deductions). This migration adds a scope gate covering every
--   legitimate consumer today (super_admin / club_admin / owner / cashier-member /
--   dealer_control) + accountant.
--
-- ⚠️ FINDING (NOT changed here — separate owner decision): assert_payroll_actor lets
--   club CASHIERS pass every transition, i.e. cashiers can approve AND lock dealer
--   payroll today. Tightening cashier rights is out of scope for this wave.
--
-- ROLLBACK: restore the PRE_APPLY_*.sql snapshot bundle exported in STEP0c, then
--   DROP the new policies/functions listed in the footer. (Per-object canonical
--   sources: 20261235000000 wrappers, 20260819000001 calculate, 20261232000000
--   finance summary, 20261229000000 expenses, 20261227000000 staff,
--   20261111000014 fnb_get_report.)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Private helper: is the caller an accountant of this club? ─────────────
-- Not callable by clients; only the SECURITY DEFINER wrappers below call it.
CREATE OR REPLACE FUNCTION public._is_payroll_accountant(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_club_accountant(auth.uid(), p_club_id);
$$;
REVOKE ALL ON FUNCTION public._is_payroll_accountant(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Dealer payroll wrappers — per-action accountant branch ─────────────────
-- Bodies verbatim from 20261235000000_dealer_payroll_actor_binding.sql; the ONLY
-- change is the [ACCT] authz branch. assert_payroll_actor itself is untouched.

CREATE OR REPLACE FUNCTION public.save_payroll_period_secure(
  p_club_id uuid,
  p_year integer,
  p_month integer,
  p_start_date date,
  p_end_date date,
  p_payroll_rows jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_period_id uuid;
BEGIN
  IF public._is_payroll_accountant(p_club_id) THEN   -- [ACCT] accountant may save drafts
    v_uid := auth.uid();
  ELSE
    v_uid := public.assert_payroll_actor(p_club_id);
  END IF;
  SELECT public.save_payroll_period(
    p_club_id, p_year, p_month, p_start_date, p_end_date, p_payroll_rows, v_uid
  ) INTO v_period_id;
  RETURN v_period_id;
END;
$$;

-- Transition wrapper: accountant passes ONLY for non-sensitive transitions.
-- submitted→approved/rejected and approved→locked fall through to the UNCHANGED
-- assert_payroll_actor, which does not include accountants → forbidden.
CREATE OR REPLACE FUNCTION public.transition_payroll_status_secure(
  p_period_id uuid,
  p_expected_status text,
  p_new_status text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_club_id uuid;
BEGIN
  SELECT club_id INTO v_club_id
  FROM public.payroll_periods
  WHERE id = p_period_id;
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;

  IF public._is_payroll_accountant(v_club_id)
     AND NOT (
       (p_expected_status = 'submitted' AND p_new_status IN ('approved', 'rejected'))
       OR (p_expected_status = 'approved' AND p_new_status = 'locked')
     )
  THEN                                                -- [ACCT] submit/resubmit only
    v_uid := auth.uid();
  ELSE
    v_uid := public.assert_payroll_actor(v_club_id);
  END IF;

  IF NOT (
    (p_expected_status = 'draft' AND p_new_status = 'submitted')
    OR (p_expected_status = 'rejected' AND p_new_status IN ('draft', 'submitted'))
    OR (p_expected_status = 'submitted' AND p_new_status IN ('approved', 'rejected'))
    OR (p_expected_status = 'approved' AND p_new_status = 'locked')
  ) THEN
    RAISE EXCEPTION 'Invalid payroll transition: % -> %', p_expected_status, p_new_status;
  END IF;

  RETURN public.transition_payroll_status(
    p_period_id, p_expected_status, p_new_status, v_uid, p_rejection_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_payroll_payment_secure(
  p_period_id uuid,
  p_payment_method text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_club_id uuid;
  v_record_id uuid;
BEGIN
  SELECT club_id INTO v_club_id FROM public.payroll_periods WHERE id = p_period_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF public._is_payroll_accountant(v_club_id) THEN   -- [ACCT]
    v_uid := auth.uid();
  ELSE
    v_uid := public.assert_payroll_actor(v_club_id);
  END IF;
  SELECT public.prepare_payroll_payment(p_period_id, v_uid, p_payment_method, p_note)
    INTO v_record_id;
  RETURN v_record_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_payroll_paid_secure(
  p_period_id uuid,
  p_payment_ref text,
  p_paid_at timestamptz DEFAULT now(),
  p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_club_id uuid;
BEGIN
  SELECT club_id INTO v_club_id FROM public.payroll_periods WHERE id = p_period_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF public._is_payroll_accountant(v_club_id) THEN   -- [ACCT]
    v_uid := auth.uid();
  ELSE
    v_uid := public.assert_payroll_actor(v_club_id);
  END IF;
  RETURN public.mark_payroll_paid(p_period_id, v_uid, p_payment_ref, p_paid_at, p_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_payroll_payment_secure(
  p_period_id uuid,
  p_reconciliation_ref text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_club_id uuid;
BEGIN
  SELECT club_id INTO v_club_id FROM public.payroll_periods WHERE id = p_period_id;
  IF v_club_id IS NULL THEN RAISE EXCEPTION 'Payroll period not found'; END IF;
  IF public._is_payroll_accountant(v_club_id) THEN   -- [ACCT]
    v_uid := auth.uid();
  ELSE
    v_uid := public.assert_payroll_actor(v_club_id);
  END IF;
  RETURN public.reconcile_payroll_payment(p_period_id, v_uid, p_reconciliation_ref, p_note);
END;
$$;

-- Grants unchanged from 20261235000000 (restated for explicitness).
REVOKE ALL ON FUNCTION public.save_payroll_period_secure(uuid, integer, integer, date, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_payroll_payment_secure(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_payroll_paid_secure(uuid, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reconcile_payroll_payment_secure(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_payroll_period_secure(uuid, integer, integer, date, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payroll_payment_secure(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payroll_paid_secure(uuid, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payroll_payment_secure(uuid, text, text) TO authenticated;

-- ── 3. calculate_club_payroll — SECURITY FIX: add the missing scope gate ──────
-- Body verbatim from 20260819000001_payroll_b5_saved_net_recombine.sql (B5 lineage,
-- live-verified in STEP0b). ONLY change: the [ACCT-GATE] block right after BEGIN.
-- The gate is the UNION of every consumer that legitimately reads payroll today
-- (assert_payroll_actor set + dealer_control) + the accountant, so no existing
-- user loses access — but anonymous cross-club payroll reads stop working.
CREATE OR REPLACE FUNCTION public.calculate_club_payroll(p_club_id uuid, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dealer RECORD;
  v_results JSONB := '{}'::JSONB;
  v_payroll JSONB;
  v_period_id UUID;
  v_dealer_payroll RECORD;
  v_total_adjustments BIGINT;
BEGIN
  -- [ACCT-GATE] P0-6 security fix: previously NO authz — any authenticated user could
  -- read any club's payroll. Roles below = all legitimate consumers + accountant.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'club_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), p_club_id)
    OR public.is_club_dealer_control(auth.uid(), p_club_id)
    OR (
      (public.has_role(auth.uid(), 'cashier'::public.app_role)
       OR public.has_role(auth.uid(), 'club_cashier'::public.app_role))
      AND EXISTS (
        SELECT 1 FROM public.club_cashiers cc
        WHERE cc.club_id = p_club_id AND cc.user_id = auth.uid()
      )
    )
    OR public.is_club_accountant(auth.uid(), p_club_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_period_id
  FROM payroll_periods
  WHERE club_id = p_club_id
    AND period_start = p_start_date
    AND period_end = p_end_date;

  IF FOUND THEN
    FOR v_dealer_payroll IN
      SELECT dp.*, d.full_name, d.standard_hours_per_shift, d.ot_multiplier AS dealer_ot_mult
      FROM dealer_payroll dp
      JOIN dealers d ON d.id = dp.dealer_id
      WHERE dp.period_id = v_period_id
        AND dp.club_id = p_club_id
        AND dp.status != 'excluded'
      ORDER BY d.full_name
    LOOP
      SELECT COALESCE(SUM(
        CASE adjustment_type
          WHEN 'BONUS' THEN amount_vnd
          WHEN 'PENALTY' THEN -amount_vnd
          WHEN 'DEDUCTION' THEN -amount_vnd
          WHEN 'ADVANCE' THEN -amount_vnd
          WHEN 'OTHER' THEN amount_vnd
          ELSE 0
        END
      ), 0)
      INTO v_total_adjustments
      FROM payroll_adjustments
      WHERE payroll_id = v_dealer_payroll.id;

      v_payroll := jsonb_build_object(
        'dealer_id', v_dealer_payroll.dealer_id,
        'full_name', v_dealer_payroll.full_name,
        'employment_type', v_dealer_payroll.employment_type,
        'monthly_salary_vnd', v_dealer_payroll.monthly_salary_vnd,
        'hourly_rate_vnd', v_dealer_payroll.hourly_rate_vnd,
        'standard_hours_per_shift', COALESCE(v_dealer_payroll.standard_hours_per_shift, 8),
        'ot_multiplier', COALESCE(v_dealer_payroll.dealer_ot_mult, 1.5),
        'total_shifts', COALESCE(v_dealer_payroll.total_shifts, 0),
        'total_hours', COALESCE(v_dealer_payroll.total_hours, 0),
        'regular_hours', COALESCE(v_dealer_payroll.regular_hours, 0),
        'ot_hours', COALESCE(v_dealer_payroll.ot_hours, 0),
        'base_salary_vnd', COALESCE(v_dealer_payroll.base_salary_vnd, 0),
        'regular_pay_vnd', COALESCE(v_dealer_payroll.regular_pay_vnd, 0),
        'ot_pay_vnd', COALESCE(v_dealer_payroll.ot_pay_vnd, 0),
        'gross_pay_vnd', COALESCE(v_dealer_payroll.gross_pay_vnd, 0),
        'total_adjustments_vnd', COALESCE(v_total_adjustments, 0),
        'tips_amount_vnd', COALESCE(v_dealer_payroll.tips_amount_vnd, 0),
        'bhxh_deduction_vnd', COALESCE(v_dealer_payroll.bhxh_deduction_vnd, 0),
        'bhyt_deduction_vnd', COALESCE(v_dealer_payroll.bhyt_deduction_vnd, 0),
        'bhtn_deduction_vnd', COALESCE(v_dealer_payroll.bhtn_deduction_vnd, 0),
        'pit_deduction_vnd', COALESCE(v_dealer_payroll.pit_deduction_vnd, 0),
        -- B5: saved-path net = stored after-tax + live adjustments (post-save adjustments stay visible; stored rows untouched)
        'net_pay_vnd', COALESCE(v_dealer_payroll.net_pay_after_tax_vnd, 0) + COALESCE(v_total_adjustments, 0),
        'net_pay_after_tax_vnd', COALESCE(v_dealer_payroll.net_pay_after_tax_vnd, 0),
        'shifts', '[]'::JSONB
      );

      v_results := v_results || jsonb_build_object(v_dealer_payroll.dealer_id::text, v_payroll);
    END LOOP;
  ELSE
    FOR v_dealer IN
      SELECT id FROM dealers
      WHERE club_id = p_club_id AND status = 'active'
      ORDER BY full_name
    LOOP
      v_payroll := calculate_dealer_payroll(v_dealer.id, p_start_date, p_end_date);
      v_results := v_results || jsonb_build_object(v_dealer.id::text, v_payroll);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'club_id', p_club_id,
    'period_start', p_start_date,
    'period_end', p_end_date,
    'dealers', v_results
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.calculate_club_payroll(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_club_payroll(uuid, date, date) TO authenticated;

-- ── 4. Additive accountant policies (idempotent on OUR names only) ────────────
-- Permissive policies OR-combine: these ADD accountant read/adjustment access and
-- leave every hardened policy from 20260716/20260819/20261235 byte-untouched.

DROP POLICY IF EXISTS payroll_select_accountant ON public.dealer_payroll;
CREATE POLICY payroll_select_accountant ON public.dealer_payroll
  FOR SELECT TO authenticated
  USING (public.is_club_accountant(auth.uid(), club_id));

DROP POLICY IF EXISTS payroll_periods_select_accountant ON public.payroll_periods;
CREATE POLICY payroll_periods_select_accountant ON public.payroll_periods
  FOR SELECT TO authenticated
  USING (public.is_club_accountant(auth.uid(), club_id));

DROP POLICY IF EXISTS payroll_adjustments_select_accountant ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_select_accountant ON public.payroll_adjustments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dealer_payroll dp
      WHERE dp.id = payroll_adjustments.payroll_id
        AND public.is_club_accountant(auth.uid(), dp.club_id)
    )
  );

-- Adjustment WRITES keep the draft/rejected state-machine guard (mirror of the
-- hardened 20261235000000 policies — the boundary is identical, only the role adds).
DROP POLICY IF EXISTS payroll_adjustments_insert_accountant ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_insert_accountant ON public.payroll_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.dealer_payroll dp
      JOIN public.payroll_periods pp ON pp.id = dp.period_id
      WHERE dp.id = payroll_adjustments.payroll_id
        AND pp.status IN ('draft', 'rejected')
        AND public.is_club_accountant(auth.uid(), dp.club_id)
    )
  );

DROP POLICY IF EXISTS payroll_adjustments_delete_accountant ON public.payroll_adjustments;
CREATE POLICY payroll_adjustments_delete_accountant ON public.payroll_adjustments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.dealer_payroll dp
      JOIN public.payroll_periods pp ON pp.id = dp.period_id
      WHERE dp.id = payroll_adjustments.payroll_id
        AND pp.status IN ('draft', 'rejected')
        AND public.is_club_accountant(auth.uid(), dp.club_id)
    )
  );

-- payment_records is payroll-only by construction (period_id NOT NULL + unique per
-- period — 20261028000000 doctrine). `period_id IS NOT NULL` stays as belt-and-braces
-- so a future multi-domain reuse of this table never leaks to accountants.
DROP POLICY IF EXISTS payment_records_select_accountant ON public.payment_records;
CREATE POLICY payment_records_select_accountant ON public.payment_records
  FOR SELECT TO authenticated
  USING (
    period_id IS NOT NULL
    AND public.is_club_accountant(auth.uid(), club_id)
  );

-- Staff directory read (staff_select_operator excludes accountants).
DROP POLICY IF EXISTS staff_select_accountant ON public.staff;
CREATE POLICY staff_select_accountant ON public.staff
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.is_club_accountant(auth.uid(), club_id)
  );

-- Expense ledger read (writes stay RPC-only).
DROP POLICY IF EXISTS club_expenses_select_accountant ON public.club_expenses;
CREATE POLICY club_expenses_select_accountant ON public.club_expenses
  FOR SELECT TO authenticated
  USING (public.is_club_accountant(auth.uid(), club_id));

-- ── 5. Club expenses RPCs — accountant manages ────────────────────────────────
-- Bodies verbatim from 20261229000000_club_expenses.sql; only the [ACCT] line adds.

CREATE OR REPLACE FUNCTION public.get_club_expenses(
  p_club_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
    OR public.is_club_accountant(v_uid, p_club_id)   -- [ACCT]
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'club_id', p_club_id,
    'from', p_from,
    'to', p_to,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'category', e.category, 'amount_vnd', e.amount_vnd,
               'description', e.description, 'incurred_at', e.incurred_at,
               'tournament_id', e.tournament_id, 'series_id', e.series_id,
               'payment_status', e.payment_status, 'payment_source', e.payment_source,
               'attachment_url', e.attachment_url, 'adjusts_id', e.adjusts_id,
               'entered_by', e.entered_by, 'created_at', e.created_at
             ) ORDER BY e.incurred_at DESC)
      FROM public.club_expenses e
      WHERE e.club_id = p_club_id AND e.incurred_at >= p_from AND e.incurred_at < p_to
    ), '[]'::jsonb),
    'total_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to
    ), 0),
    'by_category', COALESCE((
      SELECT jsonb_object_agg(category, cat_total)
      FROM (
        SELECT category, sum(amount_vnd) AS cat_total
        FROM public.club_expenses
        WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to
        GROUP BY category
      ) g
    ), '{}'::jsonb),
    'paid_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to AND payment_status = 'paid'
    ), 0),
    'unpaid_vnd', COALESCE((
      SELECT sum(amount_vnd) FROM public.club_expenses
      WHERE club_id = p_club_id AND incurred_at >= p_from AND incurred_at < p_to AND payment_status = 'unpaid'
    ), 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_club_expenses(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_expenses(uuid, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_club_expense(
  p_club_id         uuid,
  p_category        public.expense_category,
  p_amount_vnd      bigint,
  p_incurred_at     timestamptz,
  p_description     text    DEFAULT NULL,
  p_payment_status  text    DEFAULT 'unpaid',
  p_payment_source  text    DEFAULT NULL,
  p_tournament_id   uuid    DEFAULT NULL,
  p_series_id       uuid    DEFAULT NULL,
  p_attachment_url  text    DEFAULT NULL,
  p_adjusts_id      uuid    DEFAULT NULL,
  p_idempotency_key text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_key   text;
  v_prior record;
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_amount_vnd IS NULL OR p_amount_vnd = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'amount_vnd must be non-zero');
  END IF;
  IF p_payment_status NOT IN ('paid', 'unpaid') THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'payment_status');
  END IF;

  -- Authz: operator of p_club_id (Owner+Cashier) or accountant.
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
    OR public.is_club_accountant(v_uid, p_club_id)   -- [ACCT]
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  v_key := nullif(btrim(p_idempotency_key), '');

  -- Idempotency: a supplied key that already inserted → return the prior row (no 2nd insert).
  IF v_key IS NOT NULL THEN
    SELECT id, amount_vnd, incurred_at INTO v_prior
    FROM public.club_expenses WHERE club_id = p_club_id AND idempotency_key = v_key LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('status', 'ok', 'idempotent', true, 'expense_id', v_prior.id);
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.club_expenses (
      club_id, category, amount_vnd, description, incurred_at,
      tournament_id, series_id, payment_status, payment_source,
      entered_by, attachment_url, adjusts_id, idempotency_key
    ) VALUES (
      p_club_id, p_category, p_amount_vnd, p_description, p_incurred_at,
      p_tournament_id, p_series_id, COALESCE(p_payment_status, 'unpaid'), p_payment_source,
      v_uid, p_attachment_url, p_adjusts_id, v_key
    )
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM public.club_expenses WHERE club_id = p_club_id AND idempotency_key = v_key LIMIT 1;
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true, 'expense_id', v_id);
  END;

  RETURN jsonb_build_object('status', 'ok', 'idempotent', false, 'expense_id', v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.record_club_expense(uuid, public.expense_category, bigint, timestamptz, text, text, text, uuid, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_club_expense(uuid, public.expense_category, bigint, timestamptz, text, text, text, uuid, uuid, text, uuid, text) TO authenticated;

-- ── 6. staff_upsert — accountant + hardened validation [VALID] ────────────────
-- Body from 20261227000000_staff_directory.sql + [ACCT] authz + [VALID] input checks
-- (review P1): non-negative amounts, FT requires monthly salary, PT requires hourly
-- rate, status allowlist, length limits, stable return codes.
CREATE OR REPLACE FUNCTION public.staff_upsert(
  p_club_id                  uuid,
  p_full_name                text,
  p_department               public.staff_department,
  p_employment_type          text    DEFAULT 'full_time',
  p_staff_id                 uuid    DEFAULT NULL,
  p_phone                    text    DEFAULT NULL,
  p_monthly_salary_vnd       bigint  DEFAULT NULL,
  p_hourly_rate_vnd          integer DEFAULT NULL,
  p_standard_hours_per_shift numeric DEFAULT NULL,
  p_manual_bhxh_vnd          bigint  DEFAULT NULL,
  p_manual_tax_vnd           bigint  DEFAULT NULL,
  p_status                   text    DEFAULT 'active'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'full_name');
  END IF;
  IF length(btrim(p_full_name)) > 120 THEN                                     -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'full_name too long');
  END IF;
  IF p_phone IS NOT NULL AND length(btrim(p_phone)) > 30 THEN                  -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'phone too long');
  END IF;
  IF p_employment_type NOT IN ('full_time', 'part_time') THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'employment_type');
  END IF;
  IF COALESCE(p_status, 'active') NOT IN ('active', 'inactive') THEN           -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'status');
  END IF;
  IF COALESCE(p_monthly_salary_vnd, 0) < 0 OR COALESCE(p_hourly_rate_vnd, 0) < 0
     OR COALESCE(p_standard_hours_per_shift, 0) < 0
     OR COALESCE(p_manual_bhxh_vnd, 0) < 0 OR COALESCE(p_manual_tax_vnd, 0) < 0 THEN  -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'amounts must be >= 0');
  END IF;
  IF p_employment_type = 'full_time' AND COALESCE(p_monthly_salary_vnd, 0) <= 0 THEN  -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'full_time requires monthly_salary_vnd');
  END IF;
  IF p_employment_type = 'part_time' AND COALESCE(p_hourly_rate_vnd, 0) <= 0 THEN     -- [VALID]
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'part_time requires hourly_rate_vnd');
  END IF;

  -- Authz: operator of p_club_id (Owner+Cashier) or accountant.
  IF NOT (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
    OR public.is_club_accountant(v_uid, p_club_id)   -- [ACCT]
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_staff_id IS NULL THEN
    INSERT INTO public.staff (
      club_id, full_name, phone, department, employment_type,
      monthly_salary_vnd, hourly_rate_vnd, standard_hours_per_shift,
      manual_bhxh_vnd, manual_tax_vnd, status
    ) VALUES (
      p_club_id, btrim(p_full_name), p_phone, p_department, p_employment_type,
      p_monthly_salary_vnd, p_hourly_rate_vnd, p_standard_hours_per_shift,
      p_manual_bhxh_vnd, p_manual_tax_vnd, COALESCE(p_status, 'active')
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.staff SET
      full_name                = btrim(p_full_name),
      phone                    = p_phone,
      department               = p_department,
      employment_type          = p_employment_type,
      monthly_salary_vnd       = p_monthly_salary_vnd,
      hourly_rate_vnd          = p_hourly_rate_vnd,
      standard_hours_per_shift = p_standard_hours_per_shift,
      manual_bhxh_vnd          = p_manual_bhxh_vnd,
      manual_tax_vnd           = p_manual_tax_vnd,
      status                   = COALESCE(p_status, 'active'),
      updated_at               = now()
    WHERE id = p_staff_id AND club_id = p_club_id AND deleted_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('error', 'NOT_FOUND', 'detail', 'staff row not in this club');
    END IF;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'staff_id', v_id, 'club_id', p_club_id);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_upsert(uuid, text, public.staff_department, text, uuid, text, bigint, integer, numeric, bigint, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_upsert(uuid, text, public.staff_department, text, uuid, text, bigint, integer, numeric, bigint, bigint, text) TO authenticated;

-- ── 7. staff_link_user — concurrency-safe rewrite + accountant + audit ────────
-- P0-2: the previous SELECT→UPDATE sequence could report 'ok' for a losing racer.
-- Now the UPDATE itself is the arbiter (WHERE user_id IS NULL … RETURNING): exactly
-- one concurrent caller wins; the loser re-reads the real link and gets
-- 'already_linked'. Accountant may create the FIRST link only; no unlink RPC exists,
-- so unlink/relink stays an owner-manual operation by construction.
CREATE TABLE IF NOT EXISTS public.staff_link_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  actor      uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staff_link_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_link_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.staff_link_audit TO authenticated;
DROP POLICY IF EXISTS staff_link_audit_select_operator ON public.staff_link_audit;
CREATE POLICY staff_link_audit_select_operator ON public.staff_link_audit
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c
               WHERE c.id = staff_link_audit.club_id AND c.owner_id = auth.uid())
    OR public.is_club_accountant(auth.uid(), staff_link_audit.club_id)
  );
-- No INSERT policy: rows are written only by the SECURITY DEFINER RPC below.

CREATE OR REPLACE FUNCTION public.staff_link_user(
  p_staff_id uuid,
  p_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club_id uuid;
  v_won     uuid;
  v_current uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'user_id'); END IF;

  SELECT club_id INTO v_club_id
  FROM public.staff WHERE id = p_staff_id AND deleted_at IS NULL;
  IF v_club_id IS NULL THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF NOT (public.is_club_owner(v_uid, v_club_id)
          OR public.is_club_accountant(v_uid, v_club_id)) THEN   -- [ACCT] first-link only
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  -- Concurrency-safe first-link-wins: the UPDATE is the arbiter (P0-2).
  UPDATE public.staff SET user_id = p_user_id, updated_at = now()
  WHERE id = p_staff_id AND user_id IS NULL AND deleted_at IS NULL
  RETURNING user_id INTO v_won;

  IF v_won IS NULL THEN
    SELECT user_id INTO v_current
    FROM public.staff WHERE id = p_staff_id AND deleted_at IS NULL;
    IF v_current IS NULL THEN
      RETURN jsonb_build_object('error', 'NOT_FOUND');
    END IF;
    RETURN jsonb_build_object(
      'status', CASE WHEN v_current = p_user_id THEN 'ok' ELSE 'already_linked' END,
      'staff_id', p_staff_id, 'user_id', v_current
    );
  END IF;

  INSERT INTO public.staff_link_audit (staff_id, club_id, user_id, actor)
  VALUES (p_staff_id, v_club_id, p_user_id, v_uid);

  RETURN jsonb_build_object('status', 'ok', 'staff_id', p_staff_id, 'user_id', p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.staff_link_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_link_user(uuid, uuid) TO authenticated;

-- ── 8. search_staff_link_candidates — minimal, masked profile lookup (P0-2) ───
-- The UI never reads public.profiles directly. Owner/accountant of the club only;
-- query >= 2 chars; masked phone; hard cap 10 rows.
CREATE OR REPLACE FUNCTION public.search_staff_link_candidates(
  p_club_id uuid,
  p_query   text,
  p_limit   integer DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q   text := btrim(COALESCE(p_query, ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id)
          OR public.is_club_accountant(v_uid, p_club_id)) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF length(v_q) < 2 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'query must be at least 2 characters');
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'user_id', t.user_id,
             'display_name', t.display_name,
             'phone_masked', t.phone_masked
           ))
    FROM (
      SELECT p.user_id,
             COALESCE(p.display_name, 'Không tên') AS display_name,
             CASE
               WHEN p.phone IS NULL OR length(p.phone) < 6 THEN NULL
               ELSE left(p.phone, 3) || '****' || right(p.phone, 2)
             END AS phone_masked
      FROM public.profiles p
      WHERE (p.display_name ILIKE '%' || v_q || '%' OR p.phone ILIKE '%' || v_q || '%')
      ORDER BY p.display_name
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 10)
    ) t
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.search_staff_link_candidates(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_staff_link_candidates(uuid, text, integer) TO authenticated;

-- ── 9. fnb_get_report — accountant read scope (LOCAL only) ────────────────────
-- Body verbatim from 20261111000014_fnb_order_refs.sql. The [ACCT] block widens the
-- scope INSIDE THIS FUNCTION ONLY — fnb_club_ids (shared by F&B WRITE RPCs) is never
-- touched, so the accountant gains exactly read-report access, nothing else.
CREATE OR REPLACE FUNCTION public.fnb_get_report(
  p_from    timestamptz,
  p_to      timestamptz,
  p_club_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_all_ids uuid[];
  v_scope   uuid[];
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(array_agg(x), '{}') INTO v_all_ids FROM public.fnb_club_ids(v_uid) x;

  -- [ACCT] read-only report scope: accountant clubs are appended LOCALLY (never via
  -- fnb_club_ids, which also gates F&B write RPCs).
  SELECT v_all_ids || COALESCE(array_agg(ca.club_id), '{}') INTO v_all_ids
  FROM public.club_accountants ca
  WHERE ca.user_id = v_uid AND NOT (ca.club_id = ANY(v_all_ids));

  IF p_club_id IS NOT NULL THEN
    IF NOT (p_club_id = ANY(v_all_ids)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
    v_scope := ARRAY[p_club_id];
  ELSE
    v_scope := v_all_ids;
  END IF;

  WITH
  -- [C] sale: regular paid orders only (comps excluded). [A2] carry table_ref/player_ref.
  sale AS (
    SELECT o.id, o.subtotal_vnd::numeric AS revenue, o.cogs_vnd::numeric AS cogs, o.paid_at AS recog_at,
           o.table_ref, o.player_ref
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  -- [C] refund: regular cancelled orders only (comp cancels excluded). [A2] carry table_ref/player_ref.
  refund AS (
    SELECT o.id, -o.subtotal_vnd::numeric AS revenue,
           CASE WHEN o.shipped_at IS NULL THEN -o.cogs_vnd::numeric ELSE 0 END AS cogs,
           o.cancelled_at AS recog_at,
           o.table_ref, o.player_ref
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  recog AS (
    SELECT id, revenue, cogs, recog_at FROM sale
    UNION ALL
    SELECT id, revenue, cogs, recog_at FROM refund
  ),
  -- [A2] ref recognition = sale ∪ refund carrying the soft refs (so by-table/by-player net refunds
  --      and reconcile to the `revenue`/`cogs` totals).
  ref_recog AS (
    SELECT id, revenue, cogs, table_ref, player_ref FROM sale
    UNION ALL
    SELECT id, revenue, cogs, table_ref, player_ref FROM refund
  ),
  item_recog AS (
    SELECT oi.menu_item_id, oi.name_snapshot,
           oi.qty::numeric AS qty, (oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN sale s ON s.id = oi.order_id
    UNION ALL
    SELECT oi.menu_item_id, oi.name_snapshot,
           -oi.qty::numeric AS qty, -(oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN public.fnb_orders o ON o.id = oi.order_id
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL AND o.shipped_at IS NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
      AND NOT COALESCE(o.is_comp, false)    -- [C]
  ),
  itms AS (
    SELECT menu_item_id, name_snapshot, SUM(qty) AS qty, SUM(revenue) AS revenue
    FROM item_recog GROUP BY menu_item_id, name_snapshot
  ),
  -- [A2] revenue/COGS grouped by the soft table ref (NULL → "Khách lẻ").
  by_table AS (
    SELECT rr.table_ref AS ref,
           COALESCE(gt.table_name, 'Khách lẻ') AS name,
           SUM(rr.revenue) AS revenue, SUM(rr.cogs) AS cogs, COUNT(DISTINCT rr.id) AS cnt
    FROM ref_recog rr
    LEFT JOIN public.game_tables gt ON gt.id = rr.table_ref
    GROUP BY rr.table_ref, gt.table_name
  ),
  -- [A2] revenue/COGS grouped by the soft player ref (NULL → "Khách lẻ").
  by_player AS (
    SELECT rr.player_ref AS ref,
           COALESCE(pr.display_name,
                    CASE WHEN rr.player_ref IS NULL THEN 'Khách lẻ' ELSE left(rr.player_ref::text, 6) END) AS name,
           SUM(rr.revenue) AS revenue, SUM(rr.cogs) AS cogs, COUNT(DISTINCT rr.id) AS cnt
    FROM ref_recog rr
    LEFT JOIN public.profiles pr ON pr.user_id = rr.player_ref
    GROUP BY rr.player_ref, pr.display_name
  ),
  status_rows AS (
    SELECT status::text AS status, COUNT(*) AS cnt
    FROM public.fnb_orders
    WHERE club_id = ANY(v_scope) AND created_at BETWEEN p_from AND p_to
    GROUP BY status
  ),
  low AS (
    SELECT id, name, on_hand, low_stock_threshold, stock_unit
    FROM public.fnb_ingredients
    WHERE club_id = ANY(v_scope) AND is_active AND on_hand <= low_stock_threshold
  ),
  daily AS (
    SELECT to_char(recog_at, 'YYYY-MM-DD') AS d, SUM(revenue) AS revenue, SUM(cogs) AS cogs
    FROM recog GROUP BY to_char(recog_at, 'YYYY-MM-DD')
  ),
  -- [C] comp recognition: sale@paid_at (revenue=0, cogs=cogs_vnd) + cancel reversal.
  comp_sale AS (
    SELECT o.id, o.cogs_vnd::numeric AS cogs
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND COALESCE(o.is_comp, false)
      AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN p_from AND p_to
  ),
  comp_cancel AS (
    SELECT o.id,
           CASE WHEN o.shipped_at IS NULL THEN -o.cogs_vnd::numeric ELSE 0 END AS cogs_reversal
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND COALESCE(o.is_comp, false)
      AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
  )
  SELECT jsonb_build_object(
    'revenue',     (SELECT COALESCE(SUM(revenue), 0) FROM recog),
    'cogs',        (SELECT COALESCE(SUM(cogs), 0) FROM recog),
    'grossProfit', (SELECT COALESCE(SUM(revenue), 0) - COALESCE(SUM(cogs), 0) FROM recog),
    'orderCount',  (SELECT COUNT(*) FROM sale),
    'statusCounts',(SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM status_rows),
    'topItems',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'menuItemId', menu_item_id, 'name', name_snapshot, 'qty', qty, 'revenue', revenue)
                       ORDER BY revenue DESC), '[]'::jsonb)
                    FROM (SELECT * FROM itms WHERE qty <> 0 OR revenue <> 0 ORDER BY revenue DESC LIMIT 10) t),
    'lowStock',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'ingredientId', id, 'name', name, 'onHand', on_hand,
                       'threshold', low_stock_threshold, 'unit', stock_unit)
                       ORDER BY (on_hand - low_stock_threshold)), '[]'::jsonb)
                    FROM low),
    'dailyTrend',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'cogs', cogs)
                       ORDER BY d), '[]'::jsonb)
                    FROM daily),
    -- [C] comp stats: issued this period + net COGS (after any pre-ship cancellations).
    'compCount',   (SELECT COUNT(*) FROM comp_sale),
    'compCogs',    (SELECT COALESCE(SUM(cogs), 0) FROM comp_sale)
                   + (SELECT COALESCE(SUM(cogs_reversal), 0) FROM comp_cancel),
    -- [A2] revenue/COGS by table + by player (reporting-only; reconcile to `revenue`/`cogs`).
    'byTable',     (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'tableRef', ref, 'name', name, 'revenue', revenue, 'cogs', cogs, 'count', cnt)
                       ORDER BY revenue DESC), '[]'::jsonb) FROM by_table),
    'byPlayer',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'playerRef', ref, 'name', name, 'revenue', revenue, 'cogs', cogs, 'count', cnt)
                       ORDER BY revenue DESC), '[]'::jsonb) FROM by_player)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.fnb_get_report(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_get_report(timestamptz, timestamptz, uuid) TO authenticated;

-- ── 10. get_club_finance_summary — E3 body + accountant read scope ────────────
-- Body = the E3 lineage from 20261232000000_finance_summary_club_expenses.sql
-- VERBATIM (which is the 20261211000000 [PT] lineage + [EXP] clubExpenses fold),
-- plus ONE [ACCT] block in the scoping section. APPLYING THIS SUPERSEDES the
-- standalone E3 apply: one apply delivers E3 + accountant scope; idempotent on the
-- E3 delta if E3 was already applied. The E3 golden-diff (BEFORE/AFTER on a
-- zero-expense month, owner-run) remains REQUIRED as part of this apply.
CREATE OR REPLACE FUNCTION public.get_club_finance_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_super boolean := false;
  v_all_ids uuid[];
  v_club_ids uuid[];
  v_archive_default constant numeric := 199000;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.user_roles ur where ur.user_id = v_uid and ur.role = 'super_admin'
  ) into v_super;

  if v_super then
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs;
  else
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs where owner_id = v_uid;
    -- [ACCT] accountant read scope: clubs where the caller is a club_accountants
    -- member join the owner-scope union (read-only P&L; RPC path only).
    select v_all_ids || coalesce(array_agg(ca.club_id), '{}') into v_all_ids
    from public.club_accountants ca
    where ca.user_id = v_uid and not (ca.club_id = any(v_all_ids));
  end if;

  if p_club_id is not null then
    if not (p_club_id = any(v_all_ids)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_club_ids := array[p_club_id];
  else
    v_club_ids := v_all_ids;
  end if;

  if v_all_ids is null or array_length(v_all_ids, 1) is null then
    return jsonb_build_object(
      'revenue', jsonb_build_object(
        'stakingFees',0,'stakingFixed',0,'stakingPercent',0,'stakingArchive',0,'payoutFees',0,
        'rake',0,'rakeActual',0,'rakeExpected',0,'rakeVariance',0,
        'rakeOnline',0,'rakeOffline',0,'rakeReentry',0,'serviceFee',0,'fnb',0,'total',0),
      'cost', jsonb_build_object(
        'payrollNet',0,'payrollGross',0,'adjustments',0,'ptWagePaid',0,'fnbCogs',0,'compCogs',0,'clubExpenses',0),  -- [C] +compCogs [PT] +ptWagePaid [EXP] +clubExpenses
      'net', 0, 'statusTotals', '{}'::jsonb, 'unpaidTotal', 0, 'reconciledTotal', 0,
      'aging', jsonb_build_object('d0_30',0,'d31_60',0,'d61_90',0,'d90p',0),
      'trend', '[]'::jsonb, 'perPeriod', '[]'::jsonb, 'perClub', '[]'::jsonb, 'clubs', '[]'::jsonb
    );
  end if;

  with
  acc_clubs as (
    select id, name from public.clubs where id = any(v_all_ids)
  ),
  fee_rows as (
    select d.club_id, to_char(d.created_at, 'YYYY-MM') as ym,
      ( case when d.player_checked_in and coalesce(d.platform_fixed_fee,0) > 0 then coalesce(d.platform_fixed_fee,0) else 0 end ) as fixed_fee,
      ( case when d.player_checked_in and coalesce(d.platform_percent_fee,0) > 0 then coalesce(d.platform_percent_fee,0) else 0 end ) as percent_fee,
      ( case when d.status = 'completed' and coalesce(d.result_prize_vnd,0) > 0
             then least(coalesce(d.platform_archive_fee, v_archive_default), coalesce(d.result_prize_vnd,0)) else 0 end ) as archive_fee
    from public.staking_deals d
    where d.club_id = any(v_club_ids) and d.created_at between p_from and p_to
  ),
  payout_rows as (
    select d.club_id, to_char(pr.created_at, 'YYYY-MM') as ym, coalesce(pr.platform_fee_vnd,0) as fee
    from public.payout_recipients pr
    join public.staking_deals d on d.id = pr.deal_id
    where d.club_id = any(v_club_ids) and pr.created_at between p_from and p_to
  ),
  reg_src as (
    select t.id as tour_id, t.club_id, to_char(t.created_at, 'YYYY-MM') as ym,
           coalesce(t.rake_amount,0) as rake_amount,
           coalesce(t.service_fee_amount,0) as service_fee_amount,
           case when t.free_rake_enabled then coalesce(t.free_rake_used,0) else 0 end as free_used,
           case
             when tr.reference_code like 'REENTRY-%' then 'reentry'
             when tr.reference_code like 'CASH-%'    then 'offline'
             else 'online'
           end as src,
           greatest(0, coalesce(tr.total_pay,0) - coalesce(tr.buy_in,0) - coalesce(t.service_fee_amount,0)) as rake_actual
    from public.tournament_registrations tr
    join public.tournaments t on t.id = tr.tournament_id
    where tr.status = 'confirmed'
      and t.club_id = any(v_club_ids)
      and t.created_at between p_from and p_to
  ),
  tour_src as (
    select tour_id, club_id, ym, rake_amount, service_fee_amount, free_used,
      count(*) filter (where src = 'online')  as n_online,
      count(*) filter (where src = 'offline') as n_offline,
      count(*) filter (where src = 'reentry') as n_reentry,
      coalesce(sum(rake_actual),0)            as actual_sum
    from reg_src
    group by tour_id, club_id, ym, rake_amount, service_fee_amount, free_used
  ),
  rake_cfg as (
    select club_id, ym,
      rake_amount * greatest(0, n_online - free_used) as cfg_online,
      rake_amount * n_offline                          as cfg_offline,
      rake_amount * n_reentry                          as cfg_reentry,
      service_fee_amount * (n_online + n_offline + n_reentry) as cfg_service,
      actual_sum
    from tour_src
  ),
  -- [C] fnb_rows: REGULAR paid sales only — comps excluded (NOT COALESCE(o.is_comp,false)).
  --     The same per-club fnb_settings JOIN as before.
  fnb_rows as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           o.subtotal_vnd::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.paid_at is not null
      and o.paid_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comps from the regular sales COGS
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           -o.subtotal_vnd::numeric as revenue,
           case when o.shipped_at is null then -o.cogs_vnd::numeric else 0 end as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comp cancels (handled in fnb_rows_comp)
  ),
  -- [C] fnb_rows_comp: comp-order COGS only, event-time (rev=0 always; cogs=real ingredient cost).
  --     SALE at paid_at; CANCEL reverses COGS if not yet shipped (same rule as regular cancel).
  --     Same per-club gate (fnb_settings.fnb_in_club_net). EMPTY when flag off → golden-diff holds.
  fnb_rows_comp as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           0::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.paid_at is not null and o.paid_at between p_from and p_to
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           0::numeric as revenue,
           case when o.shipped_at is null then -o.cogs_vnd::numeric else 0 end as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
  ),
  rev_all as (
    select club_id, ym, (fixed_fee + percent_fee + archive_fee) as fee from fee_rows
    union all select club_id, ym, fee from payout_rows
    union all select club_id, ym, (cfg_online + cfg_offline + cfg_reentry + cfg_service) as fee from rake_cfg
    union all select club_id, ym, revenue as fee from fnb_rows
    -- [C] fnb_rows_comp.revenue is 0 so omitting from rev_all is equivalent — cleaner.
  ),
  period_agg as (
    select pp.id as period_id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
      pp.status as period_status, pp.locked_at, pp.approved_at, pp.submitted_at,
      coalesce(sum(dp.net_pay_vnd)   filter (where coalesce(dp.status,'') <> 'excluded'), 0) as net,
      coalesce(sum(dp.gross_pay_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as gross,
      coalesce(sum(dp.total_adjustments_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as adj
    from public.payroll_periods pp
    left join public.dealer_payroll dp on dp.period_id = pp.id
    where pp.club_id = any(v_club_ids)
      and pp.period_start <= p_to::date and pp.period_end >= p_from::date
    group by pp.id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
             pp.status, pp.locked_at, pp.approved_at, pp.submitted_at
  ),
  pay as (
    select distinct on (pr.period_id) pr.period_id, pr.status as pay_status,
      pr.paid_at, pr.reconciled_at, pr.prepared_at
    from public.payment_records pr
    where pr.club_id = any(v_club_ids)
    order by pr.period_id, pr.created_at desc
  ),
  period_eff as (
    select pa.period_id, pa.club_id, pa.period_year, pa.period_month, pa.net, pa.gross, pa.adj,
      case
        when py.reconciled_at is not null or py.pay_status = 'reconciled' then 'reconciled'
        when py.paid_at is not null or py.pay_status = 'paid' then 'paid'
        when py.prepared_at is not null or py.pay_status in ('prepared','payment_prepared') then 'payment_prepared'
        when lower(coalesce(pa.period_status,'')) in
             ('draft','submitted','approved','locked','rejected','payment_prepared','paid','reconciled')
          then lower(pa.period_status)
        else 'other'
      end as eff_status,
      coalesce(py.prepared_at, pa.locked_at, pa.approved_at, pa.submitted_at, pa.period_end::timestamptz) as unpaid_anchor
    from period_agg pa
    left join pay py on py.period_id = pa.period_id
  ),
  -- [PT] Option B (restored from 20261028000001 v4): PART-TIME wage payouts are real cash that does
  --      NOT flow through payment_records; summed into payroll cost on a CASH basis (by paid_at,
  --      non-voided). Dropped by the fnb finance rewrites (…000006/…000011/…000013) — restored here.
  pt_pay as (
    select w.club_id, to_char(w.paid_at, 'YYYY-MM') as ym, w.amount_vnd as amt
    from public.dealer_pt_wage_payments w
    where w.club_id = any(v_club_ids)
      and w.voided_at is null
      and w.paid_at between p_from and p_to
  ),
  -- [EXP] Club operating expenses (rent/utilities/marketing/…): real cash cost from the append-only
  --       club_expenses ledger. amount_vnd is SIGNED (adjustment rows net out). By incurred_at,
  --       between p_from and p_to — same closed-interval basis as pt_pay / fee_rows.
  club_exp as (
    select e.club_id, to_char(e.incurred_at, 'YYYY-MM') as ym, e.amount_vnd as amt
    from public.club_expenses e
    where e.club_id = any(v_club_ids)
      and e.incurred_at between p_from and p_to
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'stakingFees',    (select coalesce(sum(fixed_fee + percent_fee + archive_fee),0) from fee_rows),
      'stakingFixed',   (select coalesce(sum(fixed_fee),0)   from fee_rows),
      'stakingPercent', (select coalesce(sum(percent_fee),0) from fee_rows),
      'stakingArchive', (select coalesce(sum(archive_fee),0) from fee_rows),
      'payoutFees',     (select coalesce(sum(fee),0) from payout_rows),
      'rake',           (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeActual',     (select coalesce(sum(actual_sum),0) from rake_cfg),
      'rakeExpected',   (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeVariance',   (select coalesce(sum(actual_sum),0) from rake_cfg)
                        - (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeOnline',     (select coalesce(sum(cfg_online),0)  from rake_cfg),
      'rakeOffline',    (select coalesce(sum(cfg_offline),0) from rake_cfg),
      'rakeReentry',    (select coalesce(sum(cfg_reentry),0) from rake_cfg),
      'serviceFee',     (select coalesce(sum(cfg_service),0) from rake_cfg),
      'fnb',            (select coalesce(sum(revenue),0) from fnb_rows),
      'total',          (select coalesce(sum(fee),0) from rev_all)
    ),
    'cost', jsonb_build_object(
      -- [PT] payrollNet INCLUDES PT payouts (Option B). ptWagePaid is the itemized PT sub-total
      --      (already inside payrollNet — do NOT add again in the client).
      'payrollNet',   (select coalesce(sum(net),0)   from period_eff) + (select coalesce(sum(amt),0) from pt_pay),
      'payrollGross', (select coalesce(sum(gross),0) from period_eff),
      'adjustments',  (select coalesce(sum(adj),0)   from period_eff),
      'ptWagePaid',   (select coalesce(sum(amt),0)   from pt_pay),
      'fnbCogs',      (select coalesce(sum(cogs),0)  from fnb_rows),           -- regular sales COGS only
      'compCogs',     (select coalesce(sum(cogs),0)  from fnb_rows_comp),        -- [C] comp COGS (separate line)
      'clubExpenses', (select coalesce(sum(amt),0)   from club_exp)              -- [EXP] operating expenses (rent/utilities/…)
    ),
    -- [C] net deducts BOTH regular COGS and comp COGS (owner decision: comp is a real cost).
    -- [PT] and deducts PT wage payouts (restored).
    'net', (select coalesce(sum(fee),0) from rev_all)
           - (select coalesce(sum(net),0) from period_eff)
           - (select coalesce(sum(amt),0) from pt_pay)
           - (select coalesce(sum(cogs),0) from fnb_rows)
           - (select coalesce(sum(cogs),0) from fnb_rows_comp)
           - (select coalesce(sum(amt),0) from club_exp),   -- [EXP] deduct operating expenses
    'statusTotals', (
      select coalesce(jsonb_object_agg(eff_status, total), '{}'::jsonb)
      from (select eff_status, sum(net) as total from period_eff group by eff_status) s
    ),
    'unpaidTotal', (select coalesce(sum(net),0) from period_eff
                    where eff_status in ('submitted','approved','locked','payment_prepared')),
    'reconciledTotal', (select coalesce(sum(net),0) from period_eff where eff_status = 'reconciled'),
    'aging', (
      select jsonb_build_object(
        'd0_30',  coalesce(sum(net) filter (where days <= 30), 0),
        'd31_60', coalesce(sum(net) filter (where days > 30 and days <= 60), 0),
        'd61_90', coalesce(sum(net) filter (where days > 60 and days <= 90), 0),
        'd90p',   coalesce(sum(net) filter (where days > 90), 0)
      )
      from (
        select net, greatest(0, floor(extract(epoch from (now() - unpaid_anchor)) / 86400))::int as days
        from period_eff
        where eff_status in ('submitted','approved','locked','payment_prepared')
      ) a
    ),
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', to_char(to_date(ym, 'YYYY-MM'), 'MM/YY'), 'revenue', rev_v, 'cost', cost_v
      ) order by ym), '[]'::jsonb)
      from (
        select m.ym,
          coalesce((select sum(fee) from rev_all r where r.ym = m.ym), 0) as rev_v,
          -- [C] cost_v now includes both regular and comp COGS
          coalesce((select sum(net) from period_eff pe
                    where to_char(make_date(pe.period_year, pe.period_month, 1), 'YYYY-MM') = m.ym), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.ym = m.ym), 0)              -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.ym = m.ym), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.ym = m.ym), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.ym = m.ym), 0) as cost_v  -- [EXP]
        from (
          select ym from rev_all
          union select to_char(make_date(period_year, period_month, 1), 'YYYY-MM') as ym from period_eff
          union select ym from pt_pay           -- [PT] PT months into the spine
          union select ym from fnb_rows
          union select ym from fnb_rows_comp    -- [C] comp months into the spine
          union select ym from club_exp         -- [EXP] expense months into the spine
        ) m
      ) t
    ),
    'perPeriod', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pe.period_id, 'clubId', pe.club_id,
        'clubName', coalesce((select name from acc_clubs ac where ac.id = pe.club_id), '—'),
        'periodKey', lpad(pe.period_month::text, 2, '0') || '/' || pe.period_year::text,
        'gross', pe.gross, 'net', pe.net, 'status', pe.eff_status
      ) order by pe.period_year desc, pe.period_month desc), '[]'::jsonb)
      from period_eff pe
    ),
    'perClub', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'clubId', cid, 'name', cname, 'revenue', rev_v, 'cost', cost_v, 'net', rev_v - cost_v
      ) order by (rev_v - cost_v) desc), '[]'::jsonb)
      from (
        select ac.id as cid, ac.name as cname,
          coalesce((select sum(fee) from rev_all r where r.club_id = ac.id), 0) as rev_v,
          coalesce((select sum(net) from period_eff pe where pe.club_id = ac.id), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.club_id = ac.id), 0)                    -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.club_id = ac.id), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.club_id = ac.id), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.club_id = ac.id), 0) as cost_v        -- [EXP]
        from acc_clubs ac
        where ac.id = any(v_club_ids)
      ) pc
      where rev_v <> 0 or cost_v <> 0
    ),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from acc_clubs)
  ) into v_result;

  return v_result;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_club_finance_summary(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_club_finance_summary(timestamptz, timestamptz, uuid) TO authenticated;

-- ── 11. get_accountant_capabilities — per-domain capability probe (P1) ────────
-- One call per club tells the workspace UI exactly which tabs the CALLER can use.
-- 42883 (function missing) on live = this migration not applied yet → UI shows
-- "not_installed". Each boolean mirrors the REAL authz of its domain.
CREATE OR REPLACE FUNCTION public.get_accountant_capabilities(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_operator boolean;
  v_acct boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  v_acct := public.is_club_accountant(v_uid, p_club_id);
  v_operator := (
    public.has_role(v_uid, 'super_admin'::app_role)
    OR public.has_role(v_uid, 'club_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = p_club_id AND cc.user_id = v_uid)
  );

  RETURN jsonb_build_object(
    'club_id', p_club_id,
    'is_accountant', v_acct,
    'payroll',         v_operator OR v_acct OR public.is_club_dealer_control(v_uid, p_club_id),
    'staff',           v_operator OR v_acct,
    'expenses',        v_operator OR v_acct,
    'fnb_report',      v_acct OR EXISTS (SELECT 1 FROM public.fnb_club_ids(v_uid) x WHERE x = p_club_id),
    'finance_summary', v_acct
                       OR public.has_role(v_uid, 'super_admin'::app_role)
                       OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_uid)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_accountant_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_accountant_capabilities(uuid) TO authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONTROLLED-APPLY VERIFY (STEP 2 of the runbook; read-only):
--   -- prosrc markers
--   select proname,
--          prosrc like '%_is_payroll_accountant%'  as has_acct_branch
--   from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('save_payroll_period_secure','transition_payroll_status_secure',
--                     'prepare_payroll_payment_secure','mark_payroll_paid_secure',
--                     'reconcile_payroll_payment_secure');
--   select proname, prosrc like '%is_club_accountant%' as has_acct
--   from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('calculate_club_payroll','get_club_expenses','record_club_expense',
--                     'staff_upsert','staff_link_user');
--   select proname, prosrc like '%club_accountants%' as has_acct_scope
--   from pg_proc where pronamespace = 'public'::regnamespace
--     and proname in ('fnb_get_report','get_club_finance_summary');
--   select prosrc like '%clubExpenses%' as e3_applied
--   from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_club_finance_summary';
--   -- 9 new policies + audit table
--   select tablename, policyname from pg_policies where schemaname='public'
--     and policyname in ('payroll_select_accountant','payroll_periods_select_accountant',
--       'payroll_adjustments_select_accountant','payroll_adjustments_insert_accountant',
--       'payroll_adjustments_delete_accountant','payment_records_select_accountant',
--       'staff_select_accountant','club_expenses_select_accountant',
--       'staff_link_audit_select_operator');
--   select to_regclass('public.staff_link_audit');
--
-- NEGATIVE TESTS (tx + ROLLBACK; <acct> = a test accountant of <club>, not owner/cashier):
--   BEGIN;
--     SET LOCAL request.jwt.claim.sub = '<acct>';
--     SELECT public.transition_payroll_status_secure('<submitted_period>','submitted','approved');
--       -- EXPECT: 'Actor is not authorized for payroll club …'
--     SELECT public.transition_payroll_status_secure('<approved_period>','approved','locked');
--       -- EXPECT: forbidden (same)
--     SELECT public.transition_payroll_status_secure('<draft_period>','draft','submitted');
--       -- EXPECT: ok (true)
--     SELECT public.search_staff_link_candidates('<club>','a');
--       -- EXPECT: {error INVALID_INPUT, query >= 2 chars}
--     SELECT public.staff_link_user('<staff_already_linked>','<other_user>');
--       -- EXPECT: {status already_linked, user_id = the REAL linked user}
--     SELECT public.get_club_expenses('<other_club_not_assigned>', now()-interval '1 day', now());
--       -- EXPECT: forbidden (42501) — cross-club
--     SET LOCAL request.jwt.claim.sub = '<random_player>';
--     SELECT public.calculate_club_payroll('<club>', current_date - 30, current_date);
--       -- EXPECT: forbidden (42501) — P0-6 fix proof (was readable before!)
--   ROLLBACK;
--
-- ROLLBACK (undo this migration; prefer the STEP0c PRE_APPLY snapshot bundle):
--   DROP FUNCTION IF EXISTS public.get_accountant_capabilities(uuid);
--   DROP FUNCTION IF EXISTS public.search_staff_link_candidates(uuid, text, integer);
--   DROP FUNCTION IF EXISTS public._is_payroll_accountant(uuid);
--   DROP POLICY IF EXISTS payroll_select_accountant ON public.dealer_payroll;
--   DROP POLICY IF EXISTS payroll_periods_select_accountant ON public.payroll_periods;
--   DROP POLICY IF EXISTS payroll_adjustments_select_accountant ON public.payroll_adjustments;
--   DROP POLICY IF EXISTS payroll_adjustments_insert_accountant ON public.payroll_adjustments;
--   DROP POLICY IF EXISTS payroll_adjustments_delete_accountant ON public.payroll_adjustments;
--   DROP POLICY IF EXISTS payment_records_select_accountant ON public.payment_records;
--   DROP POLICY IF EXISTS staff_select_accountant ON public.staff;
--   DROP POLICY IF EXISTS club_expenses_select_accountant ON public.club_expenses;
--   DROP POLICY IF EXISTS staff_link_audit_select_operator ON public.staff_link_audit;
--   DROP TABLE IF EXISTS public.staff_link_audit;
--   -- then restore PRE_APPLY_*.sql for: save/transition/prepare/mark/reconcile wrappers,
--   -- calculate_club_payroll, get_club_expenses, record_club_expense, staff_upsert,
--   -- staff_link_user, fnb_get_report, get_club_finance_summary.
-- ═══════════════════════════════════════════════════════════════════════════════
