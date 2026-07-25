-- Dealer PT standby accrual tests.
-- Run only against a disposable database restored from the current schema with
-- 20270105000001_dealer_pt_standby_accrual_policy.sql applied. All writes roll back.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_value boolean, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_value IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assert_true failed: %', p_label;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_eq(p_actual text, p_expected text, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'assert_eq failed: % (actual=%, expected=%)', p_label, p_actual, p_expected;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'anon',
    'public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'anon cannot change a PT wage policy'
);
SELECT pg_temp.assert_true(
  has_function_privilege(
    'authenticated',
    'public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'authenticated enters the server authorization path'
);
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.dealer_pt_wage_accrual_policies', 'SELECT'),
  'policy table is not directly readable by authenticated'
);
SELECT pg_temp.assert_true(
  NOT has_table_privilege('authenticated', 'public.dealer_pt_wage_accrual_policies', 'INSERT'),
  'policy table is not directly writable by authenticated'
);

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('ea000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pt-owner@test.invalid', now(), now()),
  ('ea000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-owner@test.invalid', now(), now()),
  ('ea000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'pt-dealer@test.invalid', now(), now());

INSERT INTO public.clubs (id, owner_id, name, region, status)
VALUES
  ('eb000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000001', 'PT POLICY TEST', 'HCM', 'approved'),
  ('eb000000-0000-4000-8000-000000000002', 'ea000000-0000-4000-8000-000000000002', 'PT OTHER CLUB', 'HCM', 'approved');

INSERT INTO public.dealers (
  id, club_id, user_id, full_name, status, employment_type, hourly_rate_vnd
)
VALUES
  ('ec000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-000000000003', 'PT closed attendance', 'active', 'part_time', 50000),
  ('ec000000-0000-4000-8000-000000000002', 'eb000000-0000-4000-8000-000000000001', NULL, 'PT open attendance', 'active', 'part_time', 50000),
  ('ec000000-0000-4000-8000-000000000003', 'eb000000-0000-4000-8000-000000000001', NULL, 'PT effective boundary', 'active', 'part_time', 50000),
  ('ec000000-0000-4000-8000-000000000004', 'eb000000-0000-4000-8000-000000000001', NULL, 'FT excluded', 'active', 'full_time', 50000);

INSERT INTO public.dealer_attendance (
  id, dealer_id, shift_date, status, current_state, check_in_time, check_out_time
)
VALUES
  ('ed000000-0000-4000-8000-000000000001', 'ec000000-0000-4000-8000-000000000001', current_date - 2, 'checked_out', 'available', now() - interval '30 hours', now()),
  ('ed000000-0000-4000-8000-000000000002', 'ec000000-0000-4000-8000-000000000002', current_date - 2, 'checked_in', 'available', now() - interval '30 hours', NULL),
  ('ed000000-0000-4000-8000-000000000003', 'ec000000-0000-4000-8000-000000000003', current_date - 2, 'checked_out', 'available', now() - interval '30 hours', now()),
  ('ed000000-0000-4000-8000-000000000004', 'ec000000-0000-4000-8000-000000000004', current_date - 2, 'checked_out', 'available', now() - interval '30 hours', now());

SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE v_closed jsonb; v_open jsonb; v_club jsonb;
BEGIN
  v_closed := public._pt_wage_balance('ec000000-0000-4000-8000-000000000001');
  v_open := public._pt_wage_balance('ec000000-0000-4000-8000-000000000002');
  v_club := public.get_club_pt_wages('eb000000-0000-4000-8000-000000000001');

  PERFORM pg_temp.assert_eq(v_closed->>'accrual_mode', 'capped_24h', 'default policy remains capped');
  PERFORM pg_temp.assert_eq(v_closed->>'accrued_minutes', '1440', 'legacy cap preserves 24 hours on a 30-hour closed attendance');
  PERFORM pg_temp.assert_eq(v_open->>'current_shift_cap_reached', 'true', 'open attendance reports the legacy cap');
  PERFORM pg_temp.assert_eq(v_open->>'live_accrual_active', 'false', 'client cannot estimate accrual after server cap');
  PERFORM pg_temp.assert_eq(v_club->>'standby_accrual_enabled', 'false', 'club policy is off until explicitly enabled');
END;
$$;

DO $$
DECLARE v_first jsonb; v_replay jsonb; v_closed jsonb; v_open jsonb; v_self jsonb;
BEGIN
  v_first := public.set_dealer_pt_wage_accrual_policy(
    'eb000000-0000-4000-8000-000000000001',
    true,
    null,
    'controlled historical standby accrual test'
  );
  v_replay := public.set_dealer_pt_wage_accrual_policy(
    'eb000000-0000-4000-8000-000000000001',
    true,
    null,
    'same request is state-idempotent'
  );
  v_closed := public._pt_wage_balance('ec000000-0000-4000-8000-000000000001');
  v_open := public._pt_wage_balance('ec000000-0000-4000-8000-000000000002');

  PERFORM pg_temp.assert_eq(v_first->>'idempotent', 'false', 'first policy write is recorded');
  PERFORM pg_temp.assert_eq(v_replay->>'idempotent', 'true', 'same policy state does not duplicate audit');
  PERFORM pg_temp.assert_eq(v_closed->>'accrual_mode', 'continuous_standby', 'enabled policy selects continuous mode');
  PERFORM pg_temp.assert_true((v_closed->>'accrued_minutes')::int >= 1800, 'all unpaid 30-hour closed attendance is included');
  PERFORM pg_temp.assert_eq(v_open->>'live_accrual_active', 'true', 'open standby attendance remains live');

  PERFORM set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000003', true);
  SELECT public.get_my_pt_wage('ec000000-0000-4000-8000-000000000001') INTO v_self;
  PERFORM pg_temp.assert_eq(v_self->>'accrual_mode', 'continuous_standby', 'self read exposes only server-derived policy state');
  PERFORM set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000001', true);
END;
$$;

DO $$
DECLARE v jsonb;
BEGIN
  v := public.set_dealer_pt_wage_accrual_policy(
    'eb000000-0000-4000-8000-000000000001',
    true,
    now() - interval '2 hours',
    'effective boundary test'
  );
  PERFORM pg_temp.assert_eq(v->>'idempotent', 'false', 'changed boundary updates policy');
  v := public._pt_wage_balance('ec000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.assert_true(
    (v->>'accrued_minutes')::int between 120 and 121,
    'effective boundary includes only the two recent unpaid hours'
  );
END;
$$;

DO $$
DECLARE v_first jsonb; v_replay jsonb; v_post jsonb;
BEGIN
  -- Restore the all-unpaid policy before payout so the immutable snapshot has
  -- the exact owner-approved mode used to calculate this payment.
  PERFORM public.set_dealer_pt_wage_accrual_policy(
    'eb000000-0000-4000-8000-000000000001',
    true,
    null,
    'restore all unpaid before payment test'
  );

  v_first := public.pay_part_time_balance(
    'ec000000-0000-4000-8000-000000000001',
    'cash',
    null,
    'pt-standby-test-replay',
    'disposable test payout'
  );
  v_replay := public.pay_part_time_balance(
    'ec000000-0000-4000-8000-000000000001',
    'cash',
    null,
    'pt-standby-test-replay',
    'disposable test payout'
  );
  v_post := public._pt_wage_balance('ec000000-0000-4000-8000-000000000001');

  PERFORM pg_temp.assert_eq(v_first->>'idempotent', 'false', 'first payout writes once');
  PERFORM pg_temp.assert_eq(v_replay->>'idempotent', 'true', 'payout replay returns existing immutable receipt');
  PERFORM pg_temp.assert_eq(v_first->'accrual_policy_snapshot'->>'accrual_mode', 'continuous_standby', 'payout records policy snapshot');
  PERFORM pg_temp.assert_true((v_post->>'accrued_minutes')::int <= 1, 'payout reset anchor excludes already-paid time');
  PERFORM pg_temp.assert_eq(
    (SELECT count(*)::text FROM public.dealer_pt_wage_payments
     WHERE dealer_id = 'ec000000-0000-4000-8000-000000000001'
       AND idempotency_key = 'pt-standby-test-replay'),
    '1',
    'payout replay cannot insert a second payment'
  );
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'ea000000-0000-4000-8000-000000000002', true);

DO $$
BEGIN
  PERFORM public.set_dealer_pt_wage_accrual_policy(
    'eb000000-0000-4000-8000-000000000001',
    false,
    null,
    'cross-club attempt'
  );
  RAISE EXCEPTION 'cross-club policy mutation unexpectedly succeeded';
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
END;
$$;

RESET ROLE;

SELECT pg_temp.assert_eq(
  (SELECT count(*)::text FROM public.payroll_audit_log
   WHERE table_name = 'dealer_pt_wage_accrual_policies'
     AND club_id = 'eb000000-0000-4000-8000-000000000001'),
  '3',
  'state-idempotent policy replay does not write a duplicate audit row'
);
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM public.dealer_pt_wage_payments w
    WHERE w.dealer_id = 'ec000000-0000-4000-8000-000000000004'
  ),
  'full-time dealer remains outside the PT wage path'
);

DO $$
BEGIN
  RAISE NOTICE 'dealer PT standby accrual policy SQL tests passed';
END;
$$;

ROLLBACK;
