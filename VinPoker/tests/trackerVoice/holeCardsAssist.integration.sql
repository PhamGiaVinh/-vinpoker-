\set ON_ERROR_STOP on

-- Runs after the action and Board disposable suites. It converts the synthetic
-- hand to a genuine two-player all-in runout without touching any live data.
INSERT INTO public.hand_actions(hand_id, player_id, entry_number, street, action_type, action_amount, action_order)
VALUES
  ('86000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 1, 'preflop', 'all_in', 29900, 2),
  ('86000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 1, 'preflop', 'all_in', 30000, 3);

SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset hole_state_initial_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public.commit_tracker_voice_hole_cards_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'hole-provider-seat-one',
  :'hole_state_initial_value', 'voice-hole-seat-one-0001', 'trace-hole-seat-one-0001',
  1, '["Kh", "Ks"]'::JSONB
)::TEXT AS payload \gset hole_commit_one_
SELECT public.commit_tracker_voice_hole_cards_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'hole-provider-seat-one',
  :'hole_state_initial_value', 'voice-hole-seat-one-0001', 'trace-hole-seat-one-retry',
  1, '["Kh", "Ks"]'::JSONB
)::TEXT AS payload \gset hole_commit_one_retry_
RESET ROLE;

SELECT public.tracker_voice_test_assert(
  (:'hole_commit_one_payload'::JSONB->>'ok')::BOOLEAN
  AND (:'hole_commit_one_retry_payload'::JSONB->>'duplicate')::BOOLEAN
  AND (SELECT hole_cards = '["Kh", "Ks"]'::JSONB FROM public.hand_players
       WHERE hand_id = '86000000-0000-4000-8000-000000000001' AND seat_number = 1)
  AND (SELECT count(*) = 1 FROM public.tracker_voice_events
       WHERE event_kind = 'final_transcript' AND idempotency_key = 'voice-hole-seat-one-0001')
  AND (SELECT count(*) = 1 FROM public.tracker_voice_events
       WHERE event_kind = 'canonical_receipt'
         AND root_event_id = (:'hole_commit_one_payload'::JSONB->>'voice_event_id')::UUID),
  'one exact Voice seat mutation has one redacted root and one canonical receipt'
);
SELECT public.tracker_voice_test_assert(
  NOT EXISTS (
    SELECT 1 FROM public.tracker_voice_events
    WHERE id = (:'hole_commit_one_payload'::JSONB->>'voice_event_id')::UUID
      AND (final_transcript <> 'Seat 1 [HOLE_CARDS_REDACTED]'
        OR normalized_command::TEXT ~ 'Kh|Ks|ace|king|hearts|spades')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE payload::TEXT ILIKE '%Seat 1 ace hearts king spades%'
  ),
  'raw private sentence and card codes stay out of the Voice and audit streams'
);

-- Different payload with the original idempotency key cannot overwrite Seat 1.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public.commit_tracker_voice_hole_cards_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'hole-provider-seat-one-mismatch',
  :'hole_state_initial_value', 'voice-hole-seat-one-0001', 'trace-hole-seat-one-mismatch',
  1, '["Qh", "Qs"]'::JSONB
)::TEXT AS payload \gset hole_mismatch_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'hole_mismatch_payload'::JSONB->>'error' = 'idempotency_mismatch'
  AND (SELECT hole_cards = '["Kh", "Ks"]'::JSONB FROM public.hand_players
       WHERE hand_id = '86000000-0000-4000-8000-000000000001' AND seat_number = 1),
  'same idempotency key with different private cards fails closed'
);

-- A failure after the shared core's UPDATE must roll back the exact card write,
-- root, and receipt as a single transaction.
SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset hole_state_second_
CREATE OR REPLACE FUNCTION public.tracker_voice_hole_root_fail()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_kind = 'final_transcript' AND NEW.idempotency_key = 'voice-hole-seat-two-fail-0001' THEN
    RAISE EXCEPTION 'TRACKER_VOICE_HOLE_ROOT_INJECTED_FAILURE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_tracker_voice_hole_root_fail BEFORE INSERT ON public.tracker_voice_events
  FOR EACH ROW EXECUTE FUNCTION public.tracker_voice_hole_root_fail();
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT set_config('tracker_voice.hole_state_second', :'hole_state_second_value', false);
DO $$
BEGIN
  BEGIN
    PERFORM public.commit_tracker_voice_hole_cards_v0(
      '81200000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '84000000-0000-4000-8000-000000000001',
      '86000000-0000-4000-8000-000000000001',
      'gemini_live', 'gemini-3.5-transcribe-live', 'hole-provider-seat-two-fail',
      current_setting('tracker_voice.hole_state_second'), 'voice-hole-seat-two-fail-0001', 'trace-hole-seat-two-fail-0001',
      2, '["Qh", "Qs"]'::JSONB
    );
    RAISE EXCEPTION 'expected injected Hole Cards root failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TRACKER_VOICE_HOLE_ROOT_INJECTED_FAILURE' THEN RAISE; END IF;
  END;
END;
$$;
RESET ROLE;
DROP TRIGGER trg_tracker_voice_hole_root_fail ON public.tracker_voice_events;
DROP FUNCTION public.tracker_voice_hole_root_fail();
SELECT public.tracker_voice_test_assert(
  (SELECT hole_cards = '[]'::JSONB FROM public.hand_players
   WHERE hand_id = '86000000-0000-4000-8000-000000000001' AND seat_number = 2)
  AND NOT EXISTS (SELECT 1 FROM public.tracker_voice_events WHERE idempotency_key = 'voice-hole-seat-two-fail-0001'),
  'injected redaction/root failure leaves zero partial canonical cards or Voice events'
);

-- Manual one-seat input calls the same core and cannot clear the confirmed
-- Voice seat. This proves the original public ABI retains additive semantics.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '81200000-0000-4000-8000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"authenticated"}', false);
SELECT public.show_hole_cards(
  '86000000-0000-4000-8000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'player_id', '82000000-0000-4000-8000-000000000002',
    'entry_number', 1,
    'hole_cards', jsonb_build_array('Qh', 'Qs')
  )),
  '81200000-0000-4000-8000-000000000001'
)::TEXT AS payload \gset manual_second_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  (:'manual_second_payload'::JSONB->>'status') = 'success'
  AND (SELECT hole_cards = '["Kh", "Ks"]'::JSONB FROM public.hand_players
       WHERE hand_id = '86000000-0000-4000-8000-000000000001' AND seat_number = 1)
  AND (SELECT hole_cards = '["Qh", "Qs"]'::JSONB FROM public.hand_players
       WHERE hand_id = '86000000-0000-4000-8000-000000000001' AND seat_number = 2),
  'manual exact one-seat entry shares the core without clearing another confirmed seat'
);

-- Existing cards are immutable to new Voice keys: duplicate same cards gets no
-- new event; changed cards must go to the manual correction flow.
SELECT public._tracker_voice_hand_state_version('86000000-0000-4000-8000-000000000001') AS value \gset hole_state_final_
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"sub":"81200000-0000-4000-8000-000000000001","role":"service_role"}', false);
SELECT public.commit_tracker_voice_hole_cards_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'hole-provider-seat-one-same',
  :'hole_state_final_value', 'voice-hole-seat-one-same-0001', 'trace-hole-seat-one-same-0001',
  1, '["Kh", "Ks"]'::JSONB
)::TEXT AS payload \gset hole_same_cards_
SELECT public.commit_tracker_voice_hole_cards_v0(
  '81200000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'gemini_live', 'gemini-3.5-transcribe-live', 'hole-provider-seat-one-change',
  :'hole_state_final_value', 'voice-hole-seat-one-change-0001', 'trace-hole-seat-one-change-0001',
  1, '["Jh", "Js"]'::JSONB
)::TEXT AS payload \gset hole_changed_cards_
RESET ROLE;
SELECT public.tracker_voice_test_assert(
  :'hole_same_cards_payload'::JSONB->>'error' = 'hole_cards_already_persisted'
  AND :'hole_changed_cards_payload'::JSONB->>'error' = 'voice_hole_card_correction_required'
  AND NOT EXISTS (SELECT 1 FROM public.tracker_voice_events WHERE idempotency_key IN (
    'voice-hole-seat-one-same-0001', 'voice-hole-seat-one-change-0001'
  )),
  'a new Voice key cannot overwrite or append audit events for existing cards'
);

SELECT public.tracker_voice_test_assert(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.oid = 'public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)'::regprocedure
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
  AND NOT has_function_privilege('anon', 'public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)', 'EXECUTE'),
  'private Voice Hole Cards transaction is service-only'
);

SELECT 'TRACKER_VOICE_HOLE_CARDS_ASSIST_DISPOSABLE_DB_PASS' AS result;
