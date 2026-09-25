-- Persistent data only in disposable PG17 CI. Real Ops and Cashier RPCs loaded.
\set ON_ERROR_STOP on
-- The synthetic Cashier baseline used a constant-false registration-closed
-- stub. Model the real cutoff field for these writer races.
CREATE OR REPLACE FUNCTION public.is_tournament_registration_closed(p_tour uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT t.registration_closed_at IS NOT NULL
                   FROM public.tournaments t WHERE t.id=p_tour),true)
$$;
INSERT INTO auth.users(id) VALUES
 ('ca000000-0000-4000-8000-000000000001'),
 ('ca000000-0000-4000-8000-000000000002'),
 ('ca000000-0000-4000-8000-000000000003'),
 ('ca000000-0000-4000-8000-000000000004'),
 ('ca000000-0000-4000-8000-000000000005');
INSERT INTO public.clubs(id,owner_id)
VALUES ('cb000000-0000-4000-8000-000000000001',
        'ca000000-0000-4000-8000-000000000001');
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,
  rake_amount,service_fee_amount,operations_mode)
VALUES
 ('cc000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000001',
  'Canonical cutoff race','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('cc000000-0000-4000-8000-000000000002','cb000000-0000-4000-8000-000000000001',
  'Cash cutoff race','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('cc000000-0000-4000-8000-000000000003','cb000000-0000-4000-8000-000000000001',
  'Bank cutoff race','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('cc000000-0000-4000-8000-000000000004','cb000000-0000-4000-8000-000000000001',
  'Cash wins cutoff','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('cc000000-0000-4000-8000-000000000005','cb000000-0000-4000-8000-000000000001',
  'Bank wins cutoff','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite');
INSERT INTO public.game_tables(id,club_id,table_name,status)
VALUES ('cd000000-0000-4000-8000-000000000001',
        'cb000000-0000-4000-8000-000000000001','Race game table','active');
INSERT INTO public.tournament_tables(id,tournament_id,table_id,table_number,max_seats,status)
VALUES ('ce000000-0000-4000-8000-000000000001',
        'cc000000-0000-4000-8000-000000000001',
        'cd000000-0000-4000-8000-000000000001',1,9,'active'),
       ('ce000000-0000-4000-8000-000000000004',
        'cc000000-0000-4000-8000-000000000004',
        'cd000000-0000-4000-8000-000000000001',4,9,'active'),
       ('ce000000-0000-4000-8000-000000000005',
        'cc000000-0000-4000-8000-000000000005',
        'cd000000-0000-4000-8000-000000000001',5,9,'active');
INSERT INTO public.cashier_tour_settings(club_id,enabled)
VALUES ('cb000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$ DECLARE v jsonb; BEGIN
  v:=public.cashier_create_app_registration_v1(
    'cc000000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000002');
  IF v->>'ok'<>'true' THEN RAISE EXCEPTION 'cash race registration: %',v; END IF;
  v:=public.cashier_create_app_registration_v1(
    'cc000000-0000-4000-8000-000000000003',
    'ca000000-0000-4000-8000-000000000003');
  IF v->>'ok'<>'true' THEN RAISE EXCEPTION 'bank race registration: %',v; END IF;
  v:=public.cashier_create_app_registration_v1(
    'cc000000-0000-4000-8000-000000000004',
    'ca000000-0000-4000-8000-000000000004');
  IF v->>'ok'<>'true' THEN RAISE EXCEPTION 'cash-first registration: %',v; END IF;
  v:=public.cashier_create_app_registration_v1(
    'cc000000-0000-4000-8000-000000000005',
    'ca000000-0000-4000-8000-000000000005');
  IF v->>'ok'<>'true' THEN RAISE EXCEPTION 'bank-first registration: %',v; END IF;
END $$;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',false);
DO $$ DECLARE v jsonb; BEGIN
  v:=public.cashier_open_shift_v1('cb000000-0000-4000-8000-000000000001',0);
  IF v->>'ok'<>'true' THEN RAISE EXCEPTION 'race shift: %',v; END IF;
END $$;
INSERT INTO public.platform_bank_accounts
 (id,club_id,bank_name,account_number,account_holder,is_active)
VALUES ('cf000000-0000-4000-8000-000000000001',
        'cb000000-0000-4000-8000-000000000001',
        'TEST BANK','999200002','TEST',true);
INSERT INTO public.sepay_system_settings(id,system_actor_id,auto_confirm_enabled)
VALUES (true,'ca000000-0000-4000-8000-000000000001',true)
ON CONFLICT(id) DO UPDATE SET system_actor_id=EXCLUDED.system_actor_id,
  auto_confirm_enabled=EXCLUDED.auto_confirm_enabled;
INSERT INTO public.bank_transactions
 (id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,
  api_verified_at,raw_payload)
SELECT 'cf000000-0000-4000-8000-000000000002','sepay','sat-cutoff-bank-race',
  '999200002',1200000,'in',r.reference_code,'unmatched',now(),'{}'::jsonb
FROM public.tournament_registrations r
WHERE r.tournament_id='cc000000-0000-4000-8000-000000000003';
INSERT INTO public.bank_transactions
 (id,provider,provider_txn_id,account_number,amount,transfer_type,content,status,
  api_verified_at,raw_payload)
SELECT 'cf000000-0000-4000-8000-000000000005','sepay','sat-bank-first-race',
  '999200002',1200000,'in',r.reference_code,'unmatched',now(),'{}'::jsonb
FROM public.tournament_registrations r
WHERE r.tournament_id='cc000000-0000-4000-8000-000000000005';
