-- Disposable local DB only, after Cashier V2 and Satellite migrations 01-04.
-- NEVER run against production. Source-only until executed on a disposable DB.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES
  ('d1000000-0000-4000-8000-000000000001','authenticated','authenticated','voucher-owner@test.invalid',now(),now()),
  ('d1000000-0000-4000-8000-000000000002','authenticated','authenticated','voucher-outsider@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status) VALUES
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Voucher TEST','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,start_time,buy_in,rake_amount,service_fee_amount,operations_mode,
   starting_stack)
VALUES
  ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
   'Satellite closed','completed',now(),1000000,100000,0,'satellite',30000),
  ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001',
   'Main 1C','scheduled',now()+interval '1 day',6000000,500000,100000,'standard',30000),
  ('d3000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001',
   'High Roller','scheduled',now()+interval '2 days',10000000,1000000,0,'standard',50000);
INSERT INTO public.game_tables
  (id,club_id,table_name,table_type,status,table_number)
VALUES ('d4000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001','Voucher TEST Table','tournament','active',1);
INSERT INTO public.tournament_tables
  (id,tournament_id,table_name,table_id,table_number,max_seats,status)
VALUES ('d5000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000002','Voucher TEST Table',
  'd4000000-0000-4000-8000-000000000001',1,9,'active');
INSERT INTO public.tournament_registrations
  (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,total_pay,
   reference_code,status,confirmed_at)
VALUES ('d3000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',1000000,100000,1100000,
  'VOUCHER-TEST-WINNER-1','confirmed',now()),
  ('d3000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000001',1000000,100000,1100000,
  'VOUCHER-TEST-WINNER-2','confirmed',now());
INSERT INTO public.tournament_entries(tournament_id,player_id,entry_no,status)
VALUES ('d3000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000001',1,'busted'),
  ('d3000000-0000-4000-8000-000000000001',
  'd6000000-0000-4000-8000-000000000002',1,'busted');
INSERT INTO public.tournament_close_report
  (tournament_id,club_id,closed_by,entry_count,buy_in_total,cash_in_total,club_revenue,prize_total)
VALUES ('d3000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',2,2000000,2200000,200000,0);
INSERT INTO public.satellite_award_plans
  (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
   award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
VALUES ('d3000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000001',6600000,
  '[{"position":1,"ticketCount":1,"cashVnd":"0"},{"position":2,"ticketCount":1,"cashVnd":"0"}]',2,0,13200000,
  'd1000000-0000-4000-8000-000000000001');
INSERT INTO public.cashier_tour_settings(club_id,enabled) VALUES
  ('d2000000-0000-4000-8000-000000000001',true);

SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $test$
DECLARE
  v_issue jsonb;
  v_first uuid;
  v_second uuid;
  v_guest uuid;
  v_result jsonb;
  v_repeat jsonb;
  v_summary jsonb;
BEGIN
  PERFORM public.satellite_approve_funding_v1(
    'd3000000-0000-4000-8000-000000000001',11200000,true);
  v_summary := public.satellite_get_transfer_summary_v1(
    'd3000000-0000-4000-8000-000000000001');
  IF v_summary->>'unissuedValueVnd'<>'13200000' OR
     v_summary->>'transferredValueVnd'<>'0' THEN
    RAISE EXCEPTION 'unissued ticket liability misreported'; END IF;
  v_issue := public.satellite_issue_tickets_v1(
    'd3000000-0000-4000-8000-000000000001',
    '[{"position":1,"playerId":"d6000000-0000-4000-8000-000000000001"},
      {"position":2,"playerId":"d6000000-0000-4000-8000-000000000002"}]');
  IF v_issue->>'ticketTotal' <> '2' THEN RAISE EXCEPTION 'ticket issue count wrong'; END IF;
  SELECT redemption_code INTO v_first FROM public.satellite_tickets
    WHERE serial_no=1 AND source_tournament_id='d3000000-0000-4000-8000-000000000001';
  SELECT redemption_code INTO v_second FROM public.satellite_tickets
    WHERE serial_no=2 AND source_tournament_id='d3000000-0000-4000-8000-000000000001';
  UPDATE public.cashier_tour_settings SET enabled=false
    WHERE club_id='d2000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(v_first,
      'd3000000-0000-4000-8000-000000000002',NULL,'Guest One');
    RAISE EXCEPTION 'disabled Cashier accepted voucher';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
  UPDATE public.cashier_tour_settings SET enabled=true
    WHERE club_id='d2000000-0000-4000-8000-000000000001';
  PERFORM set_config('request.jwt.claim.sub',
    'd1000000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.satellite_lookup_ticket_v1(v_first);
    RAISE EXCEPTION 'other club read ticket';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(v_first,
      'd3000000-0000-4000-8000-000000000002',NULL,'Guest One');
    RAISE EXCEPTION 'other club redeemed ticket';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',
    'd1000000-0000-4000-8000-000000000001',true);
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(v_first,
      'd3000000-0000-4000-8000-000000000003',NULL,'Guest One');
    RAISE EXCEPTION 'wrong destination accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF (SELECT status FROM public.satellite_tickets WHERE redemption_code=v_first)<>'issued' THEN
    RAISE EXCEPTION 'wrong destination consumed ticket'; END IF;
  UPDATE public.tournament_tables SET status='closed'
    WHERE id='d5000000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(v_first,
      'd3000000-0000-4000-8000-000000000002',NULL,'Guest One');
    RAISE EXCEPTION 'no-seat redemption accepted';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF (SELECT status FROM public.satellite_tickets WHERE redemption_code=v_first)<>'issued'
     OR EXISTS(SELECT 1 FROM public.tournament_registrations
               WHERE tournament_id='d3000000-0000-4000-8000-000000000002') THEN
    RAISE EXCEPTION 'no-seat failure left a partial registration'; END IF;
  UPDATE public.tournament_tables SET status='active'
    WHERE id='d5000000-0000-4000-8000-000000000001';
  v_result := public.satellite_redeem_ticket_v1(v_first,
    'd3000000-0000-4000-8000-000000000002',NULL,'Guest One');
  v_guest := (v_result->>'playerId')::uuid;
  IF v_result->>'ok'<>'true' OR v_result->>'cashReceivedVnd'<>'0'
     OR v_result->'seat'->>'receipt_id' IS NULL
     OR (SELECT status FROM public.satellite_tickets WHERE redemption_code=v_first)<>'redeemed'
     OR (SELECT count(*) FROM public.tournament_registrations
         WHERE tournament_id='d3000000-0000-4000-8000-000000000002'
           AND player_id=v_guest AND status='confirmed')<>1 THEN
    RAISE EXCEPTION 'atomic first redemption failed'; END IF;
  v_summary := public.satellite_get_transfer_summary_v1(
    'd3000000-0000-4000-8000-000000000001');
  IF v_summary->>'issuedValueVnd'<>'13200000' OR
     v_summary->>'transferredValueVnd'<>'6600000' OR
     v_summary->>'outstandingValueVnd'<>'6600000' OR
     (SELECT count(*) FROM public.satellite_voucher_transfers)<>1 THEN
    RAISE EXCEPTION 'source-to-target transfer split wrong'; END IF;
  v_summary := public.satellite_target_voucher_summary_v1(
    'd3000000-0000-4000-8000-000000000002');
  IF v_summary->>'grossRegistrationVnd'<>'6600000' OR
     v_summary->>'voucherTransferVnd'<>'6600000' OR
     v_summary->>'nonVoucherRegistrationVnd'<>'0' THEN
    RAISE EXCEPTION 'target preview counted voucher as new cash'; END IF;
  v_repeat := public.satellite_redeem_ticket_v1(v_first,
    'd3000000-0000-4000-8000-000000000002',NULL,'Guest One');
  IF v_repeat->>'idempotent'<>'true' THEN RAISE EXCEPTION 'same bearer retry failed'; END IF;
  IF (SELECT count(*) FROM public.satellite_voucher_transfers)<>1 THEN
    RAISE EXCEPTION 'retry duplicated internal transfer'; END IF;
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(v_first,
      'd3000000-0000-4000-8000-000000000002',NULL,'Different Bearer');
    RAISE EXCEPTION 'used ticket accepted for another bearer';
  EXCEPTION WHEN SQLSTATE '23505' THEN NULL;
  END;
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(v_second,
      'd3000000-0000-4000-8000-000000000002',v_guest,NULL);
    RAISE EXCEPTION 'active player re-entry accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  UPDATE public.tournaments SET registration_closed_at=now()
    WHERE id='d3000000-0000-4000-8000-000000000002';
  BEGIN
    PERFORM public.satellite_redeem_ticket_v1(v_second,
      'd3000000-0000-4000-8000-000000000002',v_guest,NULL);
    RAISE EXCEPTION 'closed target accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  UPDATE public.tournaments SET registration_closed_at=NULL
    WHERE id='d3000000-0000-4000-8000-000000000002';
  UPDATE public.tournament_seats SET is_active=false
    WHERE tournament_id='d3000000-0000-4000-8000-000000000002'
      AND player_id=v_guest AND is_active;
  UPDATE public.tournament_entries SET status='busted',current_stack=0,busted_at=now()
    WHERE tournament_id='d3000000-0000-4000-8000-000000000002'
      AND player_id=v_guest AND entry_no=1;
  v_result := public.satellite_redeem_ticket_v1(v_second,
    'd3000000-0000-4000-8000-000000000002',v_guest,NULL);
  IF v_result->>'reentry'<>'true' OR
     (SELECT count(*) FROM public.tournament_entries
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002'
        AND player_id=v_guest)<>2 OR
     (SELECT count(*) FROM public.seat_draw_receipts
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002'
        AND player_id=v_guest)<>2 OR
     EXISTS(SELECT 1 FROM public.cashier_buyin_movements m
            JOIN public.satellite_tickets st ON st.registration_id=m.registration_id
            WHERE st.source_tournament_id='d3000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'voucher re-entry or cash movement wrong'; END IF;
  v_summary := public.satellite_get_transfer_summary_v1(
    'd3000000-0000-4000-8000-000000000001');
  IF v_summary->>'transferredValueVnd'<>'13200000' OR
     v_summary->>'outstandingValueVnd'<>'0' OR
     (SELECT count(*) FROM public.satellite_voucher_transfers)<>2 THEN
    RAISE EXCEPTION 'redeemed ticket conservation wrong'; END IF;
  v_summary := public.satellite_target_voucher_summary_v1(
    'd3000000-0000-4000-8000-000000000002');
  IF v_summary->>'grossRegistrationVnd'<>'13200000' OR
     v_summary->>'voucherTransferVnd'<>'13200000' OR
     v_summary->>'nonVoucherRegistrationVnd'<>'0' THEN
    RAISE EXCEPTION 'target preview transfer split wrong'; END IF;
  BEGIN
    UPDATE public.tournament_registrations SET reference_code='FORGED-VOUCHER'
      WHERE id=(SELECT registration_id FROM public.satellite_tickets
                WHERE redemption_code=v_first);
    RAISE EXCEPTION 'redeemed voucher registration mutated';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
  IF jsonb_array_length((public.satellite_find_bearer_v1(
       'd3000000-0000-4000-8000-000000000002','Guest')->'players'))<>1 OR
     jsonb_array_length((public.satellite_redemptions_for_worklist_v1(
       'd3000000-0000-4000-8000-000000000002',
       ARRAY(SELECT registration_id FROM public.satellite_tickets
             WHERE source_tournament_id='d3000000-0000-4000-8000-000000000001'))
       ->'rows'))<>2 THEN
    RAISE EXCEPTION 'Cashier voucher worklist overlay wrong'; END IF;
END $test$;

-- A broken ticket->registration link must reject close, never bypass the
-- voucher adjustment by making the valid inner-join count zero.
DO $test$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    INSERT INTO public.tournament_registrations
      (tournament_id,player_id,club_id,buy_in,platform_fixed_fee,
       total_pay,reference_code,status,confirmed_at)
    SELECT 'd3000000-0000-4000-8000-000000000003',gen_random_uuid(),
      'd2000000-0000-4000-8000-000000000001',10000000,1000000,
      11000000,'WRONG-LINK-'||gs::text,'confirmed',now()
    FROM generate_series(1,2) gs;
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    UPDATE public.satellite_tickets st SET registration_id=r.id
    FROM public.tournament_registrations r
    WHERE r.reference_code='WRONG-LINK-'||st.serial_no::text
      AND st.source_tournament_id='d3000000-0000-4000-8000-000000000001';
    INSERT INTO public.tournament_close_report
      (tournament_id,club_id,closed_by,entry_count,buy_in_total,
       cash_in_total,club_revenue,prize_total)
    VALUES ('d3000000-0000-4000-8000-000000000002',
      'd2000000-0000-4000-8000-000000000001',
      'd1000000-0000-4000-8000-000000000001',2,12000000,
      13200000,1200000,0);
    RAISE EXCEPTION 'broken voucher link allowed gross-as-cash close';
  EXCEPTION WHEN SQLSTATE '23514' THEN NULL;
  END;
END $test$;

INSERT INTO public.tournament_close_report
  (tournament_id,club_id,closed_by,entry_count,buy_in_total,cash_in_total,club_revenue,prize_total)
VALUES ('d3000000-0000-4000-8000-000000000002',
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',2,12000000,13200000,1200000,0);
DO $test$ BEGIN
  IF (SELECT cash_in_total FROM public.tournament_close_report
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002')<>0 OR
     (SELECT buy_in_total FROM public.tournament_close_report
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002')<>12000000 OR
     (SELECT detail->>'satelliteVoucherTransferVnd' FROM public.tournament_close_report
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002')<>'13200000' OR
     (SELECT detail->>'satelliteVoucherFeesVnd' FROM public.tournament_close_report
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002')<>'1200000' THEN
    RAISE EXCEPTION 'target close counted voucher as fresh cash'; END IF;
  IF (SELECT club_revenue FROM public.tournament_close_report
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002')<>1200000 OR
     (SELECT detail->>'grossConsiderationVnd' FROM public.tournament_close_report
      WHERE tournament_id='d3000000-0000-4000-8000-000000000002')<>'13200000' OR
     (public.satellite_close_tournament_v1(
       'd3000000-0000-4000-8000-000000000002',NULL)->>'cash_in_total')::bigint<>0 THEN
    RAISE EXCEPTION 'target close transfer/fee report inconsistent'; END IF;
  IF pg_catalog.has_table_privilege('authenticated','public.satellite_tickets','SELECT') THEN
    RAISE EXCEPTION 'browser can read private ticket codes'; END IF;
END $test$;
ROLLBACK;
