-- Disposable local DB only after Satellite migrations 01-06. NEVER production.
-- Source-only specification until executed on a disposable Postgres.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('f1000000-0000-4000-8000-000000000001','authenticated','authenticated','gtd-owner@test.invalid',now(),now()),
  ('f1000000-0000-4000-8000-000000000002','authenticated','authenticated','gtd-outsider@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','GTD TEST','HCM','approved'),
  ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000002','Other TEST','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
VALUES
  ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
   'Satellite 1m + 200k','scheduled',now()+interval '1 day',1000000,200000,0,'satellite'),
  ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001',
   'Main 6m + 600k','scheduled',now()+interval '2 days',6000000,600000,0,'standard');
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
   reference_code,status,confirmed_at)
SELECT 'f3000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'f2000000-0000-4000-8000-000000000001',1000000,200000,1200000,
  'GTD-ENTRY-'||gs::text,'confirmed',now()
FROM generate_series(1,33) gs;

SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE v_quote jsonb;
BEGIN
  v_quote := public.satellite_gtd_quote_v1(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',4);
  IF v_quote->>'entryCount'<>'33' OR
     v_quote->>'collectionVerified'<>'false' OR
     v_quote->>'fundingBasis'<>'confirmed_registrations_not_verified_cash' OR
     v_quote->>'sourceRegistrationGrossVnd'<>'39600000' OR
     v_quote->>'sourceEntryFeesVnd'<>'6600000' OR
     v_quote->>'sourcePoolVnd'<>'33000000' OR
     v_quote->>'targetEntryPriceVnd'<>'6600000' OR
     v_quote->>'ticketCount'<>'5' OR
     v_quote->>'ticketLiabilityVnd'<>'33000000' OR
     v_quote->>'cashPrizeVnd'<>'0' OR
     v_quote->>'overlayRequiredVnd'<>'0' OR
     jsonb_array_length(v_quote->'awardLines')<>5 OR
     EXISTS (SELECT 1 FROM jsonb_array_elements(v_quote->'awardLines') line
             WHERE line->>'ticketCount'<>'1' OR line->>'cashVnd'<>'0') THEN
    RAISE EXCEPTION '33 entries should yield five separate tickets';
  END IF;
END $test$;

INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
   reference_code,status,confirmed_at)
VALUES ('f3000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'f2000000-0000-4000-8000-000000000001',1000000,200000,1200000,
  'GTD-ENTRY-34','confirmed',now());
DO $test$
DECLARE v_quote jsonb;
BEGIN
  v_quote := public.satellite_gtd_quote_v1(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',4);
  IF v_quote->>'entryCount'<>'34' OR
     v_quote->>'sourceRegistrationGrossVnd'<>'40800000' OR
     v_quote->>'sourceEntryFeesVnd'<>'6800000' OR
     v_quote->>'sourcePoolVnd'<>'34000000' OR
     v_quote->>'ticketCount'<>'5' OR
     v_quote->>'cashPrizeVnd'<>'1000000' OR
     v_quote->>'overlayRequiredVnd'<>'0' OR
     jsonb_array_length(v_quote->'awardLines')<>6 OR
     v_quote->'awardLines'->5->>'position'<>'6' OR
     v_quote->'awardLines'->5->>'ticketCount'<>'0' OR
     v_quote->'awardLines'->5->>'cashVnd'<>'1000000' THEN
    RAISE EXCEPTION '34 entries/GTD4 should yield five tickets and rank-six cash';
  END IF;
  v_quote := public.satellite_gtd_quote_v1(
    'f3000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000002',6);
  IF v_quote->>'ticketCount'<>'6' OR
     v_quote->>'ticketLiabilityVnd'<>'39600000' OR
     v_quote->>'cashPrizeVnd'<>'0' OR
     v_quote->>'overlayRequiredVnd'<>'5600000' OR
     jsonb_array_length(v_quote->'awardLines')<>6 OR
     (v_quote->>'sourcePoolVnd')::bigint +
       (v_quote->>'overlayRequiredVnd')::bigint <>
       (v_quote->>'ticketLiabilityVnd')::bigint +
       (v_quote->>'cashPrizeVnd')::bigint THEN
    RAISE EXCEPTION '34 entries/GTD6 should record 5.6m club overlay';
  END IF;
  IF EXISTS(SELECT 1 FROM public.satellite_award_plans
            WHERE source_tournament_id='f3000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'GTD preview wrote an award plan';
  END IF;
END $test$;

SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.satellite_gtd_quote_v1(
      'f3000000-0000-4000-8000-000000000001',
      'f3000000-0000-4000-8000-000000000002',4);
    RAISE EXCEPTION 'other-club actor read GTD quote';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $test$;
ROLLBACK;
