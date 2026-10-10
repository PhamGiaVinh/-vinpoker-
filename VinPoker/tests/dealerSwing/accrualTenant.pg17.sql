\set ON_ERROR_STOP on
-- Requires the existing cardBatchIntegrity synthetic fixture in the owned local DB.
-- Never run against production; no payroll policy or fixture survives this test.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'vinpoker_ops_card56_overlap_20261011' THEN
    RAISE EXCEPTION 'isolated_database_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clubs
    WHERE id='81000000-0000-4000-8000-000000000002'
      AND owner_id='81600000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'qualified_foreign_club_fixture_required';
  END IF;
END $$;
INSERT INTO public.user_roles(user_id,role)
VALUES ('81100000-0000-4000-8000-000000000001','club_admin');
CREATE TEMP TABLE policy_before AS
SELECT to_jsonb(p) AS payload FROM public.dealer_pt_wage_accrual_policies p
WHERE club_id='81000000-0000-4000-8000-000000000002';
CREATE TEMP TABLE audit_before AS
SELECT to_jsonb(a) AS payload FROM public.payroll_audit_log a
WHERE club_id='81000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.set_all_approved_dealer_pt_wage_accrual(false,'Non-admin global wrapper local test');
    RAISE EXCEPTION 'NON_ADMIN_GLOBAL_POLICY_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
DO $$ BEGIN
  BEGIN
    PERFORM public.set_dealer_pt_wage_accrual_policy(
      '81000000-0000-4000-8000-000000000002',false,NULL,
      'Isolated cross-club regression; rollback only');
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FOREIGN_CLUB_POLICY_MUTATION_ACCEPTED';
END $$;
DO $$ DECLARE v_actor text; BEGIN
  FOREACH v_actor IN ARRAY ARRAY['81400000-0000-4000-8000-000000000001',''] LOOP
    PERFORM set_config('request.jwt.claim.sub',v_actor,true);
    BEGIN
      PERFORM public.set_dealer_pt_wage_accrual_policy(
        '81000000-0000-4000-8000-000000000002',false,NULL,'Negative actor local test');
      RAISE EXCEPTION 'UNAUTHORIZED_ACTOR_ACCEPTED';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;
SELECT set_config('request.jwt.claim.sub','81100000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.set_dealer_pt_wage_accrual_policy(
      '81000000-0000-4000-8000-000000000002',false,NULL,'Anonymous local test');
    RAISE EXCEPTION 'ANON_POLICY_EXECUTION_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.set_dealer_pt_wage_accrual_policy(
      '81000000-0000-4000-8000-000000000002',false,NULL,'Service role local test');
    RAISE EXCEPTION 'SERVICE_POLICY_EXECUTION_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (
    (SELECT payload FROM policy_before EXCEPT SELECT to_jsonb(p)
      FROM public.dealer_pt_wage_accrual_policies p WHERE club_id='81000000-0000-4000-8000-000000000002')
    UNION ALL
    (SELECT to_jsonb(p) FROM public.dealer_pt_wage_accrual_policies p
      WHERE club_id='81000000-0000-4000-8000-000000000002' EXCEPT SELECT payload FROM policy_before)
  ) OR EXISTS (
    (SELECT payload FROM audit_before EXCEPT SELECT to_jsonb(a)
      FROM public.payroll_audit_log a WHERE club_id='81000000-0000-4000-8000-000000000002')
    UNION ALL
    (SELECT to_jsonb(a) FROM public.payroll_audit_log a
      WHERE club_id='81000000-0000-4000-8000-000000000002' EXCEPT SELECT payload FROM audit_before)
  ) THEN RAISE EXCEPTION 'FOREIGN_CLUB_DENIAL_CHANGED_STATE'; END IF;
END $$;
-- Exact owner remains authorized without relying on a global club_admin role.
DELETE FROM public.user_roles WHERE user_id='81100000-0000-4000-8000-000000000001' AND role='club_admin';
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_first jsonb; v_replay jsonb; BEGIN
  v_first := public.set_dealer_pt_wage_accrual_policy(
    '81000000-0000-4000-8000-000000000001',false,NULL,'Owned club local test');
  v_replay := public.set_dealer_pt_wage_accrual_policy(
    '81000000-0000-4000-8000-000000000001',false,NULL,'Owned club local test');
  IF v_first->>'club_id' IS DISTINCT FROM '81000000-0000-4000-8000-000000000001'
     OR v_replay->>'idempotent' IS DISTINCT FROM 'true'
     OR (v_first-'idempotent') IS DISTINCT FROM (v_replay-'idempotent') THEN
    RAISE EXCEPTION 'OWNED_CLUB_REPLAY_FAILED';
  END IF;
END $$;
RESET ROLE;
INSERT INTO public.user_roles(user_id,role)
VALUES ('81600000-0000-4000-8000-000000000001','super_admin');
SELECT set_config('request.jwt.claim.sub','81600000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_result jsonb; BEGIN
  v_result := public.set_dealer_pt_wage_accrual_policy(
    '81000000-0000-4000-8000-000000000001',true,NULL,'Super admin local test');
  IF v_result->>'club_id' IS DISTINCT FROM '81000000-0000-4000-8000-000000000001'
     OR v_result->>'standby_accrual_enabled' IS DISTINCT FROM 'true'
     OR v_result->>'effective_from' IS NULL THEN
    RAISE EXCEPTION 'SUPER_ADMIN_POLICY_FAILED';
  END IF;
END $$;
RESET ROLE;
-- Exercise the real all-club wrapper against only these two local fixtures.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.clubs WHERE status='approved')
     OR EXISTS (SELECT 1 FROM public.dealer_pt_wage_accrual_global_policy) THEN
    RAISE EXCEPTION 'global_wrapper_fixture_must_be_empty';
  END IF;
END $$;
INSERT INTO public.dealer_pt_wage_accrual_global_policy(future_club_enabled) VALUES(false);
UPDATE public.clubs SET status='approved'
WHERE id IN ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_result jsonb; v_replay jsonb; BEGIN
  v_result := public.set_all_approved_dealer_pt_wage_accrual(false,'Global wrapper isolated regression');
  v_replay := public.set_all_approved_dealer_pt_wage_accrual(false,'Global wrapper isolated regression');
  IF v_result->>'clubs_processed' IS DISTINCT FROM '2'
     OR v_result->>'future_club_enabled' IS DISTINCT FROM 'false'
     OR v_replay->>'idempotent' IS DISTINCT FROM 'true'
     OR v_replay->>'clubs_changed' IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'SUPER_ADMIN_GLOBAL_WRAPPER_FAILED';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.dealer_pt_wage_accrual_policies
      WHERE club_id IN ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002')
        AND standby_accrual_enabled=false) <> 2 THEN
    RAISE EXCEPTION 'GLOBAL_WRAPPER_POLICY_POSTCONDITION_FAILED';
  END IF;
END $$;
ROLLBACK;
\echo ACCRUAL_TENANT_DENIAL_AND_OWNER_REPLAY_PASS
