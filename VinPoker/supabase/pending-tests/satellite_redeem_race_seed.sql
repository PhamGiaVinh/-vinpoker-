-- Disposable PG17 race seed; uses real historical initial and re-entry seat-confirm RPCs.
-- Persistent only within the disposable PG17 job; never run on a linked DB.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.tournament_entries ADD COLUMN created_at timestamptz DEFAULT now();
-- The disposable baseline's synthetic function has different parameter names;
-- replace it only in the disposable race database with the historical real RPC.
DROP FUNCTION public.confirm_registration_and_assign_seat(uuid,uuid,text);
\i supabase/pending-tests/satellite_real_initial_historical_fixture.sql
\i supabase/pending-tests/satellite_real_reentry_historical_fixture.sql
CREATE OR REPLACE FUNCTION pg_temp.sat_redeem_assert(ok boolean,label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Satellite Redeem: %',label; END IF;
END $$;

DO $$ DECLARE v_error text; BEGIN
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(
      'd1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'anonymous redeem accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'satellite_redeem_request_invalid' THEN RAISE; END IF;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE v_error text; BEGIN
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(
      'd1000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000002',
      '00000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'unknown code accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'satellite_ticket_not_current' THEN RAISE; END IF;
  END;
END $$;

SELECT pg_temp.sat_redeem_assert(
  (SELECT count(*)=0 FROM public.satellite_ticket_value_transfers)
  AND (SELECT count(*)=0 FROM public.satellite_redemption_requests),
  'denied requests wrote no transfer or receipt');
SELECT pg_temp.sat_redeem_assert(
  NOT has_table_privilege('authenticated','public.satellite_ticket_value_transfers','INSERT')
  AND NOT has_table_privilege('service_role','public.satellite_ticket_value_transfers','INSERT')
  AND NOT has_table_privilege('authenticated','public.satellite_redemption_requests','INSERT'),
  'direct transfer and receipt inserts stay private');

INSERT INTO auth.users(id) VALUES
 ('d1000000-0000-4000-8000-000000000011'),
 ('d1000000-0000-4000-8000-000000000012'),
 ('d1000000-0000-4000-8000-000000000013'),
 ('d1000000-0000-4000-8000-000000000014'),
 ('d1000000-0000-4000-8000-000000000015'),
 ('d1000000-0000-4000-8000-000000000016');
INSERT INTO public.clubs(id,owner_id) VALUES
 ('d2000000-0000-4000-8000-000000000011',
  'd1000000-0000-4000-8000-000000000011');
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,
  rake_amount,service_fee_amount,operations_mode)
VALUES
 ('d3000000-0000-4000-8000-000000000011','d2000000-0000-4000-8000-000000000011',
  'Redeem source','registering','registering',now()+interval '1 day',6600000,10000,1320000,0,'satellite'),
 ('d3000000-0000-4000-8000-000000000012','d2000000-0000-4000-8000-000000000011',
  'Redeem target','live','registering',now()+interval '3 day',6000000,10000,500000,100000,'standard');
INSERT INTO public.game_tables(id,club_id,table_name,status)
VALUES('d4000000-0000-4000-8000-000000000011',
 'd2000000-0000-4000-8000-000000000011','Redeem table','active');
INSERT INTO public.tournament_tables(tournament_id,table_id,table_number,max_seats,status)
VALUES('d3000000-0000-4000-8000-000000000012',
 'd4000000-0000-4000-8000-000000000011',1,9,'active');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES('d4000000-0000-4000-8000-000000000012',
 'd2000000-0000-4000-8000-000000000011',0,
 'd1000000-0000-4000-8000-000000000011');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES('d5000000-0000-4000-8000-000000000011',
 'd3000000-0000-4000-8000-000000000011',
 'd1000000-0000-4000-8000-000000000012',
 'd2000000-0000-4000-8000-000000000011',6600000,7920000,'SAT-REDEEM-SOURCE-1',
 'pending',
 '{"buy_in":6600000,"rake":1320000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":7920000}');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES('d5000000-0000-4000-8000-000000000012',
 'd3000000-0000-4000-8000-000000000011',
 'd1000000-0000-4000-8000-000000000014',
 'd2000000-0000-4000-8000-000000000011',6600000,7920000,'SAT-REDEEM-SOURCE-2',
 'pending',
 '{"buy_in":6600000,"rake":1320000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":7920000}');
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
VALUES('d2000000-0000-4000-8000-000000000011',
 'd3000000-0000-4000-8000-000000000011',
 'd5000000-0000-4000-8000-000000000011',
 'd4000000-0000-4000-8000-000000000012',
 'in','cash','buyin',7920000,7920000,
 'd1000000-0000-4000-8000-000000000011','sat-redeem:source');
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
VALUES('d2000000-0000-4000-8000-000000000011',
 'd3000000-0000-4000-8000-000000000011',
 'd5000000-0000-4000-8000-000000000012',
 'd4000000-0000-4000-8000-000000000012',
 'in','cash','buyin',7920000,7920000,
 'd1000000-0000-4000-8000-000000000011','sat-redeem:source:2');
UPDATE public.tournament_registrations SET status='confirmed',cashier_paid_at=now(),
 confirmed_at=now(),confirmed_by='d1000000-0000-4000-8000-000000000011'
WHERE id IN ('d5000000-0000-4000-8000-000000000011',
 'd5000000-0000-4000-8000-000000000012');
INSERT INTO public.tournament_entries
 (tournament_id,registration_id,player_id,entry_no,source,status)
VALUES('d3000000-0000-4000-8000-000000000011',
 'd5000000-0000-4000-8000-000000000011',
 'd1000000-0000-4000-8000-000000000012',1,'online','registered');
INSERT INTO public.tournament_entries
 (tournament_id,registration_id,player_id,entry_no,source,status)
VALUES('d3000000-0000-4000-8000-000000000011',
 'd5000000-0000-4000-8000-000000000012',
 'd1000000-0000-4000-8000-000000000014',1,'online','registered');
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id='d3000000-0000-4000-8000-000000000011';
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY['d2000000-0000-4000-8000-000000000011']::uuid[] WHERE id=true;
DO $$ DECLARE p jsonb; a jsonb; r jsonb; BEGIN
 a:='[{"position":1,"ticketCount":1,"cashVnd":"0"},
     {"position":2,"ticketCount":1,"cashVnd":"0"}]';
 p:=public.satellite_source_funding_preview_v2(
  'd3000000-0000-4000-8000-000000000011',
  'd3000000-0000-4000-8000-000000000012',a);
 r:=public.satellite_lock_award_plan_v1(
  'd3000000-0000-4000-8000-000000000011',
  'd3000000-0000-4000-8000-000000000012',a,p->>'previewRevision',
  'd6000000-0000-4000-8000-000000000011');
 PERFORM pg_temp.sat_redeem_assert(r->>'locked'='true','source Lock');
END $$;
UPDATE public.tournaments SET status='completed'
WHERE id='d3000000-0000-4000-8000-000000000011';
INSERT INTO public.tournament_close_report(tournament_id) VALUES
 ('d3000000-0000-4000-8000-000000000011');
DO $$ BEGIN PERFORM public.satellite_issue_tickets_v2(
 'd3000000-0000-4000-8000-000000000011',
 '[{"position":1,"playerId":"d1000000-0000-4000-8000-000000000012"},
   {"position":2,"playerId":"d1000000-0000-4000-8000-000000000014"}]',
 'd7000000-0000-4000-8000-000000000011'); END $$;
INSERT INTO public.cashier_tour_settings(club_id,enabled)
VALUES('d2000000-0000-4000-8000-000000000011',true)
ON CONFLICT (club_id) DO UPDATE SET enabled=true;
CREATE TABLE public.satellite_redeem_race_results (
  worker text PRIMARY KEY, outcome text NOT NULL, registration_id uuid
);
COMMIT;
