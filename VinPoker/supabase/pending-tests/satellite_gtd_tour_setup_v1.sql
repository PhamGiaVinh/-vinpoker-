-- Disposable local DB only after Satellite migrations 01-07. NEVER production.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('fa000000-0000-4000-8000-000000000001','authenticated','authenticated','setup-owner@test.invalid',now(),now()),
  ('fa000000-0000-4000-8000-000000000002','authenticated','authenticated','other-owner@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('fb000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','Satellite Setup TEST','HCM','approved'),
  ('fb000000-0000-4000-8000-000000000002','fa000000-0000-4000-8000-000000000002','Other Setup TEST','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
VALUES
  ('fc000000-0000-4000-8000-000000000001','fb000000-0000-4000-8000-000000000001',
   'Main 6m + 600k','scheduled',now()+interval '2 days',6000000,600000,0,'standard'),
  ('fc000000-0000-4000-8000-000000000002','fb000000-0000-4000-8000-000000000002',
   'Wrong club Main','scheduled',now()+interval '2 days',6000000,600000,0,'standard');

SELECT set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);
DO $test$
BEGIN
  BEGIN
    INSERT INTO public.tournaments
      (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
    VALUES ('fc000000-0000-4000-8000-000000000003',
      'fb000000-0000-4000-8000-000000000001','Missing GTD','scheduled',
      now()+interval '1 day',1000000,200000,0,'satellite');
    RAISE EXCEPTION 'Satellite without target/GTD was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tournaments
      (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,
       operations_mode,satellite_target_tournament_id,satellite_gtd_tickets)
    VALUES ('fc000000-0000-4000-8000-000000000004',
      'fb000000-0000-4000-8000-000000000001','Wrong target','scheduled',
      now()+interval '1 day',1000000,200000,0,'satellite',
      'fc000000-0000-4000-8000-000000000002',4);
    RAISE EXCEPTION 'Cross-club target was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $test$;

INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,
   operations_mode,satellite_target_tournament_id,satellite_gtd_tickets)
VALUES ('fc000000-0000-4000-8000-000000000005',
  'fb000000-0000-4000-8000-000000000001','GTD 4 Satellite','scheduled',
  now()+interval '1 day',1000000,200000,0,'satellite',
  'fc000000-0000-4000-8000-000000000001',4);

INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
   reference_code,status,confirmed_at)
VALUES ('fc000000-0000-4000-8000-000000000005',gen_random_uuid(),
  'fb000000-0000-4000-8000-000000000001',1000000,200000,1200000,
  'SETUP-ENTRY-1','confirmed',now());
DO $test$
BEGIN
  BEGIN
    UPDATE public.tournaments SET club_id='fb000000-0000-4000-8000-000000000002'
      WHERE id='fc000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'Satellite moved to a different club';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    UPDATE public.tournaments SET satellite_gtd_tickets=6
      WHERE id='fc000000-0000-4000-8000-000000000005';
    RAISE EXCEPTION 'GTD changed after first registration';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF (SELECT satellite_gtd_tickets FROM public.tournaments
      WHERE id='fc000000-0000-4000-8000-000000000005') <> 4 THEN
    RAISE EXCEPTION 'Frozen GTD changed';
  END IF;
END $test$;
ROLLBACK;
