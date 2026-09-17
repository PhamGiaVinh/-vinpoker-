-- Disposable local DB only, after pending Satellite migrations 01-03. NEVER live.
-- Source-only until executed on a disposable Postgres with current baseline.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('c1000000-0000-4000-8000-000000000001','authenticated','authenticated','funding-owner@test.invalid',now(),now()),
  ('c1000000-0000-4000-8000-000000000002','authenticated','authenticated','funding-outsider@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Funding TEST A','HCM','approved'),
  ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','Funding TEST B','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
VALUES
  ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Satellite closed','completed',now(),1000000,100000,0,'satellite'),
  ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','Main 1C','scheduled',now()+interval '1 day',6000000,500000,100000,'standard');
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,confirmed_at)
VALUES
  ('c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',1000000,1100000,'FUND-TEST-WINNER-1','confirmed',now()),
  ('c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001',1000000,1100000,'FUND-TEST-WINNER-2','confirmed',now());
INSERT INTO public.tournament_entries(tournament_id,player_id,entry_no,status) VALUES
  ('c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001',1,'busted'),
  ('c3000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000002',1,'busted');
INSERT INTO public.tournament_close_report
  (tournament_id,club_id,closed_by,entry_count,buy_in_total,cash_in_total,club_revenue,prize_total)
VALUES
  ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001',2,2000000,2200000,200000,500000);
INSERT INTO public.satellite_award_plans
  (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
   award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
VALUES
  ('c3000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000002',
   'c2000000-0000-4000-8000-000000000001',6600000,
   '[{"position":1,"ticketCount":2,"cashVnd":"500000"},{"position":2,"ticketCount":1,"cashVnd":"0"}]',
   3,500000,20300000,'c1000000-0000-4000-8000-000000000001');

SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE
  v_results jsonb := '[{"position":1,"playerId":"c4000000-0000-4000-8000-000000000001"},
                       {"position":2,"playerId":"c4000000-0000-4000-8000-000000000002"}]';
  v_preview jsonb;
  v_locked jsonb;
BEGIN
  BEGIN
    PERFORM public.satellite_issue_tickets_v1('c3000000-0000-4000-8000-000000000001',v_results);
    RAISE EXCEPTION 'unfunded issue accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_approve_funding_v1('c3000000-0000-4000-8000-000000000001',0,false);
    RAISE EXCEPTION 'missing overlay accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_preview := public.satellite_approve_funding_v1('c3000000-0000-4000-8000-000000000001',NULL,false);
  IF v_preview->>'locked' <> 'false' OR v_preview->>'sourcePoolVnd' <> '2000000'
     OR v_preview->>'sourceConfirmedGrossVnd' <> '2200000'
     OR v_preview->>'sourceEntryFeesVnd' <> '200000'
     OR v_preview->>'ticketLiabilityVnd' <> '19800000'
     OR v_preview->>'cashLiabilityVnd' <> '500000'
     OR v_preview->>'overlayVnd' <> '18300000'
     OR v_preview->>'remainingVnd' <> '0'
     OR EXISTS(SELECT 1 FROM public.satellite_award_funding
               WHERE source_tournament_id='c3000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'funding preview was wrong or wrote data';
  END IF;
  v_locked := public.satellite_approve_funding_v1('c3000000-0000-4000-8000-000000000001',18300000,true);
  IF v_locked->>'locked' <> 'true' OR
     (SELECT source_pool_vnd+overlay_vnd-ticket_liability_vnd-cash_liability_vnd-remaining_vnd
      FROM public.satellite_award_funding
      WHERE source_tournament_id='c3000000-0000-4000-8000-000000000001') <> 0 THEN
    RAISE EXCEPTION 'funding conservation failed';
  END IF;
  PERFORM public.satellite_approve_funding_v1('c3000000-0000-4000-8000-000000000001',18300000,true);
  PERFORM public.satellite_issue_tickets_v1('c3000000-0000-4000-8000-000000000001',v_results);
  IF (SELECT count(*) FROM public.satellite_tickets
      WHERE source_tournament_id='c3000000-0000-4000-8000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'funded issue did not create exactly three tickets';
  END IF;
END $test$;

-- Owner's exact example: 33 x (1m buy-in + 200k Satellite fee) collects
-- 39.6m. The 33m prize pool funds five 6.6m Main tickets, including fees.
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
VALUES
  ('c3000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001',
   'Satellite 33 entries','completed',now(),1000000,200000,0,'satellite'),
  ('c3000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001',
   'Main example','scheduled',now()+interval '1 day',6000000,600000,0,'standard');
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
   reference_code,status,confirmed_at)
SELECT 'c3000000-0000-4000-8000-000000000003',gen_random_uuid(),
  'c2000000-0000-4000-8000-000000000001',1000000,200000,1200000,
  'SAT33-'||gs::text,'confirmed',now()
FROM generate_series(1,33) gs;
INSERT INTO public.tournament_close_report
  (tournament_id,club_id,closed_by,entry_count,buy_in_total,cash_in_total,
   club_revenue,prize_total)
VALUES ('c3000000-0000-4000-8000-000000000003',
  'c2000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',33,33000000,39600000,6600000,0);
INSERT INTO public.satellite_award_plans
  (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
   award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
VALUES ('c3000000-0000-4000-8000-000000000003',
  'c3000000-0000-4000-8000-000000000004',
  'c2000000-0000-4000-8000-000000000001',6600000,
  '[{"position":1,"ticketCount":5,"cashVnd":"0"}]',5,0,33000000,
  'c1000000-0000-4000-8000-000000000001');
DO $test$
DECLARE v_check jsonb;
BEGIN
  v_check := public.satellite_approve_funding_v1(
    'c3000000-0000-4000-8000-000000000003',0,true);
  IF v_check->>'locked'<>'true' OR
     v_check->>'sourceConfirmedGrossVnd'<>'39600000' OR
     v_check->>'sourceEntryFeesVnd'<>'6600000' OR
     v_check->>'sourcePoolVnd'<>'33000000' OR
     v_check->>'ticketLiabilityVnd'<>'33000000' OR
     v_check->>'overlayVnd'<>'0' OR
     v_check->>'remainingVnd'<>'0' THEN
    RAISE EXCEPTION '33 entries must fund exactly five 6.6m tickets';
  END IF;
END $test$;

DO $test$
BEGIN
  IF pg_catalog.has_table_privilege('authenticated','public.satellite_award_funding','SELECT') THEN
    RAISE EXCEPTION 'browser can read funding ledger directly';
  END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.satellite_get_funding_v1('c3000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'other club read funding';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_approve_funding_v1('c3000000-0000-4000-8000-000000000001',18300000,true);
    RAISE EXCEPTION 'other club approved overlay';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $test$;
ROLLBACK;
