-- Ops V3 Accountant / payroll authority containment (SOURCE-ONLY).
--
-- Finding fixed:
--   assert_payroll_actor(uuid) intentionally includes club Cashiers for draft,
--   submit and payment-lifecycle work. Reusing that broad helper for
--   submitted -> approved/rejected and approved -> locked also allowed a
--   Cashier to approve or lock payroll. Those three review transitions now
--   require Owner / Club Admin / Super Admin authority.
--
-- This migration does not open any Accountant writer. Accountants may keep the
-- existing draft/submit paths, but may not approve, reject, or lock their own
-- payroll work. The underlying compare-and-swap transition remains the only
-- state writer.
--
-- ROLLBACK (owner-gated): restore the PRE_APPLY definition of
-- transition_payroll_status_secure(uuid,text,text,text), then drop
-- public._assert_payroll_approval_actor(uuid). Never edit migration history.

BEGIN;

DO $preflight$
DECLARE
  v_wrapper regprocedure := to_regprocedure(
    'public.transition_payroll_status_secure(uuid,text,text,text)'
  );
BEGIN
  IF to_regclass('public.payroll_periods') IS NULL
     OR v_wrapper IS NULL
     OR to_regprocedure('public.transition_payroll_status(uuid,text,text,uuid,text)') IS NULL
     OR to_regprocedure('public.assert_payroll_actor(uuid)') IS NULL
     OR to_regprocedure('public._is_payroll_accountant(uuid)') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.is_club_admin(uuid,uuid)') IS NULL
  THEN
    RAISE EXCEPTION
      'ops_accountant_payroll_guard prerequisite contract missing'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'public.payroll_periods'::regclass
      AND attname IN ('id', 'club_id', 'status')
      AND NOT attisdropped
    GROUP BY attrelid
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION
      'ops_accountant_payroll_guard payroll_periods shape mismatch'
      USING ERRCODE = '55000';
  END IF;

  IF position(
    '_is_payroll_accountant' IN pg_get_functiondef(v_wrapper)
  ) = 0 THEN
    RAISE EXCEPTION
      'ops_accountant_payroll_guard requires the canonical Accountant wrapper'
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public._assert_payroll_approval_actor(p_club_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_role(v_actor, 'super_admin'::public.app_role)
    OR public.has_role(v_actor, 'club_admin'::public.app_role)
    OR public.is_club_admin(v_actor, p_club_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN v_actor;
END;
$function$;

REVOKE ALL ON FUNCTION public._assert_payroll_approval_actor(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transition_payroll_status_secure(
  p_period_id uuid,
  p_expected_status text,
  p_new_status text,
  p_rejection_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid;
  v_club_id uuid;
  v_sensitive_review boolean;
BEGIN
  SELECT pp.club_id
  INTO v_club_id
  FROM public.payroll_periods pp
  WHERE pp.id = p_period_id;

  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;

  IF NOT (
    (p_expected_status = 'draft' AND p_new_status = 'submitted')
    OR (p_expected_status = 'rejected' AND p_new_status IN ('draft', 'submitted'))
    OR (p_expected_status = 'submitted' AND p_new_status IN ('approved', 'rejected'))
    OR (p_expected_status = 'approved' AND p_new_status = 'locked')
  ) THEN
    RAISE EXCEPTION 'Invalid payroll transition: % -> %',
      p_expected_status, p_new_status;
  END IF;

  v_sensitive_review := (
    (p_expected_status = 'submitted' AND p_new_status IN ('approved', 'rejected'))
    OR (p_expected_status = 'approved' AND p_new_status = 'locked')
  );

  IF v_sensitive_review THEN
    v_actor := public._assert_payroll_approval_actor(v_club_id);
  ELSIF public._is_payroll_accountant(v_club_id) THEN
    v_actor := auth.uid();
  ELSE
    v_actor := public.assert_payroll_actor(v_club_id);
  END IF;

  RETURN public.transition_payroll_status(
    p_period_id,
    p_expected_status,
    p_new_status,
    v_actor,
    p_rejection_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text)
  TO authenticated;

-- The caller-bound wrapper is the only browser path. Restate the legacy ACL so
-- a client cannot bypass review authority by supplying p_user_id directly.
REVOKE ALL ON FUNCTION public.transition_payroll_status(uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._assert_payroll_approval_actor(uuid) IS
  'Private caller-bound Owner/Club Admin/Super Admin gate for payroll approve, reject and lock.';
COMMENT ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text) IS
  'Caller-bound payroll transition. Cashiers and Accountants cannot approve, reject or lock payroll.';

COMMIT;
