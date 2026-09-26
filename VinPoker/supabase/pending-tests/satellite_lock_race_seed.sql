-- Disposable PG17 data for two-session Lock and refund-fence races.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES ('ba000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id)
VALUES ('bb000000-0000-4000-8000-000000000001',
        'ba000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','ba000000-0000-4000-8000-000000000001',false);
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,
  rake_amount,service_fee_amount,operations_mode)
VALUES
 ('bc000000-0000-4000-8000-000000000001','bb000000-0000-4000-8000-000000000001',
  'Lock double click','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('bc000000-0000-4000-8000-000000000002','bb000000-0000-4000-8000-000000000001',
  'Lock versus refund','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('bc000000-0000-4000-8000-000000000003','bb000000-0000-4000-8000-000000000001',
  'Lock race target','live','registering',now()+interval '3 day',900000,10000,100000,0,'standard');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES ('bd000000-0000-4000-8000-000000000001',
        'bb000000-0000-4000-8000-000000000001',0,
        'ba000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
SELECT ('be000000-0000-4000-8000-00000000000'||g)::uuid,
       ('bc000000-0000-4000-8000-00000000000'||g)::uuid,
       ('ba000000-0000-4000-8000-00000000010'||g)::uuid,
       'bb000000-0000-4000-8000-000000000001',1000000,1200000,
       'SAT-LOCK-RACE-'||g,'pending',
       '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}'::jsonb
FROM generate_series(1,2) g;
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
SELECT r.club_id,r.tournament_id,r.id,
       'bd000000-0000-4000-8000-000000000001',
       'in','cash','buyin',1200000,1200000,
       'ba000000-0000-4000-8000-000000000001','sat-lock-race:'||r.id
FROM public.tournament_registrations r WHERE r.reference_code LIKE 'SAT-LOCK-RACE-%';
UPDATE public.tournament_registrations
SET cashier_paid_at=now(),status='confirmed',confirmed_at=now(),
    confirmed_by='ba000000-0000-4000-8000-000000000001'
WHERE reference_code LIKE 'SAT-LOCK-RACE-%';
INSERT INTO public.tournament_entries
 (id,tournament_id,registration_id,player_id,entry_no,source,status)
SELECT ('bf000000-0000-4000-8000-00000000000'||g)::uuid,
       r.tournament_id,r.id,r.player_id,1,'online','registered'
FROM generate_series(1,2) g JOIN public.tournament_registrations r
  ON r.id=('be000000-0000-4000-8000-00000000000'||g)::uuid;
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id IN ('bc000000-0000-4000-8000-000000000001',
             'bc000000-0000-4000-8000-000000000002');
UPDATE public.centerpoint_tournament_ops_release
SET enabled=true,allowed_club_ids=ARRAY['bb000000-0000-4000-8000-000000000001']::uuid[]
WHERE id=true;
CREATE TABLE public.satellite_lock_race_expected(
  source_tournament_id uuid PRIMARY KEY,preview_revision text NOT NULL);
INSERT INTO public.satellite_lock_race_expected
SELECT t.id,public.satellite_source_funding_preview_v2(
  t.id,'bc000000-0000-4000-8000-000000000003',
  '[{"position":1,"ticketCount":1,"cashVnd":"0"}]')->>'previewRevision'
FROM public.tournaments t WHERE t.id IN (
  'bc000000-0000-4000-8000-000000000001',
  'bc000000-0000-4000-8000-000000000002');
