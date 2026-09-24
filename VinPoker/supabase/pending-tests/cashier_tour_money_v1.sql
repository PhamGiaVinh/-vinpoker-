-- Disposable PostgreSQL only, after applying the pending Cashier V1 migration
-- to that disposable database. Run with psql -v ON_ERROR_STOP=1.
-- Do not run on the linked production project. All fixtures roll back.
\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.cashier_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'cashier test failed: %', p_label;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.cashier_force_seating_error()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cashier_paid_at IS NOT NULL AND NEW.cashier_seating_error IS NULL THEN
    RAISE EXCEPTION 'TEST seating exception after cash was recorded';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('91000000-0000-4000-8000-000000000001','authenticated','authenticated','cashier-owner-a@test.invalid',now(),now()),
  ('91000000-0000-4000-8000-000000000002','authenticated','authenticated','cashier-owner-b@test.invalid',now(),now()),
  ('91000000-0000-4000-8000-000000000003','authenticated','authenticated','cashier-player-free@test.invalid',now(),now()),
  ('91000000-0000-4000-8000-000000000004','authenticated','authenticated','cashier-player-paid@test.invalid',now(),now());
-- The synthetic baseline pre-seeds this profile; the captured live schema is
-- schema-only. Keep the same named TEST player in both disposable test paths.
INSERT INTO public.profiles(user_id,display_name) VALUES
  ('91000000-0000-4000-8000-000000000004','Người chơi TEST')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Cashier TEST A','HCM','approved'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','Cashier TEST B','HCM','approved');

INSERT INTO public.tournaments
  (id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount,
   free_rake_enabled,free_rake_slots,free_rake_used)
VALUES
  ('93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
   'Cashier TEST Tour A','registering','registering',now()+interval '1 day',6000000,600000,0,true,1,0),
  ('93000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002',
   'Cashier TEST Tour B','registering','registering',now()+interval '1 day',6000000,600000,0,false,0,0),
  ('93000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001',
   'Cashier TEST Tour C','registering','registering',now()+interval '1 day',6000000,600000,0,false,0,0);

INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES
  ('92000000-0000-4000-8000-000000000001',true),
  ('92000000-0000-4000-8000-000000000002',true);

-- Applying the migration alone must not route an unenabled club through the
-- new server-priced registration path.
UPDATE public.cashier_tour_settings SET enabled=false
  WHERE club_id='92000000-0000-4000-8000-000000000002';
DO $test$
DECLARE v_result jsonb;
BEGIN
  v_result:=public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000004');
  IF v_result->>'error'<>'cashier_tour_disabled' THEN
    RAISE EXCEPTION 'cashier test failed: disabled club entered new registration path';
  END IF;
END $test$;
UPDATE public.cashier_tour_settings SET enabled=true
  WHERE club_id='92000000-0000-4000-8000-000000000002';

INSERT INTO public.platform_bank_accounts
  (id,club_id,bank_name,account_number,account_holder,is_active)
VALUES
  ('94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
   'TEST BANK','999000001','TEST A',true),
  ('94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002',
   'TEST BANK','999000002','TEST B',true);

INSERT INTO public.sepay_system_settings(id,system_actor_id,auto_confirm_enabled)
VALUES (true,'91000000-0000-4000-8000-000000000001',true)
ON CONFLICT (id) DO UPDATE SET
  system_actor_id=EXCLUDED.system_actor_id,
  auto_confirm_enabled=EXCLUDED.auto_confirm_enabled;

DO $test$
DECLARE
  v_free jsonb;
  v_paid jsonb;
  v_other_club jsonb;
  v_bank jsonb;
  v_cash jsonb;
  v_repeat jsonb;
  v_report jsonb;
  v_issues jsonb;
  v_lookup jsonb;
  v_refund jsonb;
  v_retry jsonb;
  v_refund_id uuid;
  v_shift_id uuid;
  v_busted_entry_id uuid;
  v_reg_id uuid;
  v_ref text;
  v_count integer;
  v_guard_rejected boolean;
BEGIN
  -- The service-owned registration path fixes price and consumes one free slot.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  v_free := public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003');
  v_paid := public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.cashier_assert(v_free->>'ok'='true' AND (v_free->>'total_pay')::bigint=6000000,
    'free rake first registration pays exactly 6m');
  PERFORM pg_temp.cashier_assert(v_paid->>'ok'='true' AND (v_paid->>'total_pay')::bigint=6600000,
    'next registration pays exactly 6.6m');
  PERFORM pg_temp.cashier_assert((SELECT free_rake_used=1 FROM public.tournaments
    WHERE id='93000000-0000-4000-8000-000000000001'), 'one free-rake slot consumed');
  v_repeat := public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.cashier_assert(v_repeat->>'already_registered'='true'
    AND (SELECT free_rake_used=1 FROM public.tournaments
      WHERE id='93000000-0000-4000-8000-000000000001'),
    'registration retry does not consume another free slot');
  v_reg_id := (v_paid->>'registration_id')::uuid;
  v_ref := v_paid->>'reference_code';

  -- Searching another tour must exclude the serving tour before LIMIT 10.
  PERFORM public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000004');
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
  v_lookup := public.cashier_lookup_tour_v1(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001','Người');
  PERFORM pg_temp.cashier_assert(v_lookup->>'ok'='true'
    AND jsonb_array_length(v_lookup->'rows')=1
    AND v_lookup->'rows'->0->>'tournament_id'='93000000-0000-4000-8000-000000000003',
    'other-tour lookup excludes serving tour in SQL: '||v_lookup::text);
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);

  INSERT INTO public.bank_transactions
    (id,provider,provider_txn_id,account_number,amount,transfer_type,content,
     status,api_verified_at,raw_payload)
  VALUES
    ('95000000-0000-4000-8000-000000000001','sepay','cashier-test-bank-1','999000001',
     1300000,'in',v_ref,'unmatched',now(),'{}'::jsonb);

  v_bank := public.cashier_record_verified_bank_v1(
    '95000000-0000-4000-8000-000000000001',false);
  PERFORM pg_temp.cashier_assert(v_bank->>'handled'='false'
    AND (SELECT status='unmatched' FROM public.bank_transactions
      WHERE id='95000000-0000-4000-8000-000000000001')
    AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements
      WHERE bank_transaction_id='95000000-0000-4000-8000-000000000001'),
    'disabled auto-confirm leaves verified bank transfer unallocated for later retry');
  v_bank := public.cashier_record_verified_bank_v1(
    '95000000-0000-4000-8000-000000000001',true);
  PERFORM pg_temp.cashier_assert(v_bank->>'outcome'='partial_received'
    AND (v_bank->>'applied')::bigint=1300000, 'verified bank partial is allocated once');
  v_guard_rejected:=false;
  BEGIN
    UPDATE public.tournament_registrations SET status='confirmed' WHERE id=v_reg_id;
  EXCEPTION WHEN OTHERS THEN
    v_guard_rejected:=SQLERRM='Verified buy-in total is insufficient for confirmation';
  END;
  PERFORM pg_temp.cashier_assert(v_guard_rejected
    AND (SELECT status='pending' FROM public.tournament_registrations WHERE id=v_reg_id),
    'partial bank payment cannot be confirmed by a legacy status update');
  v_repeat := public.cashier_record_verified_bank_v1(
    '95000000-0000-4000-8000-000000000001',true);
  PERFORM pg_temp.cashier_assert(v_repeat->>'handled'='false',
    'repeated bank transaction does not allocate again');

  -- The global SePay bot is authorized per club, not across all clubs by
  -- default. Club B must opt in before its verified transfer can settle.
  v_other_club := public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.cashier_assert(v_other_club->>'ok'='true'
    AND (v_other_club->>'total_pay')::bigint=6600000,
    'second club has its own server-priced registration');
  INSERT INTO public.bank_transactions
    (id,provider,provider_txn_id,account_number,amount,transfer_type,content,
     status,api_verified_at,raw_payload)
  VALUES
    ('95000000-0000-4000-8000-000000000002','sepay','cashier-test-bank-2','999000002',
     6600000,'in',v_other_club->>'reference_code','unmatched',now(),'{}'::jsonb);
  v_repeat := public.cashier_record_verified_bank_v1(
    '95000000-0000-4000-8000-000000000002',true);
  PERFORM pg_temp.cashier_assert(v_repeat->>'handled'='false'
    AND (SELECT status='unmatched' FROM public.bank_transactions
      WHERE id='95000000-0000-4000-8000-000000000002'),
    'second club cannot auto-settle before bot opt-in');
  INSERT INTO public.club_cashiers(club_id,user_id,granted_by) VALUES
    ('92000000-0000-4000-8000-000000000002',
     '91000000-0000-4000-8000-000000000001',
     '91000000-0000-4000-8000-000000000002');
  EXECUTE 'CREATE TRIGGER cashier_test_bank_seating_error BEFORE UPDATE ON public.tournament_registrations
    FOR EACH ROW EXECUTE FUNCTION pg_temp.cashier_force_seating_error()';
  v_bank := public.cashier_record_verified_bank_v1(
    '95000000-0000-4000-8000-000000000002',true);
  PERFORM pg_temp.cashier_assert(v_bank->>'outcome'='paid_seating_review'
    AND (v_bank->>'applied')::bigint=6600000,
    'opted-in second club keeps verified transfer when seating throws');
  EXECUTE 'DROP TRIGGER cashier_test_bank_seating_error ON public.tournament_registrations';
  SELECT count(*) INTO v_count FROM public.cashier_buyin_movements
    WHERE club_id='92000000-0000-4000-8000-000000000002' AND purpose='buyin';
  PERFORM pg_temp.cashier_assert(v_count=1,
    'second-club transfer creates exactly one isolated movement');
  PERFORM pg_temp.cashier_assert(
    (SELECT status='matched' FROM public.bank_transactions
      WHERE id='95000000-0000-4000-8000-000000000002')
    AND (SELECT cashier_paid_at IS NOT NULL AND cashier_seating_error='seating_exception'
      FROM public.tournament_registrations
      WHERE id=(v_other_club->>'registration_id')::uuid),
    'bank movement and paid marker survive a seating exception');

  -- A cashier from another club cannot touch this registration.
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
  v_cash := public.cashier_record_cash_buyin_v1(v_reg_id,5300000,
    '96000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.cashier_assert(v_cash->>'error'='actor_not_allowed',
    'other-club owner cannot receive cash');

  PERFORM set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
  v_cash := public.cashier_open_shift_v1(
    '92000000-0000-4000-8000-000000000001',1000000);
  PERFORM pg_temp.cashier_assert(v_cash->>'ok'='true','shared till opens');
  v_shift_id := (v_cash->>'shift_id')::uuid;
  v_repeat := public.cashier_adjust_shift_v1(v_shift_id,'in',100000,
    'TEST correction only after close','96000000-0000-4000-8000-000000000099');
  PERFORM pg_temp.cashier_assert(v_repeat->>'error'='shift_not_closed',
    'post-close correction cannot change an open till');
  v_cash := public.cashier_record_cash_buyin_v1(v_reg_id,5300000,
    '96000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.cashier_assert(v_cash->>'payment_state'='paid'
    AND v_cash->>'seating_state'='waiting',
    'split 1.3m bank plus 5.3m cash is paid and waits without a table');
  v_repeat := public.cashier_record_cash_buyin_v1(v_reg_id,5300000,
    '96000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.cashier_assert(v_repeat->>'already_recorded'='true',
    'cash double-click records once');
  v_repeat := public.cashier_record_cash_buyin_v1(v_reg_id,1,
    '96000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.cashier_assert(v_repeat->>'error'='amount_exceeds_remaining',
    'overpayment is rejected');

  SELECT count(*) INTO v_count FROM public.cashier_buyin_movements
    WHERE registration_id=v_reg_id AND purpose='buyin';
  PERFORM pg_temp.cashier_assert(v_count=2,'exactly two buy-in movements');
  SELECT count(*) INTO v_count FROM public.seat_draw_receipts WHERE registration_id=v_reg_id;
  PERFORM pg_temp.cashier_assert(v_count=0,'no table means no invented receipt');
  INSERT INTO public.bank_transactions
    (id,provider,provider_txn_id,account_number,amount,transfer_type,content,
     status,api_verified_at,raw_payload)
  VALUES ('95000000-0000-4000-8000-000000000003','sepay','cashier-test-unmatched',
    '999000001',500000,'in','TEST NO BUYIN CODE','unmatched',now(),'{}'::jsonb);
  v_report := public.cashier_cashflow_range_v1(
    '92000000-0000-4000-8000-000000000001',now()-interval '1 minute',now()+interval '1 minute');
  PERFORM pg_temp.cashier_assert((v_report#>>'{cash_flow,cash_in}')::bigint=5300000
    AND (v_report#>>'{cash_flow,bank_in}')::bigint=1300000
    AND (v_report->>'unmatched_verified_bank')::bigint=500000
    AND (v_report#>>'{cash_flow,unallocated_bank}')::bigint=0
    AND (v_report#>>'{entry_allocation,prize_delta}')::bigint=0
    AND (v_report#>>'{entry_allocation,fees_delta}')::bigint=0,
    'paid waiting-seat money is cash flow, not prize or fee allocation');
  v_issues := public.cashier_tour_issues_v1('92000000-0000-4000-8000-000000000001',NULL);
  PERFORM pg_temp.cashier_assert(jsonb_array_length(v_issues->'rows')=1
    AND v_issues->'rows'->0->>'kind'='unmatched',
    'exclusive club account shows its unmatched verified transfer');
  v_issues := public.cashier_tour_issues_v1(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.cashier_assert(jsonb_array_length(v_issues->'rows')=1
    AND v_issues->'rows'->0->>'kind'='unmatched',
    'tour cashier still sees club transfer with missing buy-in code');
  INSERT INTO public.platform_bank_accounts
    (id,club_id,bank_name,account_number,account_holder,is_active)
  VALUES ('94000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000002','TEST BANK','999000001','TEST SHARED',true);
  v_issues := public.cashier_tour_issues_v1('92000000-0000-4000-8000-000000000001',NULL);
  PERFORM pg_temp.cashier_assert(jsonb_array_length(v_issues->'rows')=0,
    'shared bank account does not expose unmatched payment in first club');
  v_issues := public.cashier_tour_issues_v1('92000000-0000-4000-8000-000000000002',NULL);
  PERFORM pg_temp.cashier_assert(jsonb_array_length(v_issues->'rows')=0,
    'shared bank account does not expose unmatched payment in second club');

  v_refund := public.cashier_request_refund_v1(v_reg_id,'TEST full refund before seating');
  PERFORM pg_temp.cashier_assert(v_refund->>'ok'='true'
    AND (v_refund->>'amount')::bigint=6600000,
    'refund includes the entire 6.6m actually paid');
  v_refund_id := (v_refund->>'refund_id')::uuid;
  PERFORM pg_temp.cashier_assert(
    public.cashier_floor_clear_refund_v1(v_refund_id)->>'status'='floor_cleared',
    'Floor clearance before payout');
  v_refund := public.cashier_complete_refund_v1(v_refund_id,5300000,1300000,
    'TEST-RETURN-1','TEST transfer and cash payout evidence');
  PERFORM pg_temp.cashier_assert(v_refund->>'ok'='true',
    'cashier records the full payout');
  SELECT count(*) INTO v_count FROM public.cashier_buyin_movements
    WHERE refund_id=v_refund_id AND direction='out';
  PERFORM pg_temp.cashier_assert(v_count=2,'one cash and one bank refund movement');
  v_repeat := public.cashier_complete_refund_v1(v_refund_id,5300000,1300000,
    'TEST-RETURN-1','TEST transfer and cash payout evidence');
  PERFORM pg_temp.cashier_assert(v_repeat->>'already_paid'='true',
    'refund retry does not pay twice');
  PERFORM pg_temp.cashier_assert(
    (SELECT status='cancelled' FROM public.tournament_registrations WHERE id=v_reg_id),
    'registration closes only after the refund');

  -- The free-rake player paid 6m, so the refund must be 6m, not today's
  -- regular 6.6m price and not a fee-recalculated amount.
  v_reg_id := (v_free->>'registration_id')::uuid;
  EXECUTE 'CREATE TRIGGER cashier_test_seating_error BEFORE UPDATE ON public.tournament_registrations
    FOR EACH ROW EXECUTE FUNCTION pg_temp.cashier_force_seating_error()';
  v_cash := public.cashier_record_cash_buyin_v1(v_reg_id,6000000,
    '96000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.cashier_assert(v_cash->>'payment_state'='paid'
    AND v_cash->>'seating_state'='needs_review'
    AND v_cash->>'reason'='seating_exception',
    'seating exception does not erase the recorded 6m cash receipt');
  PERFORM pg_temp.cashier_assert((SELECT count(*)=1 FROM public.cashier_buyin_movements
    WHERE registration_id=v_reg_id AND method='cash' AND amount=6000000)
    AND (SELECT cashier_paid_at IS NOT NULL AND cashier_seating_error='seating_exception'
      FROM public.tournament_registrations WHERE id=v_reg_id),
    'cash movement and paid marker survive a seating exception');
  v_repeat := public.cashier_record_cash_buyin_v1(v_reg_id,6000000,
    '96000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.cashier_assert(v_repeat->>'already_recorded'='true',
    'retry after seating exception cannot collect the same cash twice');
  EXECUTE 'DROP TRIGGER cashier_test_seating_error ON public.tournament_registrations';
  UPDATE public.sepay_system_settings SET auto_confirm_enabled=false WHERE id=true;
  v_retry:=public.cashier_retry_paid_seating_v1(false,100);
  PERFORM pg_temp.cashier_assert((v_retry->>'attempted')::integer=1
    AND (v_retry->>'seated')::integer=0,
    'cash-only paid entry retries even when SePay auto-confirm is disabled');
  UPDATE public.sepay_system_settings SET auto_confirm_enabled=true WHERE id=true;
  INSERT INTO public.tournament_entries
    (tournament_id,registration_id,player_id,entry_no,status,current_stack,busted_at)
  VALUES ('93000000-0000-4000-8000-000000000001',v_reg_id,
    '91000000-0000-4000-8000-000000000003',1,'busted',0,now())
  RETURNING id INTO v_busted_entry_id;
  v_refund := public.cashier_request_refund_v1(v_reg_id,'TEST free rake full refund');
  PERFORM pg_temp.cashier_assert((v_refund->>'amount')::bigint=6000000,
    'free-rake refund is exactly 6m');
  v_refund_id := (v_refund->>'refund_id')::uuid;
  PERFORM pg_temp.cashier_assert(
    public.cashier_floor_clear_refund_v1(v_refund_id)->>'ok'='true',
    'Floor clears free-rake entry');
  v_refund := public.cashier_complete_refund_v1(v_refund_id,6000000,0,
    '', 'TEST cash payout evidence for free rake');
  PERFORM pg_temp.cashier_assert(v_refund->>'ok'='true',
    'free-rake refund paid exactly once');
  PERFORM pg_temp.cashier_assert(
    (SELECT status='busted' AND busted_at IS NOT NULL FROM public.tournament_entries
      WHERE id=v_busted_entry_id),
    'refund preserves a played bust result');

  -- Floor opens capacity after the bank-only player already paid. The next
  -- worker tick must seat once and issue exactly one receipt and notice.
  INSERT INTO public.game_tables
    (id,club_id,table_name,table_type,status,table_number)
  VALUES ('97000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000002','Cashier TEST Table B','tournament','active',1);
  INSERT INTO public.tournament_tables
    (id,tournament_id,table_name,table_id,table_number,max_seats,status)
  VALUES ('98000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000002','Cashier TEST Table B',
    '97000000-0000-4000-8000-000000000001',1,9,'active');
  EXECUTE 'CREATE TRIGGER cashier_test_retry_seating_error BEFORE UPDATE ON public.tournament_registrations
    FOR EACH ROW EXECUTE FUNCTION pg_temp.cashier_force_seating_error()';
  v_retry:=public.cashier_retry_paid_seating_v1(true,100);
  PERFORM pg_temp.cashier_assert((v_retry->>'attempted')::integer=1
    AND (v_retry->>'needs_review')::integer=1
    AND (SELECT status='pending' FROM public.tournament_registrations
      WHERE id=(v_other_club->>'registration_id')::uuid),
    'seating retry exception leaves paid entry pending for another tick');
  EXECUTE 'DROP TRIGGER cashier_test_retry_seating_error ON public.tournament_registrations';
  v_retry:=public.cashier_retry_paid_seating_v1(true,100);
  PERFORM pg_temp.cashier_assert((v_retry->>'attempted')::integer=1
    AND (v_retry->>'seated')::integer=1,
    'bank-only paid entry seats when Floor opens capacity');
  SELECT count(*) INTO v_count FROM public.seat_draw_receipts
    WHERE registration_id=(v_other_club->>'registration_id')::uuid;
  PERFORM pg_temp.cashier_assert(v_count=1,'exactly one receipt after seating');
  SELECT count(*) INTO v_count FROM public.notifications
    WHERE user_id='91000000-0000-4000-8000-000000000004'
      AND data->>'registration_id'=v_other_club->>'registration_id';
  PERFORM pg_temp.cashier_assert(v_count=1,'exactly one player notification after seating');
  v_retry:=public.cashier_retry_paid_seating_v1(true,100);
  PERFORM pg_temp.cashier_assert((v_retry->>'attempted')::integer=0,
    'seat retry does not repeat an already-confirmed entry');

  -- The new ledger must explicitly return legacy re-entry to the existing
  -- SePay auto-confirm path instead of turning it off for the whole club.
  INSERT INTO public.bank_transactions
    (id,provider,provider_txn_id,account_number,amount,transfer_type,content,
     status,api_verified_at,raw_payload)
  VALUES ('95000000-0000-4000-8000-000000000004','sepay','cashier-test-reentry',
    '999000002',6600000,'in','REENTRY-TEST1234','unmatched',now(),'{}'::jsonb);
  v_bank:=public.cashier_record_verified_bank_v1(
    '95000000-0000-4000-8000-000000000004',true);
  PERFORM pg_temp.cashier_assert(v_bank->>'handled'='false'
    AND v_bank->>'legacy_auto_confirm_allowed'='true',
    're-entry remains eligible for the existing auto-confirm path');

  v_cash := public.cashier_close_shift_v1(v_shift_id,1000000);
  PERFORM pg_temp.cashier_assert(v_cash->>'ok'='true'
    AND (v_cash->>'expected_cash')::bigint=1000000
    AND (v_cash->>'variance_cash')::bigint=0,
    'shared till closes from cash only, excluding bank receipts');
  v_cash := public.cashier_adjust_shift_v1(v_shift_id,'in',100000,
    'TEST correction after close','96000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.cashier_assert(v_cash->>'ok'='true',
    'post-close correction appends a movement');
  v_repeat := public.cashier_adjust_shift_v1(v_shift_id,'in',100000,
    'TEST correction after close','96000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.cashier_assert(v_repeat->>'already_recorded'='true',
    'post-close correction is idempotent');
  PERFORM pg_temp.cashier_assert((SELECT counted_cash=1000000 AND expected_cash=1000000
    AND variance_cash=0 FROM public.cashier_till_shifts WHERE id=v_shift_id),
    'post-close correction never rewrites sealed till count');
  v_report := public.cashier_cashflow_range_v1(
    '92000000-0000-4000-8000-000000000001',now()-interval '1 minute',now()+interval '1 minute');
  PERFORM pg_temp.cashier_assert((v_report->>'drawer_adjustments')::bigint=100000
    AND (v_report->>'closed_shift_variance')::bigint=0,
    'Finance reports append-only correction separately from sealed variance');

  -- A historical confirmed entry with no active receipt must leave the
  -- completed queue and appear in review without becoming payable again.
  UPDATE public.seat_draw_receipts SET status='cancelled'
    WHERE registration_id=(v_other_club->>'registration_id')::uuid;
  v_lookup := public.cashier_tour_worklist_v1(
    '92000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002','','needs_review',0,50);
  PERFORM pg_temp.cashier_assert((v_lookup#>>'{counts,needs_review}')::integer=1
    AND v_lookup->'rows'->0->>'status'='confirmed'
    AND v_lookup->'rows'->0->>'receipt_code' IS NULL,
    'confirmed entry without active receipt requires review, not new payment');
END $test$;

DO $test$
DECLARE v_rejected boolean:=false;
BEGIN
  BEGIN
    UPDATE public.tournament_registrations SET status='cancelled'
      WHERE tournament_id='93000000-0000-4000-8000-000000000002'
        AND player_id='91000000-0000-4000-8000-000000000004';
  EXCEPTION WHEN OTHERS THEN
    v_rejected:=SQLERRM='Paid registration requires Cashier refund';
  END;
  PERFORM pg_temp.cashier_assert(v_rejected,
    'confirmed paid registration cannot be cancelled without Cashier refund');
END $test$;

-- Exercise the existing browser UPDATE policy as the authenticated player,
-- rather than only setting JWT claims while retaining postgres privileges.
DO $test$
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000003');
END $test$;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE v_reg_id uuid; v_blocked boolean:=false;
BEGIN
  -- club_id is nullable in the legacy table. The insert guard must derive
  -- the club from the tour, not trust a client-supplied nullable club_id.
  BEGIN
    INSERT INTO public.tournament_registrations
      (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status)
    VALUES ('93000000-0000-4000-8000-000000000001',auth.uid(),NULL,1,1,
      'VINREGNOCB0001','pending');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Tour buy-in registration must be created by server' THEN RAISE; END IF;
    v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'cashier test failed: nullable club bypassed server pricing'; END IF;
  v_blocked:=false;
  SELECT id INTO v_reg_id FROM public.tournament_registrations
    WHERE tournament_id='93000000-0000-4000-8000-000000000002'
      AND player_id=auth.uid() AND status='pending';
  IF v_reg_id IS NULL THEN RAISE EXCEPTION 'cashier test failed: player registration missing'; END IF;
  BEGIN
    UPDATE public.tournament_registrations SET status='confirmed',confirmed_at=now()
      WHERE id=v_reg_id;
  EXCEPTION WHEN OTHERS THEN
    -- BEFORE UPDATE triggers run by name; the insufficient-payment guard can
    -- reject this before the browser-owned-column guard sees the same write.
    IF SQLERRM NOT IN ('Server-priced registration fields are server-owned',
      'Verified buy-in total is insufficient for confirmation') THEN RAISE; END IF;
    v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'cashier test failed: player self-confirmed without payment'; END IF;
  v_blocked:=false;
  BEGIN
    UPDATE public.tournament_registrations
      SET tournament_id='93000000-0000-4000-8000-000000000001',
        club_id='92000000-0000-4000-8000-000000000001'
      WHERE id=v_reg_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Server-priced registration fields are server-owned' THEN RAISE; END IF;
    v_blocked:=true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'cashier test failed: player moved priced entry to another club'; END IF;
  UPDATE public.tournament_registrations SET transfer_proof_submitted=true WHERE id=v_reg_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cashier test failed: player proof update blocked'; END IF;
  UPDATE public.tournament_registrations
    SET status='cancelled',cancelled_at=now(),cancellation_reason='player_cancelled'
    WHERE id=v_reg_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'cashier test failed: unpaid player cancellation blocked'; END IF;
END $test$;
RESET ROLE;

-- Historical registrations may have no club_id; their verified tournament
-- still determines tenant scope, while missing price details remain explicit.
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('91000000-0000-4000-8000-000000000005','authenticated','authenticated',
   'cashier-legacy-player@test.invalid',now(),now()),
  ('91000000-0000-4000-8000-000000000006','authenticated','authenticated',
   'cashier-scope-player@test.invalid',now(),now());
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,reference_code,status)
VALUES ('93000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000005',NULL,6000000,0,6600000,'VINREGLEGACY01','pending');
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE v_list jsonb; v_other jsonb;
BEGIN
  v_list:=public.cashier_tour_worklist_v1(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001','VINREGLEGACY01','counter',0,50);
  PERFORM pg_temp.cashier_assert(jsonb_array_length(v_list->'rows')=1
    AND (v_list->'rows'->0->>'legacy_detail_missing')::boolean,
    'legacy registration without club_id is visible but marked unverified');
  v_other:=public.cashier_tour_worklist_v1(
    '92000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002','VINREGLEGACY01','all',0,50);
  PERFORM pg_temp.cashier_assert(jsonb_array_length(v_other->'rows')=0,
    'legacy registration cannot leak into another club');
END $test$;

DO $test$
DECLARE v_created jsonb; v_list jsonb; v_cash jsonb; v_refund jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  v_created:=public.cashier_create_app_registration_v1(
    '93000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000006');
  PERFORM pg_temp.cashier_assert(v_created->>'ok'='true','scope test registration created');
  UPDATE public.tournament_registrations SET club_id='92000000-0000-4000-8000-000000000002'
    WHERE id=(v_created->>'registration_id')::uuid;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
  v_list:=public.cashier_tour_worklist_v1(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',v_created->>'reference_code','counter',0,50);
  PERFORM pg_temp.cashier_assert(jsonb_array_length(v_list->'rows')=1
    AND (v_list->'rows'->0->>'legacy_detail_missing')::boolean,
    'wrong-club registration is visible for review but not payable');
  v_cash:=public.cashier_record_cash_buyin_v1((v_created->>'registration_id')::uuid,
    (v_created->>'total_pay')::bigint,'96000000-0000-4000-8000-000000000098');
  PERFORM pg_temp.cashier_assert(v_cash->>'error'='registration_club_mismatch'
    AND NOT EXISTS(SELECT 1 FROM public.cashier_buyin_movements
      WHERE registration_id=(v_created->>'registration_id')::uuid),
    'wrong-club registration cannot create a cash movement');
  v_refund:=public.cashier_request_refund_v1((v_created->>'registration_id')::uuid,
    'TEST reject wrong club refund');
  PERFORM pg_temp.cashier_assert(v_refund->>'error'='registration_club_mismatch',
    'wrong-club registration cannot start a refund');
END $test$;

-- More than two client-page sizes must still be counted and paged by SQL for
-- the selected tour; Tour B cannot inherit Tour A's large arrival queue.
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at)
SELECT ('a1000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'authenticated','authenticated','cashier-page-'||g||'@test.invalid',now(),now()
FROM generate_series(1,220) g;
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status)
SELECT '93000000-0000-4000-8000-000000000001',
  ('a1000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  '92000000-0000-4000-8000-000000000001',6000000,6600000,
  'VINREGPAGE'||lpad(g::text,4,'0'),'pending'
FROM generate_series(1,220) g;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE v_first jsonb; v_last jsonb; v_other jsonb;
BEGIN
  v_first:=public.cashier_tour_worklist_v1(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001','VINREGPAGE','counter',0,100);
  v_last:=public.cashier_tour_worklist_v1(
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001','VINREGPAGE','counter',2,100);
  v_other:=public.cashier_tour_worklist_v1(
    '92000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002','VINREGPAGE','all',0,100);
  PERFORM pg_temp.cashier_assert((v_first#>>'{counts,total}')::integer=220
    AND jsonb_array_length(v_first->'rows')=100
    AND jsonb_array_length(v_last->'rows')=20
    AND (v_other#>>'{counts,total}')::integer=0,
    'tour-scoped SQL search counts and pages more than 200 arrivals');
END $test$;

ROLLBACK;
