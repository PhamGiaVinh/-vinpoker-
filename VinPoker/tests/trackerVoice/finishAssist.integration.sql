\set ON_ERROR_STOP on

-- Runs after the Voice action, Board and Hole Cards disposable suites. It uses
-- only synthetic rows and proves one touch-confirmed Finish transaction.
-- This setup needs two persisted runout streets. The Board Assist suite already
-- proves the authenticated Dealer path; use the disposable owner only to seed
-- the exact canonical manual writer without inventing a second test assignment.
SET ROLE postgres;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.update_community_cards(
  '86000000-0000-4000-8000-000000000001',
  '["Ah", "5s", "2d", "Jc"]'::JSONB,
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset finish_turn_
SELECT public.update_community_cards(
  '86000000-0000-4000-8000-000000000001',
  '["Ah", "5s", "2d", "Jc", "9d"]'::JSONB,
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset finish_river_
RESET ROLE;

SELECT public.tracker_voice_test_assert(
  :'finish_turn_payload'::JSONB->>'status' = 'success'
  AND :'finish_river_payload'::JSONB->>'status' = 'success',
  'synthetic all-in runout reaches a persisted river through the canonical Board writer'
);

-- record_hand verifies the live seat, entry and chip projections against the
-- immutable hand snapshot. Seed that canonical projection for this synthetic
-- hand; browser/Voice payloads never create or select these rows.
INSERT INTO public.tournament_entries(
  id, tournament_id, player_id, entry_no, status, current_stack, table_id, seat_id, seat_number
) VALUES
  ('82100000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 1, 'seated', 30000, '83000000-0000-4000-8000-000000000001', '82200000-0000-4000-8000-000000000001', 1),
  ('82100000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 1, 'seated', 30000, '83000000-0000-4000-8000-000000000001', '82200000-0000-4000-8000-000000000002', 2);
INSERT INTO public.tournament_seats(
  id, tournament_id, player_id, entry_number, table_id, seat_number,
  chip_count, is_active, entry_id, status, player_name
) VALUES
  ('82200000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 1, '84000000-0000-4000-8000-000000000001', 1, 30000, true, '82100000-0000-4000-8000-000000000001', 'active', 'Player A'),
  ('82200000-0000-4000-8000-000000000002', '85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 1, '84000000-0000-4000-8000-000000000001', 2, 30000, true, '82100000-0000-4000-8000-000000000002', 'active', 'Player B');
INSERT INTO public.tournament_chip_counts(tournament_id, player_id, entry_number, chip_count) VALUES
  ('85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 1, 30000),
  ('85000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 1, 30000);

SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset finish_state_
SELECT jsonb_build_object(
  'hand_number', 1,
  'hand_time', (SELECT created_at FROM public.tournament_hands WHERE id = '86000000-0000-4000-8000-000000000001'),
  'players', jsonb_build_array(
    jsonb_build_object('player_id', '82000000-0000-4000-8000-000000000001', 'entry_number', 1, 'seat_number', 1, 'starting_stack', 30000, 'ending_stack', 60000, 'is_eliminated', false, 'side_pots', '[]'::JSONB, 'hole_cards', '["Kh", "Ks"]'::JSONB),
    jsonb_build_object('player_id', '82000000-0000-4000-8000-000000000002', 'entry_number', 1, 'seat_number', 2, 'starting_stack', 30000, 'ending_stack', 0, 'is_eliminated', true, 'side_pots', '[]'::JSONB, 'hole_cards', '["Qh", "Qs"]'::JSONB)
  ),
  'actions', (SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', player_id, 'entry_number', entry_number, 'street', COALESCE(street, 'preflop'), 'action_type', action_type, 'action_amount', COALESCE(action_amount, 0), 'action_order', action_order) ORDER BY action_order, id), '[]'::JSONB) FROM public.hand_actions WHERE hand_id = '86000000-0000-4000-8000-000000000001'),
  'side_pots', jsonb_build_array(jsonb_build_object('amount', 60000, 'eligible_player_ids', jsonb_build_array('82000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002'))),
  'community_cards', '["Ah", "5s", "2d", "Jc", "9d"]'::JSONB,
  'pot_size', 60000
) AS value \gset finish_record_payload_

-- A bad digest cannot finish the hand or append a Voice event.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public.commit_tracker_voice_finish_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'finish-provider-stale',
  'kết thúc hand', :'finish_state_value', 'voice-finish-stale-0001', 'trace-finish-stale-0001',
  'engine_showdown', repeat('0', 64),
  '{}'::JSONB
)::TEXT AS payload \gset finish_stale_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'finish_stale_payload'::JSONB->>'error' = 'finish_payload_mismatch'
  AND (SELECT status = 'in_progress' FROM public.tournament_hands WHERE id = '86000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.tracker_voice_events WHERE idempotency_key = 'voice-finish-stale-0001'),
  'a malformed or stale Finish proposal is zero-write'
);

-- A receipt failure after record_hand must roll every hand mutation back.
CREATE OR REPLACE FUNCTION public.tracker_voice_finish_root_fail()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_kind = 'final_transcript' AND NEW.idempotency_key = 'voice-finish-fail-0001' THEN
    RAISE EXCEPTION 'TRACKER_VOICE_FINISH_ROOT_INJECTED_FAILURE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tracker_voice_finish_root_fail BEFORE INSERT ON public.tracker_voice_events
  FOR EACH ROW EXECUTE FUNCTION public.tracker_voice_finish_root_fail();
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT set_config('tracker_voice.finish_state', :'finish_state_value', false);
SELECT set_config('tracker_voice.finish_record_payload', :'finish_record_payload_value', false);
DO $$
DECLARE
  v_result JSONB;
BEGIN
  BEGIN
    v_result := public.commit_tracker_voice_finish_v0(
      '81200000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000001',
      'gemini_live', 'gemini-3.5-transcribe-live', 'finish-provider-fail',
      'kết thúc hand', current_setting('tracker_voice.finish_state'), 'voice-finish-fail-0001', 'trace-finish-fail-0001',
      'engine_showdown', repeat('1', 64),
      current_setting('tracker_voice.finish_record_payload')::JSONB
    );
    IF COALESCE((v_result->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'unexpected_finish_result:%', v_result;
    END IF;
    RAISE EXCEPTION 'expected injected Finish root failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TRACKER_VOICE_FINISH_ROOT_INJECTED_FAILURE' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;
DROP TRIGGER trg_tracker_voice_finish_root_fail ON public.tracker_voice_events;
DROP FUNCTION public.tracker_voice_finish_root_fail();
SELECT public.tracker_voice_test_assert(
  (SELECT status = 'in_progress' FROM public.tournament_hands WHERE id = '86000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.tracker_voice_events WHERE idempotency_key = 'voice-finish-fail-0001'),
  'injected Voice receipt failure rolls back record_hand and the event stream together'
);

-- The valid touch-confirm finishes exactly once; retry returns its receipt.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public.commit_tracker_voice_finish_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'finish-provider-success',
  'kết thúc hand', :'finish_state_value', 'voice-finish-success-0001', 'trace-finish-success-0001',
  'engine_showdown', repeat('2', 64),
  :'finish_record_payload_value'::JSONB
)::TEXT AS payload \gset finish_success_
SELECT public.commit_tracker_voice_finish_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'finish-provider-success',
  'kết thúc hand', :'finish_state_value', 'voice-finish-success-0001', 'trace-finish-success-retry',
  'engine_showdown', repeat('2', 64),
  :'finish_record_payload_value'::JSONB
)::TEXT AS payload \gset finish_retry_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'finish_success_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'finish_retry_payload'::JSONB->>'duplicate')::BOOLEAN
  AND (SELECT status = 'completed' FROM public.tournament_hands WHERE id = '86000000-0000-4000-8000-000000000001')
  AND (SELECT count(*) = 1 FROM public.tracker_voice_events WHERE idempotency_key = 'voice-finish-success-0001' AND event_kind = 'final_transcript')
  AND (SELECT count(*) = 1 FROM public.tracker_voice_events WHERE root_event_id = (:'finish_success_payload'::JSONB->>'voice_event_id')::UUID AND event_kind = 'canonical_receipt'),
  'one Voice Finish confirmation completes one hand and returns one receipt on retry'
);

SELECT public.tracker_voice_test_assert(
  NOT has_function_privilege('anon', 'public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.commit_tracker_voice_finish_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb)', 'EXECUTE'),
  'private Voice Finish transaction is service-only'
);

SELECT 'TRACKER_VOICE_FINISH_ASSIST_DISPOSABLE_DB_PASS' AS result;
