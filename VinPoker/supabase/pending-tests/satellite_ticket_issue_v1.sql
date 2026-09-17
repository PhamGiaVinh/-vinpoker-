-- Disposable local DB only, after both pending Satellite migrations. NEVER live.
-- Source-only test specification until a disposable Postgres is available.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated','ticket-owner-a@test.invalid',now(),now()),
  ('b1000000-0000-4000-8000-000000000002','authenticated','authenticated','ticket-owner-b@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Ticket TEST A','HCM','approved'),
  ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','Ticket TEST B','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode)
VALUES
  ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Satellite closed','completed',now(),1000000,100000,0,'satellite'),
  ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001','Main 1C','scheduled',now()+interval '1 day',6000000,500000,100000,'standard');
INSERT INTO public.tournament_close_report(tournament_id,club_id,closed_by)
VALUES ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001');
INSERT INTO public.satellite_award_plans
  (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
   award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
VALUES
  ('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002',
   'b2000000-0000-4000-8000-000000000001',6600000,
   '[{"position":1,"ticketCount":1,"cashVnd":"0"},{"position":2,"ticketCount":1,"cashVnd":"0"},{"position":3,"ticketCount":1,"cashVnd":"0"},{"position":4,"ticketCount":0,"cashVnd":"500000"}]',
   3,500000,20300000,'b1000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,confirmed_at)
VALUES
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',1000000,1100000,'TICKET-TEST-WINNER-1','confirmed',now()),
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',1000000,1100000,'TICKET-TEST-WINNER-2','confirmed',now()),
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000001',1000000,1100000,'TICKET-TEST-WINNER-3','confirmed',now()),
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000001',1000000,1100000,'TICKET-TEST-WINNER-4','confirmed',now());
INSERT INTO public.tournament_entries(tournament_id,player_id,entry_no,status) VALUES
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',1,'busted'),
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002',1,'busted'),
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000003',1,'busted'),
  ('b3000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000004',1,'busted');

SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
DO $test$
DECLARE
  v_results jsonb := '[{"position":1,"playerId":"b4000000-0000-4000-8000-000000000001"},
                       {"position":2,"playerId":"b4000000-0000-4000-8000-000000000002"},
                       {"position":3,"playerId":"b4000000-0000-4000-8000-000000000003"},
                       {"position":4,"playerId":"b4000000-0000-4000-8000-000000000004"}]';
  v_response jsonb;
BEGIN
  BEGIN
    PERFORM public.satellite_issue_tickets_v1('b3000000-0000-4000-8000-000000000001',
      '[{"position":1,"playerId":"b4000000-0000-4000-8000-000000000001"},
        {"position":2,"playerId":"b4000000-0000-4000-8000-000000000001"},
        {"position":3,"playerId":"b4000000-0000-4000-8000-000000000003"},
        {"position":4,"playerId":"b4000000-0000-4000-8000-000000000004"}]');
    RAISE EXCEPTION 'same player awarded twice';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.satellite_tickets WHERE source_tournament_id='b3000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'failed issuance wrote tickets';
  END IF;
  BEGIN
    PERFORM public.satellite_issue_tickets_v1('b3000000-0000-4000-8000-000000000001',
      '[{"position":1,"playerId":"b4000000-0000-4000-8000-000000000001"},
        {"position":2,"playerId":"b4000000-0000-4000-8000-000000000005"},
        {"position":3,"playerId":"b4000000-0000-4000-8000-000000000003"},
        {"position":4,"playerId":"b4000000-0000-4000-8000-000000000004"}]');
    RAISE EXCEPTION 'unregistered winner accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_issue_tickets_v1('b3000000-0000-4000-8000-000000000001',
      '[{"position":1,"playerId":"b4000000-0000-4000-8000-000000000001"},
        {"position":1,"playerId":"b4000000-0000-4000-8000-000000000002"},
        {"position":3,"playerId":"b4000000-0000-4000-8000-000000000003"},
        {"position":4,"playerId":"b4000000-0000-4000-8000-000000000004"}]');
    RAISE EXCEPTION 'duplicate rank accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  v_response := public.satellite_issue_tickets_v1('b3000000-0000-4000-8000-000000000001',v_results);
  IF (v_response->>'ticketTotal')::integer <> 3 OR
     (SELECT count(*) FROM public.satellite_tickets WHERE source_tournament_id='b3000000-0000-4000-8000-000000000001') <> 3 OR
     (SELECT count(DISTINCT award_position) FROM public.satellite_tickets WHERE source_tournament_id='b3000000-0000-4000-8000-000000000001') <> 3 OR
     (SELECT count(DISTINCT redemption_code) FROM public.satellite_tickets WHERE source_tournament_id='b3000000-0000-4000-8000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'ticket count or random code mismatch';
  END IF;
  PERFORM public.satellite_issue_tickets_v1('b3000000-0000-4000-8000-000000000001',v_results);
  IF (SELECT count(*) FROM public.satellite_tickets WHERE source_tournament_id='b3000000-0000-4000-8000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'retry duplicated tickets';
  END IF;
  BEGIN
    PERFORM public.satellite_issue_tickets_v1('b3000000-0000-4000-8000-000000000001',
      '[{"position":1,"playerId":"b4000000-0000-4000-8000-000000000002"},
        {"position":2,"playerId":"b4000000-0000-4000-8000-000000000001"},
        {"position":3,"playerId":"b4000000-0000-4000-8000-000000000003"},
        {"position":4,"playerId":"b4000000-0000-4000-8000-000000000004"}]');
    RAISE EXCEPTION 'changed winners accepted after lock';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
END $test$;

DO $test$
BEGIN
  IF pg_catalog.has_table_privilege('authenticated','public.satellite_tickets','SELECT') THEN
    RAISE EXCEPTION 'browser can read private ticket codes directly';
  END IF;
END $test$;

SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
DO $test$
BEGIN
  BEGIN
    PERFORM public.satellite_issue_tickets_v1('b3000000-0000-4000-8000-000000000001',
      '[{"position":1,"playerId":"b4000000-0000-4000-8000-000000000001"},
        {"position":2,"playerId":"b4000000-0000-4000-8000-000000000002"},
        {"position":3,"playerId":"b4000000-0000-4000-8000-000000000003"},
        {"position":4,"playerId":"b4000000-0000-4000-8000-000000000004"}]');
    RAISE EXCEPTION 'other club issued tickets';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_get_issuance_v1('b3000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'other club read ticket codes';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END $test$;
ROLLBACK;
