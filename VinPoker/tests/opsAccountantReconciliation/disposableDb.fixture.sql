\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;

CREATE SCHEMA auth;

CREATE TYPE public.app_role AS ENUM (
  'player',
  'cashier',
  'club_cashier',
  'club_admin',
  'super_admin'
);

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id)
);

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role public.app_role NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE public.club_cashiers (
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE public.club_accountants (
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (club_id, user_id)
);

CREATE TABLE public.payroll_periods (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  status text NOT NULL CHECK (
    status IN ('draft', 'submitted', 'approved', 'locked', 'rejected')
  ),
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  locked_by uuid,
  locked_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE FUNCTION public.has_role(p_user_id uuid, p_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.role = p_role
  );
$$;

CREATE FUNCTION public.is_club_admin(p_user_id uuid, p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = p_club_id AND c.owner_id = p_user_id
  );
$$;

CREATE FUNCTION public._is_payroll_accountant(p_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.club_accountants ca
      WHERE ca.club_id = p_club_id AND ca.user_id = auth.uid()
    );
$$;

-- Canonical broad payroll actor used by draft/submit/payment lifecycle paths.
-- This deliberately reproduces the vulnerable pre-patch Cashier membership.
CREATE FUNCTION public.assert_payroll_actor(p_club_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT (
    public.has_role(v_actor, 'super_admin'::public.app_role)
    OR public.has_role(v_actor, 'club_admin'::public.app_role)
    OR public.is_club_admin(v_actor, p_club_id)
    OR (
      (
        public.has_role(v_actor, 'cashier'::public.app_role)
        OR public.has_role(v_actor, 'club_cashier'::public.app_role)
      )
      AND EXISTS (
        SELECT 1 FROM public.club_cashiers cc
        WHERE cc.club_id = p_club_id AND cc.user_id = v_actor
      )
    )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

CREATE FUNCTION public.transition_payroll_status(
  p_period_id uuid,
  p_expected_status text,
  p_new_status text,
  p_user_id uuid,
  p_rejection_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT pp.status INTO v_status
  FROM public.payroll_periods pp
  WHERE pp.id = p_period_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Payroll period not found';
  END IF;
  IF v_status <> p_expected_status THEN
    RAISE EXCEPTION 'Expected status %, but current status is %',
      p_expected_status, v_status;
  END IF;

  UPDATE public.payroll_periods
  SET status = p_new_status,
      submitted_by = CASE WHEN p_new_status = 'submitted' THEN p_user_id ELSE submitted_by END,
      submitted_at = CASE WHEN p_new_status = 'submitted' THEN now() ELSE submitted_at END,
      approved_by = CASE WHEN p_new_status = 'approved' THEN p_user_id ELSE approved_by END,
      approved_at = CASE WHEN p_new_status = 'approved' THEN now() ELSE approved_at END,
      locked_by = CASE WHEN p_new_status = 'locked' THEN p_user_id ELSE locked_by END,
      locked_at = CASE WHEN p_new_status = 'locked' THEN now() ELSE locked_at END,
      rejected_by = CASE WHEN p_new_status = 'rejected' THEN p_user_id ELSE rejected_by END,
      rejected_at = CASE WHEN p_new_status = 'rejected' THEN now() ELSE rejected_at END,
      rejection_reason = CASE WHEN p_new_status = 'rejected' THEN p_rejection_reason ELSE rejection_reason END,
      updated_at = now()
  WHERE id = p_period_id;

  RETURN true;
END;
$$;

-- Canonical pre-patch wrapper: accountants are excluded from sensitive review,
-- but Cashiers still fall through to the broad assert_payroll_actor helper.
CREATE FUNCTION public.transition_payroll_status_secure(
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
  v_actor uuid;
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
  THEN
    v_actor := auth.uid();
  ELSE
    v_actor := public.assert_payroll_actor(v_club_id);
  END IF;

  RETURN public.transition_payroll_status(
    p_period_id, p_expected_status, p_new_status, v_actor, p_rejection_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_payroll_status(uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_payroll_status_secure(uuid, text, text, text)
  TO authenticated;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;

INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'), -- owner A
  ('00000000-0000-4000-8000-000000000002'), -- cashier A
  ('00000000-0000-4000-8000-000000000003'), -- accountant A
  ('00000000-0000-4000-8000-000000000004'), -- super admin
  ('00000000-0000-4000-8000-000000000005'), -- global club admin
  ('00000000-0000-4000-8000-000000000006'), -- cashier B
  ('00000000-0000-4000-8000-000000000007'); -- owner B

INSERT INTO public.clubs (id, owner_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000007');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000002', 'cashier'),
  ('00000000-0000-4000-8000-000000000004', 'super_admin'),
  ('00000000-0000-4000-8000-000000000005', 'club_admin'),
  ('00000000-0000-4000-8000-000000000006', 'cashier');

INSERT INTO public.club_cashiers (club_id, user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000006');

INSERT INTO public.club_accountants (club_id, user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');

INSERT INTO public.payroll_periods (id, club_id, status) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'submitted'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'submitted'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'approved'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'draft'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'draft'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'submitted'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'submitted'),
  ('30000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000001', 'approved'),
  ('30000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000001', 'submitted'),
  ('30000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'submitted'),
  ('30000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000002', 'submitted'),
  ('30000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000001', 'submitted');

CREATE FUNCTION public.test_assert(p_ok boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION 'assertion_failed: %', p_message;
  END IF;
END;
$$;

CREATE FUNCTION public.test_expect_transition_denied(
  p_actor uuid,
  p_period uuid,
  p_expected text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before text;
  v_after text;
  v_denied boolean := false;
BEGIN
  SELECT status INTO v_before FROM public.payroll_periods WHERE id = p_period;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_actor::text, ''), true);
  BEGIN
    PERFORM public.transition_payroll_status_secure(p_period, p_expected, p_new, 'test');
  EXCEPTION
    WHEN SQLSTATE '42501' THEN v_denied := true;
  END;
  SELECT status INTO v_after FROM public.payroll_periods WHERE id = p_period;
  IF NOT v_denied OR v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'expected denied transition % -> % with unchanged row', p_expected, p_new;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.test_expect_transition_denied(uuid, uuid, text, text)
  TO authenticated;

SELECT 'ops Accountant payroll disposable fixture ready' AS result;
