-- Rollback-only PG17 contract against real Cashier schema and pending chain.
-- Synthetic seat/close-report baseline; no linked or live database.
\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.sat_issue_assert(ok boolean,label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'satellite Issue: %',label; END IF;
END $$;
INSERT INTO auth.users(id) VALUES
 ('c1000000-0000-4000-8000-000000000001'),
 ('c1000000-0000-4000-8000-000000000002');
INSERT INTO public.clubs(id,owner_id) VALUES
 ('c2000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,
  rake_amount,service_fee_amount,operations_mode)
VALUES
 ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001',
  'Issue source','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001',
  'Issue target','live','registering',now()+interval '3 day',900000,10000,70000,30000,'standard');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES('c4000000-0000-4000-8000-000000000001',
       'c2000000-0000-4000-8000-000000000001',0,
       'c1000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES('c5000000-0000-4000-8000-000000000001',
       'c3000000-0000-4000-8000-000000000001',
       'c1000000-0000-4000-8000-000000000002',
       'c2000000-0000-4000-8000-000000000001',1000000,1200000,'SAT-ISSUE-PAID','pending',
       '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}');
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
VALUES('c2000000-0000-4000-8000-000000000001',
       'c3000000-0000-4000-8000-000000000001',
       'c5000000-0000-4000-8000-000000000001',
       'c4000000-0000-4000-8000-000000000001',
       'in','cash','buyin',1200000,1200000,
       'c1000000-0000-4000-8000-000000000001','sat-issue:paid');
UPDATE public.tournament_registrations SET status='confirmed',cashier_paid_at=now(),
 confirmed_at=now(),confirmed_by='c1000000-0000-4000-8000-000000000001'
WHERE id='c5000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_entries
 (tournament_id,registration_id,player_id,entry_no,source,status)
VALUES('c3000000-0000-4000-8000-000000000001',
       'c5000000-0000-4000-8000-000000000001',
       'c1000000-0000-4000-8000-000000000002',1,'online','registered');
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id='c3000000-0000-4000-8000-000000000001';
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY['c2000000-0000-4000-8000-000000000001']::uuid[] WHERE id=true;
DO $$ DECLARE p jsonb; a jsonb; r jsonb; BEGIN
 a:='[{"position":1,"ticketCount":1,"cashVnd":"0"}]';
 p:=public.satellite_source_funding_preview_v2(
  'c3000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000002',a);
 r:=public.satellite_lock_award_plan_v1(
  'c3000000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000002',a,p->>'previewRevision',
  'c6000000-0000-4000-8000-000000000001');
 PERFORM pg_temp.sat_issue_assert(r->>'locked'='true' AND
  (SELECT target_buy_in_vnd=900000 AND target_fee_vnd=100000
    AND target_rake_vnd=70000 AND target_service_fee_vnd=30000
   FROM public.satellite_award_plans
   WHERE source_tournament_id='c3000000-0000-4000-8000-000000000001'),
  'Lock froze exact fee split');
END $$;
DO $$ BEGIN
 BEGIN
  UPDATE public.tournaments
  SET buy_in=950000,rake_amount=40000,service_fee_amount=10000
  WHERE id='c3000000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'target economics changed after Lock';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%satellite_locked_economics_immutable%' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.sat_issue_assert((SELECT buy_in=900000 AND rake_amount=70000
   AND service_fee_amount=30000 FROM public.tournaments
   WHERE id='c3000000-0000-4000-8000-000000000002'),
   'target price change rejected after Lock');
END $$;
UPDATE public.tournaments SET status='completed'
WHERE id='c3000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_close_report(tournament_id) VALUES
 ('c3000000-0000-4000-8000-000000000001');
DO $$ DECLARE r jsonb; code uuid; ticket uuid; BEGIN
 r:=public.satellite_issue_tickets_v2(
  'c3000000-0000-4000-8000-000000000001',
  '[{"position":1,"playerId":"c1000000-0000-4000-8000-000000000002"}]',
  'c7000000-0000-4000-8000-000000000001');
 PERFORM pg_temp.sat_issue_assert(r->>'issued'='true' AND r->>'idempotent'='false'
   AND (SELECT count(*)=1 FROM public.satellite_tickets
        WHERE source_tournament_id='c3000000-0000-4000-8000-000000000001'),
   'first Issue minted exact award quantity');
 SELECT id,redemption_code INTO ticket,code FROM public.satellite_tickets
 WHERE source_tournament_id='c3000000-0000-4000-8000-000000000001';
 PERFORM pg_temp.sat_issue_assert((SELECT target_buy_in_vnd=900000
   AND target_fee_vnd=100000 AND target_rake_vnd=70000
   AND target_service_fee_vnd=30000 FROM public.satellite_tickets WHERE id=ticket),
   'Issue retained exact frozen Lock components');
 r:=public.satellite_issue_tickets_v2(
  'c3000000-0000-4000-8000-000000000001',
  '[{"position":1,"playerId":"c1000000-0000-4000-8000-000000000002"}]',
  'c7000000-0000-4000-8000-000000000001');
 PERFORM pg_temp.sat_issue_assert(r->>'idempotent'='true','Issue retry');
 BEGIN
   PERFORM public.satellite_issue_tickets_v2(
    'c3000000-0000-4000-8000-000000000001','[]',
    'c7000000-0000-4000-8000-000000000001');
   RAISE EXCEPTION 'changed Issue payload accepted';
 EXCEPTION WHEN unique_violation THEN
   IF SQLERRM NOT LIKE '%satellite_issue_request_conflict%' THEN RAISE; END IF;
 END;
 r:=public.satellite_change_ticket_secret_v1(ticket,code,'rotate',
  'Lost original code','c8000000-0000-4000-8000-000000000001');
 PERFORM pg_temp.sat_issue_assert(r->>'status'='issued'
   AND (r->>'currentCode')::uuid<>code,'rotation invalidated original code');
 code:=(r->>'currentCode')::uuid;
 r:=public.satellite_change_ticket_secret_v1(ticket,code,'void',
  'Award corrected','c8000000-0000-4000-8000-000000000002');
 PERFORM pg_temp.sat_issue_assert(r->>'status'='voided'
   AND (SELECT count(*)=2 FROM public.satellite_ticket_secret_events WHERE ticket_id=ticket),
   'void and append-only audit');
 BEGIN
   PERFORM public.satellite_change_ticket_secret_v1(ticket,code,'rotate',
    'Attempt after void','c8000000-0000-4000-8000-000000000003');
   RAISE EXCEPTION 'voided ticket rotated';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM NOT LIKE '%satellite_ticket_not_current%' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
