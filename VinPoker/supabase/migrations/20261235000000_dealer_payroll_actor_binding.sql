-- Dealer Swing / Payroll critical hardening (SOURCE-ONLY; owner-gated apply).
--
-- Goals:
--   1. Bind payroll actor identity to auth.uid(), never to a client UUID.
--   2. Keep the existing server-side payroll calculation and lifecycle bodies,
--      but expose them through authenticated wrappers with scoped authorization.
--   3. Prevent direct payroll adjustment writes after the period is submitted or
--      locked. The UI guard is helpful, but RLS is the authoritative boundary.
--   4. Restrict approval lifecycle transitions to the documented state machine.
--
-- ROLLBACK (owner-controlled, after impact review):
--   - Restore EXECUTE on the legacy RPC signatures only after replacing the
--     client calls, or restore the previous migration definitions.
--   - Recreate payroll_adjustments_club_isolation FOR ALL if policy rollback is
--     explicitly approved. Do not use this as a production hotfix without UAT.

BEGIN;

-- Shared actor gate. This function is intentionally not callable by clients;
-- the secure wrappers below call it as SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION public.assert_payroll_actor(p_club_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Payroll action requires an authenticated user';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'super_admin'::public.app_role)
    OR public.has_role(v_uid, 'club_admin'::public.app_role)
    OR public.is_club_admin(v_uid, p_club_id)
    OR (
      (public.has_role(v_uid, 'cashier'::public.app_role)
       OR public.has_role(v_uid, 'club_cashier'::public.app_role))
      AND EXISTS (
        SELECT 1
        FROM public.club_cashiers cc
        WHERE cc.club_id = p_club_id AND cc.user_id = v_uid
      )
    )
  ) THEN
    RAISE EXCEPTION 'Actor is not authorized for payroll club %', p_club_id;
  END IF;

  RETURN v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_payroll_actor(uuid) FROM PUBLIC, anon, authenticated;

-- Save wrapper: the legacy body remains the server-side calculator, but its
-- p_user_id can no longer be supplied by the browser.
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
  v_uid := public.assert_payroll_actor(p_club_id);
  SELECT public.save_payroll_period(
    p_club_id, p_year, p_month, p_start_date, p_end_date, p_payroll_rows, v_uid
  ) INTO v_period_id;
  RETURN v_period_id;
END;
$$;

-- Only the documented approval graph is allowed. Expected status is retained
-- as a compare-and-swap input for concurrent UI clicks.
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

  v_uid := public.assert_payroll_actor(v_club_id);

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
  v_uid := public.assert_payroll_actor(v_club_id);
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
  v_uid := public.assert_payroll_actor(v_club_id);
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
  v_uid := public.assert_payroll_actor(v_club_id);
  RETURN public.reconcile_payroll_payment(p_period_id, v_uid, p_reconciliation_ref, p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.save_payroll_period_secure(uuid, integer, integer, date, date, jsonb)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_payroll_payment_secure(uuid, text, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_payroll_paid_secure(uuid, text, timestamptz, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reconcile_payroll_payment_secure(uuid, text, text)
  FROM PUBLIC, anon;

-- Legacy signatures are service-role/internal only. Browser callers must use
-- the *_secure wrappers above.
REVOKE ALL ON FUNCTION public.save_payroll_period(uuid, integer, integer, date, date, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_payroll_status(uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_payroll_payment(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_payroll_paid(uuid, uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_payroll_payment(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.save_payroll_period_secure(uuid, integer, integer, date, date, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payroll_payment_secure(uuid, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_payroll_paid_secure(uuid, text, timestamptz, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payroll_payment_secure(uuid, text, text)
  TO authenticated;

-- Direct adjustment edits are allowed only while a period is draft/rejected
-- and only for the club's payroll controller/admin/cashier. There is no UPDATE
-- policy: corrections are append/delete operations with audit triggers.
DROP POLICY IF EXISTS payroll_adjustments_club_isolation ON public.payroll_adjustments;
DROP POLICY IF EXISTS payroll_adjustments_select ON public.payroll_adjustments;
DROP POLICY IF EXISTS payroll_adjustments_insert ON public.payroll_adjustments;
DROP POLICY IF EXISTS payroll_adjustments_delete ON public.payroll_adjustments;

CREATE POLICY payroll_adjustments_select ON public.payroll_adjustments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.dealer_payroll dp
      JOIN public.club_members cm ON cm.club_id = dp.club_id
      WHERE dp.id = payroll_adjustments.payroll_id
        AND cm.player_user_id = auth.uid()
    )
  );

CREATE POLICY payroll_adjustments_insert ON public.payroll_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.dealer_payroll dp
      JOIN public.payroll_periods pp ON pp.id = dp.period_id
      WHERE dp.id = payroll_adjustments.payroll_id
        AND pp.status IN ('draft', 'rejected')
        AND (
          public.is_club_dealer_control(auth.uid(), dp.club_id)
          OR public.is_club_admin(auth.uid(), dp.club_id)
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
          OR (
            (public.has_role(auth.uid(), 'cashier'::public.app_role)
             OR public.has_role(auth.uid(), 'club_cashier'::public.app_role))
            AND EXISTS (
              SELECT 1 FROM public.club_cashiers cc
              WHERE cc.club_id = dp.club_id AND cc.user_id = auth.uid()
            )
          )
        )
    )
  );

CREATE POLICY payroll_adjustments_delete ON public.payroll_adjustments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.dealer_payroll dp
      JOIN public.payroll_periods pp ON pp.id = dp.period_id
      WHERE dp.id = payroll_adjustments.payroll_id
        AND pp.status IN ('draft', 'rejected')
        AND (
          public.is_club_dealer_control(auth.uid(), dp.club_id)
          OR public.is_club_admin(auth.uid(), dp.club_id)
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
          OR (
            (public.has_role(auth.uid(), 'cashier'::public.app_role)
             OR public.has_role(auth.uid(), 'club_cashier'::public.app_role))
            AND EXISTS (
              SELECT 1 FROM public.club_cashiers cc
              WHERE cc.club_id = dp.club_id AND cc.user_id = auth.uid()
            )
          )
        )
    )
  );

COMMIT;
