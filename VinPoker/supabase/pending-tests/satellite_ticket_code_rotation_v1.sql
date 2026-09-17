-- Disposable local DB only after Satellite migrations 01-05. NEVER live.
-- Source-only until executed with the current Cashier/Satellite baseline.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('e1000000-0000-4000-8000-000000000001','authenticated','authenticated','rotation-owner@test.invalid',now(),now()),
  ('e1000000-0000-4000-8000-000000000002','authenticated','authenticated','rotation-outsider@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('e2000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001','Rotation TEST','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
VALUES
  ('e3000000-0000-4000-8000-000000000001',
   'e2000000-0000-4000-8000-000000000001','Satellite','completed',now(),1000000,0,0,'satellite'),
  ('e3000000-0000-4000-8000-000000000002',
   'e2000000-0000-4000-8000-000000000001','Main 1C','scheduled',now()+interval '1 day',6000000,500000,100000,'standard');
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,confirmed_at)
VALUES ('e3000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',1000000,1000000,'ROTATION-WINNER','confirmed',now());
INSERT INTO public.tournament_entries(tournament_id,player_id,entry_no,status)
VALUES ('e3000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',1,'busted');
INSERT INTO public.tournament_close_report
  (tournament_id,club_id,closed_by,entry_count,buy_in_total,cash_in_total,prize_total)
VALUES ('e3000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',1,1000000,1000000,0);
INSERT INTO public.satellite_award_plans
  (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
   award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
VALUES ('e3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  'e2000000-0000-4000-8000-000000000001',6600000,
  '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',1,0,6600000,
  'e1000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $test$
DECLARE
  v_old uuid;
  v_new uuid;
  v_response jsonb;
  v_attempt uuid := 'e5000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM public.satellite_approve_funding_v1(
    'e3000000-0000-4000-8000-000000000001',5600000,true);
  PERFORM public.satellite_issue_tickets_v1(
    'e3000000-0000-4000-8000-000000000001',
    '[{"position":1,"playerId":"e4000000-0000-4000-8000-000000000001"}]');
  SELECT redemption_code INTO v_old FROM public.satellite_tickets
    WHERE source_tournament_id='e3000000-0000-4000-8000-000000000001';
  PERFORM set_config('request.jwt.claim.sub',
    'e1000000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.satellite_rotate_ticket_code_v1(
      'e3000000-0000-4000-8000-000000000001',1,v_old,
      'Ticket lost by bearer',v_attempt);
    RAISE EXCEPTION 'non-owner rotated a code';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',
    'e1000000-0000-4000-8000-000000000001',true);
  v_response := public.satellite_rotate_ticket_code_v1(
    'e3000000-0000-4000-8000-000000000001',1,v_old,
    'Ticket lost by bearer',v_attempt);
  v_new := (v_response->>'code')::uuid;
  IF v_new=v_old OR v_response->>'rotationCount'<>'1'
     OR (SELECT count(*) FROM public.satellite_tickets
         WHERE source_tournament_id='e3000000-0000-4000-8000-000000000001')<>1
     OR (SELECT serial_no FROM public.satellite_tickets
         WHERE source_tournament_id='e3000000-0000-4000-8000-000000000001')<>1
     OR (SELECT ticket_liability_vnd FROM public.satellite_award_funding
         WHERE source_tournament_id='e3000000-0000-4000-8000-000000000001')<>6600000 THEN
    RAISE EXCEPTION 'code replacement changed the award or count'; END IF;
  BEGIN
    PERFORM public.satellite_lookup_ticket_v1(v_old);
    RAISE EXCEPTION 'old code remained redeemable';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    UPDATE public.satellite_tickets SET redemption_code=v_old
      WHERE source_tournament_id='e3000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'retired code was reissued';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
  IF public.satellite_lookup_ticket_v1(v_new)->>'status'<>'issued' THEN
    RAISE EXCEPTION 'new code is not active'; END IF;
  v_response := public.satellite_rotate_ticket_code_v1(
    'e3000000-0000-4000-8000-000000000001',1,v_old,
    'Ticket lost by bearer',v_attempt);
  IF v_response->>'idempotent'<>'true'
     OR (SELECT count(*) FROM public.satellite_ticket_code_rotations)<>1 THEN
    RAISE EXCEPTION 'retry duplicated a rotation'; END IF;
  BEGIN
    PERFORM public.satellite_rotate_ticket_code_v1(
      'e3000000-0000-4000-8000-000000000001',1,v_old,
      'Ticket lost by bearer','e5000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'stale code rotated again';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
  IF pg_catalog.has_table_privilege('authenticated',
      'public.satellite_ticket_code_rotations','SELECT') THEN
    RAISE EXCEPTION 'browser can read rotation secrets'; END IF;
END $test$;
ROLLBACK;
