-- Disposable PG17 contract. Load the archived real initial seat-confirm RPC
-- inside this rollback transaction; re-entry/races require a separate proof.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.tournament_entries ADD COLUMN created_at timestamptz DEFAULT now();
-- The disposable baseline's synthetic function has different parameter names;
-- replace it only in this rollback transaction with the historical real RPC.
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
 ('d1000000-0000-4000-8000-000000000015');
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
SELECT public.satellite_issue_tickets_v2(
 'd3000000-0000-4000-8000-000000000011',
 '[{"position":1,"playerId":"d1000000-0000-4000-8000-000000000012"},
   {"position":2,"playerId":"d1000000-0000-4000-8000-000000000014"}]',
 'd7000000-0000-4000-8000-000000000011');
INSERT INTO public.cashier_tour_settings(club_id,enabled)
VALUES('d2000000-0000-4000-8000-000000000011',true)
ON CONFLICT (club_id) DO UPDATE SET enabled=true;
DO $$ DECLARE code uuid; r jsonb; v_id uuid; v_ticket_id uuid; BEGIN
 SELECT redemption_code INTO code FROM public.satellite_tickets
 WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
   AND serial_no=1;
 r:=public.satellite_redeem_ticket_v1(code,
  'd8000000-0000-4000-8000-000000000011',
  'd1000000-0000-4000-8000-000000000013');
 v_id:=(r->>'registrationId')::uuid;
 SELECT ticket_id INTO v_ticket_id FROM public.satellite_ticket_value_transfers
 WHERE registration_id=v_id;
 PERFORM pg_temp.sat_redeem_assert(r->>'ok'='true'
   AND r->>'winnerPlayerId'='d1000000-0000-4000-8000-000000000012'
   AND r->>'redeemedForPlayerId'='d1000000-0000-4000-8000-000000000013'
   AND (SELECT player_id='d1000000-0000-4000-8000-000000000013'
        AND status='confirmed' FROM public.tournament_registrations WHERE id=v_id)
   AND (SELECT target_credit_vnd=6600000 AND target_buy_in_vnd=6000000
        AND target_rake_vnd=500000 AND target_service_fee_vnd=100000
        AND redeemed_for_player_id='d1000000-0000-4000-8000-000000000013'
        FROM public.satellite_ticket_value_transfers WHERE registration_id=v_id),
   'bearer differs from winner; 6.6m transfer splits into 6m plus 0.6m fees');
 r:=public.satellite_redeem_ticket_v1(code,
  'd8000000-0000-4000-8000-000000000011',
  'd1000000-0000-4000-8000-000000000013');
 PERFORM pg_temp.sat_redeem_assert(r->>'idempotent'='true','same request retry');
 BEGIN
  PERFORM public.satellite_redeem_ticket_v1(code,
   'd8000000-0000-4000-8000-000000000011',
   'd1000000-0000-4000-8000-000000000012');
  RAISE EXCEPTION 'changed player accepted';
 EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%satellite_redeem_request_conflict%' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.sat_redeem_assert(
   (SELECT count(*)=0 FROM public.cashier_buyin_movements WHERE registration_id=v_id),
   'voucher created no cash collection');
 r:=public.satellite_request_redemption_correction_v1(v_ticket_id,
   'Bearer identity needs owner review',
   'd9000000-0000-4000-8000-000000000011');
 PERFORM pg_temp.sat_redeem_assert(r->>'status'='held'
   AND r->>'idempotent'='false'
   AND (SELECT count(*)=1 FROM public.satellite_ticket_value_transfers
        WHERE registration_id=v_id),
   'correction intake holds without reversing value');
 r:=public.satellite_request_redemption_correction_v1(v_ticket_id,
   'Bearer identity needs owner review',
   'd9000000-0000-4000-8000-000000000011');
 PERFORM pg_temp.sat_redeem_assert(r->>'idempotent'='true',
   'correction request retry');
 BEGIN
  PERFORM public.satellite_request_redemption_correction_v1(v_ticket_id,
    'Changed correction reason',
    'd9000000-0000-4000-8000-000000000011');
  RAISE EXCEPTION 'changed correction accepted';
 EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%satellite_correction_request_conflict%' THEN RAISE; END IF;
 END;
 r:=public.cashier_create_app_registration_v1(
  'd3000000-0000-4000-8000-000000000012',
  'd1000000-0000-4000-8000-000000000013');
 PERFORM pg_temp.sat_redeem_assert(r->>'already_registered'='true'
   AND r->>'registration_id'=v_id::text,
   'cash registration sees the voucher participation');
 BEGIN
  INSERT INTO public.tournament_registrations
   (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status)
  VALUES('d3000000-0000-4000-8000-000000000012',
   'd1000000-0000-4000-8000-000000000013',
   'd2000000-0000-4000-8000-000000000011',6000000,6600000,
   'SAT-REDEEM-DIRECT-DUPLICATE','pending');
  RAISE EXCEPTION 'direct active registration accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%satellite_target_player_already_seated%' THEN RAISE; END IF;
 END;
END $$;
DO $$ DECLARE code uuid; source_entry uuid; r jsonb; BEGIN
 SELECT redemption_code INTO code FROM public.satellite_tickets
 WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
   AND serial_no=2;
 -- The first ticket already seated player 13; a second ticket for that same
 -- player cannot create a second active participation.
 BEGIN
  PERFORM public.satellite_redeem_ticket_v1(code,
   'd8000000-0000-4000-8000-000000000012',
   'd1000000-0000-4000-8000-000000000013');
  RAISE EXCEPTION 'duplicate active player accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%satellite_player_already_seated%' THEN RAISE; END IF;
 END;
 INSERT INTO public.tournament_entries
   (tournament_id,player_id,entry_no,source,status)
 VALUES('d3000000-0000-4000-8000-000000000012',
   'd1000000-0000-4000-8000-000000000014',1,'online','registered')
 RETURNING id INTO source_entry;
 BEGIN
  PERFORM public.satellite_redeem_ticket_v1(code,
   'd8000000-0000-4000-8000-000000000013',
   'd1000000-0000-4000-8000-000000000014',source_entry);
  RAISE EXCEPTION 're-entry before bust accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%satellite_reentry_not_eligible%' THEN RAISE; END IF;
 END;
 UPDATE public.tournament_entries SET status='busted' WHERE id=source_entry;
 UPDATE public.tournaments SET registration_closed_at=now()
 WHERE id='d3000000-0000-4000-8000-000000000012';
 BEGIN
  PERFORM public.satellite_redeem_ticket_v1(code,
   'd8000000-0000-4000-8000-000000000013',
   'd1000000-0000-4000-8000-000000000014',source_entry);
  RAISE EXCEPTION 're-entry after cutoff accepted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%satellite_reentry_not_eligible%' THEN RAISE; END IF;
 END;
 UPDATE public.tournaments SET registration_closed_at=NULL
 WHERE id='d3000000-0000-4000-8000-000000000012';
 PERFORM pg_temp.sat_redeem_assert(
  (SELECT registration_closed_at IS NULL AND
    current_level<=coalesce(late_reg_close_level,6)
   FROM public.tournaments WHERE id='d3000000-0000-4000-8000-000000000012'),
  'target reopened before late-registration level');
 PERFORM pg_temp.sat_redeem_assert(
  (SELECT status='busted' FROM public.tournament_entries WHERE id=source_entry),
  'source entry stayed busted');
 PERFORM pg_temp.sat_redeem_assert(
  (SELECT id=source_entry FROM public.tournament_entries
   WHERE tournament_id='d3000000-0000-4000-8000-000000000012'
     AND player_id='d1000000-0000-4000-8000-000000000014'
   ORDER BY entry_no DESC,id DESC LIMIT 1),
  'busted source is latest entry');
 PERFORM pg_temp.sat_redeem_assert(
  NOT EXISTS(SELECT 1 FROM public.tournament_registrations
   WHERE source_entry_id=source_entry AND status IN ('pending','confirmed')),
  'no earlier active re-entry registration');
 r:=public.satellite_redeem_ticket_v1(code,
  'd8000000-0000-4000-8000-000000000013',
  'd1000000-0000-4000-8000-000000000014',source_entry);
 PERFORM pg_temp.sat_redeem_assert(r->>'ok'='true'
  AND (SELECT status='confirmed' AND source_entry_id=source_entry
       FROM public.tournament_registrations
       WHERE id=(r->>'registrationId')::uuid)
  AND (SELECT count(*)=1 FROM public.seat_draw_receipts
       WHERE registration_id=(r->>'registrationId')::uuid),
  'real re-entry confirm after bust produced one seat receipt');
END $$;
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000015',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE v_error text; BEGIN
 BEGIN
  INSERT INTO public.tournament_registrations
   (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status)
  VALUES('d3000000-0000-4000-8000-000000000012',
   'd1000000-0000-4000-8000-000000000015',
   'd2000000-0000-4000-8000-000000000011',6000000,6600000,
   'SAT-DIRECT-RLS','pending');
  RAISE EXCEPTION 'direct RLS registration accepted';
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
  IF v_error <> 'Tour buy-in registration must be created by server' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
ROLLBACK;
