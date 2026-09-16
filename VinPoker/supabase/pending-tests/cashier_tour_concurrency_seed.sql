-- Synthetic data in the disposable CI database only. Never run on Supabase.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id,aud,role,email) VALUES
  ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated','cashier-race-owner@test.invalid'),
  ('b1000000-0000-4000-8000-000000000002','authenticated','authenticated','cashier-race-cash@test.invalid'),
  ('b1000000-0000-4000-8000-000000000003','authenticated','authenticated','cashier-race-bank@test.invalid');
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('b2000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001','Cashier concurrency TEST','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,start_time,buy_in,rake_amount,service_fee_amount,status,live_status)
VALUES
  ('b3000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000001','Cashier race TEST',
   now()+interval '1 day',6000000,600000,0,'registering','registering');
INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES
  ('b2000000-0000-4000-8000-000000000001',true);
INSERT INTO public.platform_bank_accounts
  (id,club_id,bank_name,account_number,account_holder,is_active)
VALUES
  ('b4000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000001','TEST BANK','999100001','TEST',true);
INSERT INTO public.sepay_system_settings(id,system_actor_id,auto_confirm_enabled)
VALUES(true,'b1000000-0000-4000-8000-000000000001',true)
ON CONFLICT(id) DO UPDATE SET system_actor_id=EXCLUDED.system_actor_id,
  auto_confirm_enabled=EXCLUDED.auto_confirm_enabled;

SELECT set_config('request.jwt.claim.role','service_role',false);
DO $test$
DECLARE v_cash jsonb; v_bank jsonb;
BEGIN
  v_cash:=public.cashier_create_app_registration_v1(
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002');
  v_bank:=public.cashier_create_app_registration_v1(
    'b3000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000003');
  IF v_cash->>'ok'<>'true' OR v_bank->>'ok'<>'true'
    OR (v_cash->>'total_pay')::bigint<>6600000
    OR (v_bank->>'total_pay')::bigint<>6600000 THEN
    RAISE EXCEPTION 'cashier concurrency seed registration failed';
  END IF;
END $test$;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',false);
DO $test$
DECLARE v_shift jsonb;
BEGIN
  v_shift:=public.cashier_open_shift_v1('b2000000-0000-4000-8000-000000000001',0);
  IF v_shift->>'ok'<>'true' THEN RAISE EXCEPTION 'cashier concurrency seed shift failed: %',v_shift; END IF;
END $test$;
INSERT INTO public.bank_transactions
  (id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,
   api_verified_at,raw_payload)
SELECT 'b5000000-0000-4000-8000-000000000001','sepay','cashier-race-bank-1',
  '999100001',6600000,'in',r.reference_code,'unmatched',now(),'{}'::jsonb
FROM public.tournament_registrations r
WHERE r.player_id='b1000000-0000-4000-8000-000000000003';
