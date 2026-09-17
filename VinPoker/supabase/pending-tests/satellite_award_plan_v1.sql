-- Disposable database only, after applying the pending Satellite plan migration.
-- Never run on the linked production project. Fixtures and calls roll back.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','satellite-owner-a@test.invalid',now(),now()),
  ('a1000000-0000-4000-8000-000000000002','authenticated','authenticated','satellite-owner-b@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Satellite TEST A','HCM','approved'),
  ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','Satellite TEST B','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
VALUES
  ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Satellite source','scheduled',now()+interval '1 day',1000000,100000,0,'satellite'),
  ('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','Main 1C','scheduled',now()+interval '2 days',6000000,500000,100000,'standard'),
  ('a3000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000002','Wrong club','scheduled',now()+interval '2 days',6000000,500000,100000,'standard');

SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE
  v_awards jsonb := '[{"position":1,"ticketCount":2,"cashVnd":"500000"}]'::jsonb;
  v_preview jsonb;
  v_locked jsonb;
BEGIN
  v_preview := public.satellite_award_plan_v1(
    'a3000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',v_awards,false);
  IF v_preview->>'locked' <> 'false' OR v_preview->>'ticketTotal' <> '2'
     OR v_preview->>'targetEntryPriceVnd' <> '6600000'
     OR v_preview->>'cashTotalVnd' <> '500000'
     OR v_preview->>'totalLiabilityVnd' <> '13700000' THEN
    RAISE EXCEPTION 'satellite preview total/fee mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.satellite_award_plans
             WHERE source_tournament_id='a3000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'satellite preview wrote a plan';
  END IF;
  v_locked := public.satellite_award_plan_v1(
    'a3000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',v_awards,true);
  IF v_locked->>'locked' <> 'true' OR
     (SELECT count(*) FROM public.satellite_award_plans
      WHERE source_tournament_id='a3000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'satellite lock failed';
  END IF;
  PERFORM public.satellite_award_plan_v1(
    'a3000000-0000-4000-8000-000000000001',
    'a3000000-0000-4000-8000-000000000002',v_awards,true);
  IF (SELECT count(*) FROM public.satellite_award_plans
      WHERE source_tournament_id='a3000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'satellite retry duplicated plan';
  END IF;
END $test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.satellite_award_plan_v1(
      'a3000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000003',
      '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',true);
    RAISE EXCEPTION 'wrong-club target accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    UPDATE public.tournaments SET rake_amount=700000
      WHERE id='a3000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'locked target price changed';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_award_plan_v1(
      'a3000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000002',
      '[{"position":1,"ticketCount":1,"cashVnd":"0"},{"position":1,"ticketCount":1,"cashVnd":"0"}]',false);
    RAISE EXCEPTION 'duplicate rank accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $test$;

DO $test$
BEGIN
  IF pg_catalog.has_table_privilege('authenticated',
       'public.satellite_award_plans','SELECT') THEN
    RAISE EXCEPTION 'authenticated has direct award-plan table read';
  END IF;
END $test$;

SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.satellite_get_award_plan_v1('a3000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'other club read a Satellite plan';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $test$;

ROLLBACK;
