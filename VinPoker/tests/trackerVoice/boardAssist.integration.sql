\set ON_ERROR_STOP on

-- Runs after disposableDb.integration.sql on the exact 080 -> 12003 -> 12008
-- -> 13000007 -> 13000009 chain. All IDs/data are synthetic.
UPDATE public.tracker_voice_configs
SET enabled = true, configured_mode = 'assist', provider_model = 'gemini-3.5-transcribe-live',
    correction_state = 'ready'
WHERE tournament_id = '85000000-0000-4000-8000-000000000001'
  AND tournament_table_id = '84000000-0000-4000-8000-000000000001';

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.heartbeat_lock(
  '86000000-0000-4000-8000-000000000001',
  '81200000-0000-4000-8000-000000000001'
);
RESET ROLE;

SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset board_state_zero_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_board_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'board-flop-provider-1',
  'Flop Át cơ, năm bích, hai rô',
  jsonb_build_object(
    'kind', 'board', 'intent_domain', 'board',
    'canonical_request', jsonb_build_object(
      'intentDomain', 'board',
      'envelope', jsonb_build_object('expectedStateVersion', :'board_state_zero_value', 'expectedWorkflowState', 'enter_flop', 'expectedStreet', 'flop', 'payloadHash', repeat('a', 64), 'rawTranscriptHash', repeat('b', 64)),
      'payload', jsonb_build_object('street', 'flop', 'newCards', jsonb_build_array('Ah', '5s', '2d'), 'cumulativeCards', jsonb_build_array('Ah', '5s', '2d'), 'expectedExistingBoardCount', 0)
    )
  ),
  :'board_state_zero_value', 'assist', 'voice-board-flop-0001', 'trace-board-flop-0001'
)::TEXT AS payload \gset board_root_flop_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'board_root_flop_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'board_root_flop_payload'::JSONB->>'execution_result') = 'validated',
  'Board root final transcript is immutable evidence only before Dealer touch confirmation'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.commit_tracker_voice_board_v0(
  (:'board_root_flop_payload'::JSONB->>'voice_event_id')::UUID,
  'voice-board-flop-0001', 'trace-board-flop-0001'
)::TEXT AS payload \gset board_flop_commit_
SELECT public.commit_tracker_voice_board_v0(
  (:'board_root_flop_payload'::JSONB->>'voice_event_id')::UUID,
  'voice-board-flop-0001', 'trace-board-flop-retry'
)::TEXT AS payload \gset board_flop_retry_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'board_flop_commit_payload'::JSONB->>'ok')::BOOLEAN
  AND :'board_flop_commit_payload'::JSONB->'community_cards' = '["Ah", "5s", "2d"]'::JSONB
  AND (:'board_flop_retry_payload'::JSONB->>'duplicate')::BOOLEAN
  AND (SELECT count(*) = 1 FROM public.tracker_voice_events WHERE root_event_id = (:'board_root_flop_payload'::JSONB->>'voice_event_id')::UUID),
  'same Board idempotency key returns one canonical receipt and exactly one mutation'
);

-- A root proposal made against the old state cannot overwrite the persisted flop.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_board_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'board-stale-provider-1', 'Flop Át cơ, năm bích, hai rô',
  jsonb_build_object('kind', 'board', 'intent_domain', 'board', 'canonical_request', jsonb_build_object(
    'intentDomain', 'board', 'envelope', jsonb_build_object('expectedStateVersion', :'board_state_zero_value', 'expectedWorkflowState', 'enter_flop', 'expectedStreet', 'flop', 'payloadHash', repeat('c', 64), 'rawTranscriptHash', repeat('d', 64)),
    'payload', jsonb_build_object('street', 'flop', 'newCards', jsonb_build_array('Ah', '5s', '2d'), 'cumulativeCards', jsonb_build_array('Ah', '5s', '2d'), 'expectedExistingBoardCount', 0)
  )),
  :'board_state_zero_value', 'assist', 'voice-board-stale-0001', 'trace-board-stale-0001'
)::TEXT AS payload \gset board_stale_root_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'board_stale_root_payload'::JSONB->>'error' = 'stale_state_version'
  AND (SELECT community_cards = '["Ah", "5s", "2d"]'::JSONB FROM public.tournament_hands WHERE id = '86000000-0000-4000-8000-000000000001'),
  'stale/conflicting Voice Board root is zero-write and cannot overwrite a persisted street'
);

-- Inject a receipt insert failure: Board update and child receipt must both roll back.
SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset board_state_flop_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public._tracker_voice_register_validated_board_event(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'board-turn-provider-1', 'Turn đầm tép',
  jsonb_build_object('kind', 'board', 'intent_domain', 'board', 'canonical_request', jsonb_build_object(
    'intentDomain', 'board', 'envelope', jsonb_build_object('expectedStateVersion', :'board_state_flop_value', 'expectedWorkflowState', 'enter_turn', 'expectedStreet', 'turn', 'payloadHash', repeat('e', 64), 'rawTranscriptHash', repeat('f', 64)),
    'payload', jsonb_build_object('street', 'turn', 'newCards', jsonb_build_array('Qc'), 'cumulativeCards', jsonb_build_array('Ah', '5s', '2d', 'Qc'), 'expectedExistingBoardCount', 3)
  )),
  :'board_state_flop_value', 'assist', 'voice-board-turn-0001', 'trace-board-turn-0001'
)::TEXT AS payload \gset board_root_turn_
RESET ROLE;

CREATE OR REPLACE FUNCTION public.tracker_voice_board_receipt_fail()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_kind = 'canonical_receipt'
     AND NEW.root_event_id = current_setting('tracker_voice.board_root')::UUID THEN
    RAISE EXCEPTION 'TRACKER_VOICE_BOARD_RECEIPT_INJECTED_FAILURE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tracker_voice_board_receipt_fail BEFORE INSERT ON public.tracker_voice_events
  FOR EACH ROW EXECUTE FUNCTION public.tracker_voice_board_receipt_fail();
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT set_config('tracker_voice.board_root', (:'board_root_turn_payload'::JSONB->>'voice_event_id'), false);
SELECT set_config('tracker_voice.board_key', 'voice-board-turn-0001', false);
SELECT set_config('tracker_voice.board_trace', 'trace-board-turn-0001', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.commit_tracker_voice_board_v0(
      current_setting('tracker_voice.board_root')::UUID,
      current_setting('tracker_voice.board_key'), current_setting('tracker_voice.board_trace')
    );
    RAISE EXCEPTION 'expected injected Board receipt failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TRACKER_VOICE_BOARD_RECEIPT_INJECTED_FAILURE' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;
DROP TRIGGER trg_tracker_voice_board_receipt_fail ON public.tracker_voice_events;
DROP FUNCTION public.tracker_voice_board_receipt_fail();
SELECT public.tracker_voice_test_assert(
  (SELECT community_cards = '["Ah", "5s", "2d"]'::JSONB FROM public.tournament_hands WHERE id = '86000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.tracker_voice_events WHERE root_event_id = (:'board_root_turn_payload'::JSONB->>'voice_event_id')::UUID),
  'injected receipt failure leaves zero partial Board mutation or canonical receipt'
);

SELECT 'TRACKER_VOICE_BOARD_ASSIST_DISPOSABLE_DB_PASS' AS result;
