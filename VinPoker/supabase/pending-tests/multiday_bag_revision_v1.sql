-- Depends on baseline, End Flight migration/test, then bag revision migration.
INSERT INTO auth.users(id) VALUES
 ('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.chip_bag(tournament_id,club_id,day_number,player_id,
      bag_code,stack_value,total_value,multi_day_revision,multi_day_roster_hash)
    SELECT f.flight_tournament_id,f.club_id,f.day_number,r.player_id,
      'OLD-RPC',r.tracked_stack,r.tracked_stack,0,f.roster_hash
    FROM public.multi_day_flight_ends_v1 f JOIN public.multi_day_flight_roster_v1 r
      ON r.flight_tournament_id=f.flight_tournament_id
    WHERE f.flight_tournament_id='40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'legacy_or_direct_bag_insert_allowed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'multi_day_bag_revision_or_seal_invalid' THEN RAISE; END IF;
  END;
END $$;
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000002';
DO $$ DECLARE v_receipt jsonb; BEGIN
  v_receipt:=public.multi_day_record_bag_v1(
    '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001','  FLIGHT-1-A ',98000,0,
    'c0000000-0000-0000-0000-000000000011');
  IF v_receipt->>'revision'<>'1' OR v_receipt->>'variance'<>'-2000'
    OR (SELECT bag_code FROM public.chip_bag WHERE tournament_id=
       '40000000-0000-0000-0000-000000000001')<>'FLIGHT-1-A' THEN
    RAISE EXCEPTION 'dealer_bag_record_wrong: %',v_receipt;
  END IF;
  v_receipt:=public.multi_day_record_bag_v1(
    '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001','  FLIGHT-1-A ',98000,0,
    'c0000000-0000-0000-0000-000000000011');
  IF v_receipt->>'idempotent'<>'true' THEN RAISE EXCEPTION 'bag_retry_not_idempotent'; END IF;
  BEGIN
    PERFORM public.multi_day_record_bag_v1(
      '40000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001','DIFFERENT',98000,0,
      'c0000000-0000-0000-0000-000000000011');
    RAISE EXCEPTION 'bag_request_payload_change_allowed';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM<>'multi_day_bag_request_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.multi_day_record_bag_v1(
      '40000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001','FLIGHT-1-B',100000,0,
      'c0000000-0000-0000-0000-000000000012');
    RAISE EXCEPTION 'stale_bag_edit_allowed';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM<>'multi_day_bag_stale_or_sealed' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.chip_bag SET total_value=100000,multi_day_revision=2
      WHERE tournament_id='40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'direct_bag_update_allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'multi_day_bag_write_not_authorized' THEN RAISE; END IF;
  END;
  v_receipt:=public.multi_day_record_bag_v1(
    '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001','FLIGHT-1-B',100000,1,
    'c0000000-0000-0000-0000-000000000013');
  IF v_receipt->>'revision'<>'2' OR v_receipt->>'variance'<>'0' THEN
    RAISE EXCEPTION 'dealer_edit_wrong: %',v_receipt;
  END IF;
END $$;
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000003';
DO $$ DECLARE v_receipt jsonb; BEGIN
  BEGIN
    UPDATE public.day_close SET status='locked',locked_at=now(),
      expected_total_value=100000,counted_total_value=100000,all_zero=true
      WHERE tournament_id='40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'day_locked_before_seal';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'multi_day_day_close_bags_unreconciled' THEN RAISE; END IF;
  END;
  v_receipt:=public.multi_day_seal_bag_v1(
    '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',2,
    'c0000000-0000-0000-0000-000000000014');
  IF v_receipt->>'sealedVersion'<>'3' OR v_receipt->>'sealed'<>'true'
     OR (SELECT count(*) FROM public.chip_bag WHERE sealed AND multi_day_revision=3)<>1 THEN
    RAISE EXCEPTION 'chip_master_seal_wrong: %',v_receipt;
  END IF;
  v_receipt:=public.multi_day_seal_bag_v1(
    '40000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',2,
    'c0000000-0000-0000-0000-000000000014');
  IF v_receipt->>'idempotent'<>'true' THEN RAISE EXCEPTION 'seal_retry_not_idempotent'; END IF;
  BEGIN
    UPDATE public.chip_bag SET sealed=false,multi_day_revision=4,
      multi_day_sealed_version=NULL
      WHERE tournament_id='40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'legacy_unseal_allowed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'multi_day_bag_revision_or_seal_invalid' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.multi_day_seal_bag_v1(
      '40000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',2,
      'c0000000-0000-0000-0000-000000000015');
    RAISE EXCEPTION 'stale_seal_allowed';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM<>'multi_day_bag_stale_or_sealed' THEN RAISE; END IF;
  END;
  v_receipt:=public.multi_day_close_bagging_v1(
    '40000000-0000-0000-0000-000000000001',0,
    'c0000000-0000-0000-0000-000000000016');
  IF v_receipt->>'bagCount'<>'1' OR v_receipt->>'countedTotal'<>'100000'
    OR (SELECT status FROM public.multi_day_flight_ends_v1
      WHERE flight_tournament_id='40000000-0000-0000-0000-000000000001')<>'locked' THEN
    RAISE EXCEPTION 'close_bagging_wrong: %',v_receipt;
  END IF;
  v_receipt:=public.multi_day_close_bagging_v1(
    '40000000-0000-0000-0000-000000000001',0,
    'c0000000-0000-0000-0000-000000000016');
  IF v_receipt->>'idempotent'<>'true' THEN RAISE EXCEPTION 'close_retry_not_idempotent'; END IF;
  BEGIN
    UPDATE public.day_close SET status='open'
      WHERE tournament_id='40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'legacy_reopen_allowed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'multi_day_day_close_locked_immutable' THEN RAISE; END IF;
  END;
END $$;
DO $$ DECLARE v_state jsonb; BEGIN
  v_state:=public.multi_day_bagging_state_v1(
    '40000000-0000-0000-0000-000000000001');
  IF v_state->>'manager'<>'true' OR v_state->>'status'<>'locked'
     OR pg_catalog.jsonb_array_length(v_state->'rows')<>1
     OR v_state->'rows'->0->>'sealedVersion'<>'3' THEN
    RAISE EXCEPTION 'chip_master_state_wrong: %',v_state;
  END IF;
END $$;
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000004';
DO $$ BEGIN
  BEGIN
    PERFORM public.multi_day_bagging_state_v1(
      '40000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'stranger_read_allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'multi_day_bagging_read_unauthorized' THEN RAISE; END IF;
  END;
END $$;
INSERT INTO public.chip_bag(tournament_id,club_id,day_number,player_id,
  bag_code,stack_value,total_value)
VALUES('40000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000001',1,
  '60000000-0000-0000-0000-000000000003','NON-FLIGHT',100,100);
SELECT 'multiday_bag_revision_v1 PASS' AS result;
