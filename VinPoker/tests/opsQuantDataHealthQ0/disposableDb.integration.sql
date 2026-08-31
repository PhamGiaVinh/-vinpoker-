-- PostgreSQL 17 runtime assertions for Ops Quant Data Health Q0.
\set ON_ERROR_STOP on

DO $$
DECLARE
  resolved record;
BEGIN
  SELECT * INTO resolved FROM public.resolve_sepay_account_club_v1('CENTER-001');
  IF resolved.resolution_state <> 'RESOLVED_UNIQUE'
     OR resolved.resolved_club_id <> '10000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'canonical resolver failed: %', row_to_json(resolved);
  END IF;
  SELECT * INTO resolved FROM public.resolve_sepay_account_club_v1('UNMAPPED');
  IF resolved.resolution_state <> 'UNRESOLVED_NO_MAPPING' OR resolved.resolved_club_id IS NOT NULL THEN
    RAISE EXCEPTION 'unmapped resolver failed: %', row_to_json(resolved);
  END IF;
END $$;

DO $$
DECLARE
  acl_ok boolean;
BEGIN
  SELECT NOT has_function_privilege('authenticated', 'public.resolve_sepay_account_club_v1(text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.resolve_sepay_account_club_v1(text)', 'EXECUTE')
     AND NOT has_function_privilege('service_role', 'public.resolve_sepay_account_club_v1(text)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.get_ops_registration_pace_q0(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.get_ops_sepay_read_state_q0(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('service_role', 'public.get_ops_registration_pace_q0(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('service_role', 'public.get_ops_sepay_read_state_q0(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.get_ops_registration_pace_q0(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.get_ops_sepay_read_state_q0(uuid)', 'EXECUTE')
  INTO acl_ok;
  IF NOT acl_ok THEN RAISE EXCEPTION 'Q0 function ACL mismatch'; END IF;
END $$;

SET ROLE authenticated;
SELECT set_config('test.actor', '00000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  payload jsonb;
BEGIN
  payload := public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000001');
  IF payload #>> '{buckets,0,transactionCount}' <> '1'
     OR payload #>> '{buckets,0,inboundAmountVnd}' <> '100000'
     OR payload #>> '{buckets,1,transactionCount}' <> '2'
     OR payload #>> '{buckets,1,inboundAmountVnd}' <> '200000'
     OR payload #>> '{buckets,2,transactionCount}' <> '1'
     OR payload #>> '{buckets,2,amountAvailability}' <> 'partial' THEN
    RAISE EXCEPTION 'clean SePay aggregate mismatch: %', payload;
  END IF;
END $$;

DO $$
DECLARE
  payload jsonb;
  event jsonb;
BEGIN
  payload := public.get_ops_registration_pace_q0('10000000-0000-4000-8000-000000000001');
  event := payload #> '{events,0}';
  IF event->>'confirmedEntries' <> '4'
     OR event->>'uniquePlayers' <> '4'
     OR event->>'reentries' <> '1'
     OR event->>'last1h' <> '1'
     OR event->>'last6h' <> '2'
     OR event->>'last24h' <> '2'
     OR event->>'timelineAvailability' <> 'partial'
     OR event->>'timelineReasonCode' <> 'FUTURE_CONFIRMED_AT'
     OR pg_catalog.jsonb_array_length(event->'timeline') <> 2
     OR (event->>'firstRegistrationAt')::timestamptz > (payload->>'asOf')::timestamptz
     OR (event->>'lastRegistrationAt')::timestamptz > (payload->>'asOf')::timestamptz THEN
    RAISE EXCEPTION 'registration cutoff mismatch: %', payload;
  END IF;
END $$;

UPDATE public.tournament_registrations
SET status = 'cancelled'
WHERE id = '50000000-0000-4000-8000-000000000003';

DO $$
DECLARE
  event jsonb;
BEGIN
  event := public.get_ops_registration_pace_q0('10000000-0000-4000-8000-000000000001') #> '{events,0}';
  IF event->>'confirmedEntries' <> '3' OR event->>'timelineReasonCode' <> 'CONFIRMED_AT_MISSING' THEN
    RAISE EXCEPTION 'missing timestamp precedence mismatch: %', event;
  END IF;
END $$;

DO $$
DECLARE
  resolved text;
  payload jsonb;
BEGIN
  PERFORM set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  payload := public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000002');
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(payload->'buckets') AS bucket
    WHERE bucket->>'transactionCount' <> '0'
       OR bucket->>'inboundAmountVnd' <> '0'
       OR bucket->>'amountAvailability' <> 'exact'
  ) THEN
    RAISE EXCEPTION 'clean empty SePay aggregate mismatch: %', payload;
  END IF;
  BEGIN
    PERFORM public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'cross-club owner unexpectedly authorized';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  PERFORM public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000001');

  FOREACH resolved IN ARRAY ARRAY[
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000007'
  ] LOOP
    PERFORM set_config('test.actor', resolved, true);
    BEGIN
      PERFORM public.get_ops_registration_pace_q0('10000000-0000-4000-8000-000000000001');
      RAISE EXCEPTION 'non-owner unexpectedly authorized: %', resolved;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END $$;

SELECT set_config('test.actor', '00000000-0000-4000-8000-000000000001', false);

DO $$
BEGIN
  BEGIN
    PERFORM public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'missing mapping unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'SEPAY_ACCOUNT_MAPPING_MISSING' THEN RAISE; END IF;
  END;
END $$;

RESET ROLE;

UPDATE public.club_payment_config
SET master_account_number = 'CENTER-001'
WHERE club_id = '10000000-0000-4000-8000-000000000002';
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'active config conflict unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'SEPAY_ACTIVE_CONFIG_ACCOUNT_CONFLICT' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
UPDATE public.club_payment_config SET master_account_number = 'ROYAL-001' WHERE club_id = '10000000-0000-4000-8000-000000000002';

INSERT INTO public.platform_bank_accounts(id, account_number, club_id, is_active)
VALUES ('20000000-0000-4000-8000-000000000003', 'CENTER-001', '10000000-0000-4000-8000-000000000002', true);
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'ambiguous mapping unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'SEPAY_ACCOUNT_MAPPING_AMBIGUOUS' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;
DELETE FROM public.platform_bank_accounts WHERE id = '20000000-0000-4000-8000-000000000003';

INSERT INTO public.bank_transactions(id, provider, provider_txn_id, account_number, club_id, amount, transfer_type, occurred_at, status, created_at)
VALUES ('30000000-0000-4000-8000-000000000008', 'sepay', 'stored-conflict', 'CENTER-001', '10000000-0000-4000-8000-000000000002', 1, 'in', now() - interval '60 days', 'matched', now() - interval '60 days');
SET ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.get_ops_sepay_read_state_q0('10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'stored club conflict unexpectedly accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'SEPAY_STORED_CLUB_CONFLICT' THEN RAISE; END IF;
  END;
END $$;
RESET ROLE;

DO $$
BEGIN
  RAISE NOTICE 'OPS_QUANT_Q0_DISPOSABLE_PASS';
END $$;
