-- Disposable PG17 only. Runs after real initial/re-entry Redeem race fixture.
-- No live DB; real historical seat-confirm RPCs produced both voucher seats.
\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
DO $$ DECLARE v_ticket uuid; v_reg uuid; v_transfer uuid; v_code uuid;
  v_correction uuid:='d9000000-0000-4000-8000-000000000001';
  v_request uuid:='d9000000-0000-4000-8000-000000000002';
  v_result jsonb; v_error text;
BEGIN
  IF has_table_privilege('authenticated','public.satellite_redemption_reversals','INSERT')
     OR has_table_privilege('service_role','public.satellite_redemption_reversals','INSERT') THEN
    RAISE EXCEPTION 'direct reversal writes exposed'; END IF;
  SELECT id,registration_id,redemption_code INTO v_ticket,v_reg,v_code
    FROM public.satellite_tickets
   WHERE source_tournament_id='d3000000-0000-4000-8000-000000000011'
     AND serial_no=1;
  SELECT id INTO v_transfer FROM public.satellite_ticket_value_transfers
   WHERE ticket_id=v_ticket;
  IF v_ticket IS NULL OR v_reg IS NULL OR v_transfer IS NULL THEN
    RAISE EXCEPTION 'reversal fixture missing real redeemed ticket'; END IF;
  v_result:=public.satellite_request_redemption_correction_v1(
    v_ticket,'Unused voucher issued to wrong bearer',v_correction);
  IF v_result->>'status'<>'held' THEN RAISE EXCEPTION 'correction not held'; END IF;
  v_result:=public.satellite_request_redemption_correction_v1(
    v_ticket,'Unused voucher issued to wrong bearer',v_correction);
  IF v_result->>'idempotent'<>'true' THEN RAISE EXCEPTION 'correction retry'; END IF;
  BEGIN
    PERFORM public.satellite_request_redemption_correction_v1(
      v_ticket,'A different reason',v_correction);
    RAISE EXCEPTION 'changed correction accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_correction_request_conflict' THEN RAISE; END IF;
  END;
  -- A recorded hand makes a paid voucher reversal unsafe. The exception
  -- subtransaction removes that hand without disabling a production guard.
  BEGIN
    INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number)
    VALUES('d3000000-0000-4000-8000-000000000012',
      'd4000000-0000-4000-8000-000000000011',1);
    BEGIN
      PERFORM public.satellite_approve_redemption_reversal_v1(
        v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
      RAISE EXCEPTION 'post-hand reversal accepted';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      IF v_error<>'satellite_reversal_unsafe_after_play_or_move' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION 'ROLLBACK_TEST_HAND';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'ROLLBACK_TEST_HAND' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.satellite_redemption_reversals
      WHERE ticket_id=v_ticket) THEN
    RAISE EXCEPTION 'unsafe reversal wrote compensation'; END IF;
  BEGIN
    UPDATE public.tournament_registrations SET status='cancelled' WHERE id=v_reg;
    RAISE EXCEPTION 'voucher cancelled without compensation';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_redemption_reversal_required' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.tournament_registrations WHERE id=v_reg;
    RAISE EXCEPTION 'voucher registration deleted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_redeemed_artifact_delete_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.tournament_entries WHERE registration_id=v_reg;
    RAISE EXCEPTION 'voucher entry deleted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_redeemed_artifact_delete_forbidden' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
    SELECT e.tournament_id,e.player_id,e.entry_no,e.current_stack
      FROM public.tournament_entries e WHERE e.registration_id=v_reg;
    BEGIN
      PERFORM public.satellite_approve_redemption_reversal_v1(
        v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
      RAISE EXCEPTION 'post-chip-count reversal accepted';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      IF v_error<>'satellite_reversal_unsafe_after_play_or_move' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION 'ROLLBACK_TEST_CHIP_COUNT';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'ROLLBACK_TEST_CHIP_COUNT' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000012',true);
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
    RAISE EXCEPTION 'non-owner reversal accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_reversal_owner_required' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000011',true);
  v_result:=public.satellite_approve_redemption_reversal_v1(
    v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
  IF v_result->>'status'<>'reversed' OR v_result->>'idempotent'<>'false' THEN
    RAISE EXCEPTION 'approved reversal result %',v_result; END IF;
  v_result:=public.satellite_approve_redemption_reversal_v1(
    v_ticket,v_correction,'Owner approved unused voucher reversal',v_request);
  IF v_result->>'idempotent'<>'true' THEN RAISE EXCEPTION 'reversal retry'; END IF;
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      v_ticket,v_correction,'Different approval explanation',v_request);
    RAISE EXCEPTION 'changed reversal accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_reversal_request_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.satellite_approve_redemption_reversal_v1(
      v_ticket,v_correction,'Owner approved unused voucher reversal',
      'd9000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'second compensation accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_ticket_already_reversed' THEN RAISE; END IF;
  END;
  IF (SELECT status='cancelled' FROM public.tournament_registrations WHERE id=v_reg)
      IS DISTINCT FROM true
     OR (SELECT count(*)=1 FROM public.satellite_ticket_value_transfers
         WHERE id=v_transfer) IS DISTINCT FROM true
     OR (SELECT count(*)=1 AND sum(target_debit_vnd)=6600000
         AND sum(source_credit_vnd)=6600000
         FROM public.satellite_redemption_reversals WHERE ticket_id=v_ticket)
        IS DISTINCT FROM true
     OR EXISTS(SELECT 1 FROM public.cashier_buyin_movements WHERE registration_id=v_reg)
  THEN RAISE EXCEPTION 'reversal conservation/history failed'; END IF;
  v_result:=public.satellite_verify_ticket_v1(v_code);
  IF v_result->>'status'<>'reversed' OR v_result ? 'code' THEN
    RAISE EXCEPTION 'verify leaked code or missed reversal'; END IF;
  SELECT public.satellite_get_redemption_receipt_v1(r.request_id) INTO v_result
    FROM public.satellite_redemption_requests r WHERE r.ticket_id=v_ticket;
  IF v_result->>'status'<>'reversed' OR v_result->>'registrationId'<>v_reg::text THEN
    RAISE EXCEPTION 'server receipt did not show reversal'; END IF;
  BEGIN
    INSERT INTO public.tournament_hands(tournament_id,table_id,hand_number)
    VALUES('d3000000-0000-4000-8000-000000000012',
      'd4000000-0000-4000-8000-000000000011',2);
    INSERT INTO public.hand_players(hand_id,tournament_id,player_id,
      entry_number,seat_number,starting_stack,ending_stack)
    SELECT h.id,h.tournament_id,e.player_id,e.entry_no,1,10000,10000
      FROM public.tournament_hands h JOIN public.tournament_entries e
        ON e.registration_id=v_reg WHERE h.hand_number=2;
    RAISE EXCEPTION 'reversed entry played';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error<>'satellite_reversed_entry_cannot_play' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.satellite_ticket_value_transfers SET target_credit_vnd=1
      WHERE id=v_transfer;
    RAISE EXCEPTION 'original transfer changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.satellite_redemption_reversals SET target_debit_vnd=1
      WHERE ticket_id=v_ticket;
    RAISE EXCEPTION 'compensation changed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
COMMIT;
