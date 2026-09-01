\set ON_ERROR_STOP on

SELECT public.tracker_voice_test_assert(
  length(public._series_sha256_jsonb_v1('{"stateVersion":"abc"}'::JSONB)) = 64,
  'strict Series canonicalizer accepts its existing camelCase contract'
);

DO $proof$
DECLARE
  v_message TEXT;
BEGIN
  BEGIN
    PERFORM public._series_sha256_jsonb_v1('{"state_version":"abc"}'::JSONB);
    RAISE EXCEPTION 'expected strict Series snake_case rejection';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'series_canonical_json_invalid_machine_key' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public._tracker_voice_request_hash('{"state_version":"abc"}'::JSONB);
    RAISE EXCEPTION 'expected pre-fix Voice snake_case rejection';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'series_canonical_json_invalid_machine_key' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public._tracker_voice_request_hash(jsonb_build_object(
      'tournament_id', '85000000-0000-4000-8000-000000000001',
      'tournament_table_id', '84000000-0000-4000-8000-000000000001',
      'hand_id', '86000000-0000-4000-8000-000000000001',
      'execution_mode', 'assist'
    ));
    RAISE EXCEPTION 'expected representative pre-fix Voice rejection';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'series_canonical_json_invalid_machine_key' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public._tracker_unified_ops_request_hash_v2(jsonb_build_object(
      'tournament_id', '85000000-0000-4000-8000-000000000001',
      'button_seat', 1
    ));
    RAISE EXCEPTION 'expected independent Unified Ops snake_case rejection';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'series_canonical_json_invalid_machine_key' THEN
      RAISE;
    END IF;
  END;
END;
$proof$;

SELECT 'TRACKER_VOICE_HASH_V2_RED_PROOF_PASS' AS result;
