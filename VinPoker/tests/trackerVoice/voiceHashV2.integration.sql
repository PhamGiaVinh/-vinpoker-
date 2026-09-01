\set ON_ERROR_STOP on

SELECT public.tracker_voice_test_assert(
  to_regprocedure('public._tracker_voice_canonical_json_v2(jsonb)') IS NOT NULL
  AND to_regprocedure('public._tracker_voice_sha256_jsonb_v2(jsonb)') IS NOT NULL
  AND to_regprocedure('public._tracker_voice_request_hash(jsonb)') IS NOT NULL,
  'Voice-specific canonical hash functions exist'
);

SELECT public.tracker_voice_test_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid IN (
      'public._tracker_voice_canonical_json_v2(jsonb)'::regprocedure,
      'public._tracker_voice_sha256_jsonb_v2(jsonb)'::regprocedure,
      'public._tracker_voice_request_hash(jsonb)'::regprocedure
    )
      AND (
        p.prosecdef
        OR p.provolatile <> 'i'
        OR COALESCE(array_to_string(p.proconfig, ','), '') <> 'search_path=""'
      )
  ),
  'Voice hash functions are immutable invokers with an empty search path'
);

SELECT public.tracker_voice_test_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.oid IN (
      'public._tracker_voice_canonical_json_v2(jsonb)'::regprocedure,
      'public._tracker_voice_sha256_jsonb_v2(jsonb)'::regprocedure,
      'public._tracker_voice_request_hash(jsonb)'::regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND (
        acl.grantee = 0
        OR acl.grantee IN (
          'anon'::regrole,
          'authenticated'::regrole,
          'service_role'::regrole
        )
      )
  ),
  'Voice hash functions are not directly executable by client or Edge roles'
);

SELECT public.tracker_voice_test_assert(
  position('_tracker_voice_sha256_jsonb_v2' IN pg_get_functiondef(
    'public._tracker_voice_request_hash(jsonb)'::regprocedure
  )) > 0
  AND position('_tracker_unified_ops_request_hash_v2' IN pg_get_functiondef(
    'public._tracker_voice_request_hash(jsonb)'::regprocedure
  )) = 0,
  'Voice hash entrypoint is decoupled from Unified Ops'
);

-- Fifty old-valid camelCase payloads must remain byte-identical to Series.
WITH vectors AS (
  SELECT n, jsonb_build_object(
    'vectorId', n,
    'nullableValue', CASE WHEN n % 5 = 0 THEN 'null'::JSONB ELSE to_jsonb(n) END,
    'booleanValue', to_jsonb(n % 2 = 0),
    'unicodeValue', to_jsonb('Tiếng Việt ' || n),
    'nestedObject', jsonb_build_object(
      'safeInteger', n * 1000,
      'label', 'player ' || n
    ),
    'orderedArray', jsonb_build_array(
      n,
      n + 1,
      jsonb_build_object('innerKey', 'value' || n)
    )
  ) AS payload
  FROM generate_series(1, 50) AS n
)
SELECT public.tracker_voice_test_assert(
  count(*) = 50
  AND bool_and(
    public._series_sha256_jsonb_v1(payload)
      = public._tracker_voice_request_hash(payload)
  ),
  'all 50 old-valid camelCase hashes remain byte-identical'
)
FROM vectors;

-- Fifty representative snake_case payloads exercise the current Voice keys.
WITH vectors AS (
  SELECT n, jsonb_build_object(
    'tournament_id', '85000000-0000-4000-8000-000000000001',
    'tournament_table_id', '84000000-0000-4000-8000-000000000001',
    'physical_table_id', '83000000-0000-4000-8000-000000000001',
    'hand_id', '86000000-0000-4000-8000-000000000001',
    'dealer_id', '87000000-0000-4000-8000-000000000001',
    'assignment_id', '88000000-0000-4000-8000-000000000001',
    'actor_user_id', '81200000-0000-4000-8000-000000000001',
    'actor_player_id', '82000000-0000-4000-8000-000000000001',
    'root_event_id', '89000000-0000-4000-8000-000000000001',
    'provider_name', 'gemini_live',
    'provider_model', 'gemini-3.5-transcribe-live',
    'provider_event_id', 'provider-' || n,
    'provider_confidence', CASE WHEN n % 2 = 0 THEN to_jsonb(n) ELSE 'null'::JSONB END,
    'state_version', repeat('a', 64),
    'execution_mode', 'assist',
    'execution_result', 'validated',
    'validation_mode', 'enforce',
    'turn_order_enforced', true,
    'capability_version', 'tracker-voice-assist-v0',
    'idempotency_key', 'voice-hash-vector-' || n,
    'request_hash', repeat('b', 64),
    'trace_id', 'trace-' || n,
    'community_cards', jsonb_build_array('Ah', 'Ks', 'Qd'),
    'settlement_digest', repeat('c', 64),
    'action_order', n,
    'action_amount', n * 1000,
    'canonical_action', 'raise_to'
  ) AS payload
  FROM generate_series(1, 50) AS n
)
SELECT public.tracker_voice_test_assert(
  count(*) = 50
  AND bool_and(public._tracker_voice_request_hash(payload) ~ '^[0-9a-f]{64}$'),
  'all 50 Voice snake_case vectors produce deterministic SHA-256 values'
)
FROM vectors;

SELECT public.tracker_voice_test_assert(
  public._tracker_voice_request_hash('{"a_key":1,"z_key":2}'::JSONB)
    = public._tracker_voice_request_hash('{"z_key":2,"a_key":1}'::JSONB)
  AND public._tracker_voice_request_hash('{"state_version":"a"}'::JSONB)
    <> public._tracker_voice_request_hash('{"state_version":"b"}'::JSONB)
  AND public._tracker_voice_request_hash('{"stateVersion":"x"}'::JSONB)
    <> public._tracker_voice_request_hash('{"state_version":"x"}'::JSONB),
  'Voice hashes ignore object insertion order but preserve value and key-style distinctions'
);

DO $invalid_keys$
DECLARE
  v_key TEXT;
  v_message TEXT;
BEGIN
  FOREACH v_key IN ARRAY ARRAY[
    '_state',
    'state_',
    'state__version',
    'state-version',
    'state.version',
    'state version',
    'state/version',
    'trạng_thái'
  ]
  LOOP
    BEGIN
      PERFORM public._tracker_voice_request_hash(jsonb_build_object(v_key, 'x'));
      RAISE EXCEPTION 'expected invalid Voice key rejection: %', v_key;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      IF v_message <> 'tracker_voice_canonical_json_invalid_machine_key' THEN
        RAISE;
      END IF;
    END;
  END LOOP;
END;
$invalid_keys$;

DO $strict_regressions$
DECLARE
  v_message TEXT;
BEGIN
  BEGIN
    PERFORM public._series_sha256_jsonb_v1('{"state_version":"abc"}'::JSONB);
    RAISE EXCEPTION 'Series unexpectedly accepted snake_case';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'series_canonical_json_invalid_machine_key' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public._tracker_voice_request_hash('{"unsafe_number":9007199254740992}'::JSONB);
    RAISE EXCEPTION 'Voice unexpectedly accepted an unsafe integer';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'tracker_voice_canonical_json_invalid_safe_integer' THEN
      RAISE;
    END IF;
  END;
END;
$strict_regressions$;

SELECT public.tracker_voice_test_assert(
  length(public._tracker_voice_request_hash(jsonb_build_object(
    'tournament_id', '85000000-0000-4000-8000-000000000001',
    'hand_id', '86000000-0000-4000-8000-000000000001',
    'canonical_action', 'raise_to',
    'action_order', 3,
    'action_amount', 120000
  ))) = 64,
  'Action request hash accepts its current Voice contract'
);
SELECT public.tracker_voice_test_assert(
  length(public._tracker_voice_request_hash(jsonb_build_object(
    'root_event_id', '89000000-0000-4000-8000-000000000001',
    'community_cards', jsonb_build_array('Ah', 'Ks', 'Qd'),
    'state_version', repeat('a', 64)
  ))) = 64,
  'Board request hash accepts its current Voice contract'
);
SELECT public.tracker_voice_test_assert(
  length(public._tracker_voice_request_hash(jsonb_build_object(
    'root_event_id', '89000000-0000-4000-8000-000000000001',
    'seat_number', 1,
    'redacted', true,
    'state_version', repeat('a', 64)
  ))) = 64,
  'Hole Cards request hash accepts its current Voice contract'
);
SELECT public.tracker_voice_test_assert(
  length(public._tracker_voice_request_hash(jsonb_build_object(
    'root_event_id', '89000000-0000-4000-8000-000000000001',
    'settlement_digest', repeat('b', 64),
    'state_version', repeat('a', 64)
  ))) = 64,
  'Finish request hash accepts its current Voice contract'
);

SELECT 'TRACKER_VOICE_HASH_V2_GREEN_PROOF_PASS' AS result;
