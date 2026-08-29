-- Source-only forward migration. This remains pending until a separately
-- approved Tracker Voice Assist rollout. It never enables Voice by itself.
BEGIN;

-- Preserve the manual writer ABI and its SECURITY INVOKER P0 contract. An
-- assigned Dealer is accepted only when the reviewed SECURITY DEFINER Voice
-- commit wrapper invokes this same canonical writer.
CREATE OR REPLACE FUNCTION public.update_community_cards(
  p_hand_id UUID,
  p_community_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
  v_validation TEXT;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'unauthenticated'); END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN RETURN jsonb_build_object('error', 'actor_mismatch'); END IF;

  SELECT h.status, h.locked_by_user_id, h.locked_at, h.tournament_id, h.table_id, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Hand not found'); END IF;
  IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
    IF current_user <> pg_get_userbyid((
      SELECT p.proowner
      FROM pg_proc p
      WHERE p.oid = 'public.update_community_cards(uuid,jsonb,uuid)'::regprocedure
    )) OR NOT EXISTS (
      SELECT 1
      FROM public.dealers d
      JOIN public.dealer_assignments da ON da.dealer_id = d.id
      JOIN public.tournament_tables tt ON tt.table_id = da.table_id
      WHERE d.user_id = v_actor
        AND d.club_id = v_hand.club_id
        AND da.status = 'assigned'
        AND da.released_at IS NULL
        AND tt.id = v_hand.table_id
        AND tt.tournament_id = v_hand.tournament_id
    ) THEN
      RETURN jsonb_build_object('error', 'actor_not_allowed');
    END IF;
  END IF;
  IF v_hand.status <> 'in_progress' THEN RETURN jsonb_build_object('error', 'Hand is not in progress', 'status', v_hand.status); END IF;
  IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NULL THEN RETURN jsonb_build_object('error', 'tracker_lock_required'); END IF;
  IF v_hand.locked_by_user_id IS NULL OR v_hand.locked_at IS NULL THEN RETURN jsonb_build_object('error', 'tracker_lock_ambiguous'); END IF;
  IF v_hand.locked_at <= now() - public.tracker_lock_ttl() THEN RETURN jsonb_build_object('error', 'tracker_lock_expired'); END IF;
  IF v_hand.locked_by_user_id <> v_actor THEN RETURN jsonb_build_object('error', 'tracker_lock_owned_by_another', 'locked_by', v_hand.locked_by_user_id); END IF;
  v_validation := public.validate_cards(p_community_cards);
  IF v_validation != 'ok' THEN RETURN jsonb_build_object('error', v_validation); END IF;
  IF jsonb_array_length(p_community_cards) NOT IN (0, 3, 4, 5) THEN
    RETURN jsonb_build_object('error', 'Invalid number of community cards', 'count', jsonb_array_length(p_community_cards));
  END IF;
  UPDATE public.tournament_hands
  SET community_cards = p_community_cards, updated_at = NOW(), locked_at = NOW()
  WHERE id = p_hand_id;
  RETURN jsonb_build_object('status', 'success');
END;
$function$;

REVOKE ALL ON FUNCTION public.update_community_cards(UUID, JSONB, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_community_cards(UUID, JSONB, UUID) TO authenticated;

-- Edge alone may append an immutable Board final-transcript root. Browser
-- fields are re-derived by the Edge before this function is reached.
CREATE OR REPLACE FUNCTION public._tracker_voice_register_validated_board_event(
  p_actor_user_id UUID,
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_hand_id UUID,
  p_provider_name TEXT,
  p_provider_model TEXT,
  p_provider_event_id TEXT,
  p_final_transcript TEXT,
  p_normalized_command JSONB,
  p_expected_state_version TEXT,
  p_execution_mode TEXT,
  p_idempotency_key TEXT,
  p_trace_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := p_actor_user_id;
  v_assignment JSONB;
  v_config RECORD;
  v_hand RECORD;
  v_state_version TEXT;
  v_request_hash TEXT;
  v_existing RECORD;
  v_event_id UUID := gen_random_uuid();
  v_receipt JSONB;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;
  IF v_actor IS NULL OR p_final_transcript IS NULL OR char_length(p_final_transcript) NOT BETWEEN 1 AND 500
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'
     OR p_trace_id IS NULL OR char_length(p_trace_id) NOT BETWEEN 8 AND 255
     OR p_expected_state_version !~ '^[0-9a-f]{64}$'
     OR p_execution_mode NOT IN ('shadow', 'assist') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_request');
  END IF;
  IF jsonb_typeof(p_normalized_command) <> 'object'
     OR p_normalized_command->>'kind' <> 'board'
     OR p_normalized_command->>'intent_domain' <> 'board'
     OR jsonb_typeof(p_normalized_command->'canonical_request') <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_command');
  END IF;

  v_request_hash := public._tracker_voice_request_hash(jsonb_build_object(
    'tournament_id', p_tournament_id, 'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id, 'provider_name', p_provider_name, 'provider_model', p_provider_model,
    'provider_event_id', p_provider_event_id, 'final_transcript', p_final_transcript,
    'normalized_command', p_normalized_command, 'state_version', p_expected_state_version,
    'execution_mode', p_execution_mode
  ));
  SELECT * INTO v_existing FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript';
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch'); END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  v_assignment := public._tracker_voice_assignment_context(p_tournament_id, p_tournament_table_id, v_actor);
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN RETURN v_assignment; END IF;
  SELECT * INTO v_config FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id AND c.tournament_table_id = p_tournament_table_id FOR UPDATE;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'error', 'voice_not_enabled'); END IF;
  IF v_config.physical_table_id <> (v_assignment->>'physical_table_id')::UUID
     OR v_config.club_id <> (v_assignment->>'club_id')::UUID THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_config_scope_mismatch');
  END IF;
  IF v_config.provider_model IN ('gemini-3.1-flash-live-preview', 'gemini-3.5-transcribe-live') THEN
    IF p_provider_name <> 'gemini_live' OR p_provider_model <> v_config.provider_model THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
    END IF;
  ELSIF p_provider_name <> 'openai_realtime' OR p_provider_model <> v_config.provider_model THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
  IF p_execution_mode = 'assist' AND v_config.configured_mode = 'shadow' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assist_not_allowed');
  END IF;
  IF v_config.correction_state = 'correction_pending' THEN RETURN jsonb_build_object('ok', false, 'error', 'correction_pending'); END IF;
  SELECT h.* INTO v_hand FROM public.tournament_hands h
  WHERE h.id = p_hand_id AND h.tournament_id = p_tournament_id AND h.table_id = p_tournament_table_id FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_in_progress');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN RETURN jsonb_build_object('ok', false, 'error', 'lock_lost'); END IF;
  v_state_version := public._tracker_voice_hand_state_version(p_hand_id);
  IF v_state_version <> p_expected_state_version THEN RETURN jsonb_build_object('ok', false, 'error', 'stale_state_version', 'state_version', v_state_version); END IF;

  v_receipt := jsonb_build_object('ok', true, 'voice_event_id', v_event_id,
    'idempotency_key', p_idempotency_key, 'trace_id', p_trace_id, 'state_version', v_state_version,
    'execution_mode', p_execution_mode, 'execution_result', 'validated', 'correction_pending', false);
  INSERT INTO public.tracker_voice_events (
    id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id, dealer_id, assignment_id,
    actor_user_id, event_kind, provider_name, provider_model, provider_event_id, final_transcript,
    normalized_command, state_version, execution_mode, execution_result, validation_mode, turn_order_enforced,
    idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_event_id, (v_assignment->>'club_id')::UUID, p_tournament_id, p_tournament_table_id,
    (v_assignment->>'physical_table_id')::UUID, p_hand_id, (v_assignment->>'dealer_id')::UUID,
    (v_assignment->>'assignment_id')::UUID, v_actor, 'final_transcript', p_provider_name, p_provider_model,
    NULLIF(p_provider_event_id, ''), p_final_transcript, p_normalized_command, v_state_version,
    p_execution_mode, 'validated', 'enforce', true, p_idempotency_key, v_request_hash, p_trace_id, v_receipt
  );
  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_register_validated_board_event(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tracker_voice_register_validated_board_event(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- This is the only authenticated Board Assist writer. It consumes an already
-- immutable root event, calls the existing canonical manual Board writer, then appends
-- exactly one receipt in the same transaction.
CREATE OR REPLACE FUNCTION public.commit_tracker_voice_board_v0(
  p_voice_event_id UUID,
  p_idempotency_key TEXT,
  p_trace_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_root RECORD;
  v_existing_receipt RECORD;
  v_assignment JSONB;
  v_config RECORD;
  v_hand RECORD;
  v_request JSONB;
  v_payload JSONB;
  v_previous JSONB;
  v_cards JSONB;
  v_expected_count INTEGER;
  v_street TEXT;
  v_before TEXT;
  v_after TEXT;
  v_result JSONB;
  v_receipt_id UUID := gen_random_uuid();
  v_receipt JSONB;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
  IF p_idempotency_key IS NULL OR p_trace_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key'); END IF;
  SELECT * INTO v_root FROM public.tracker_voice_events e
  WHERE e.id = p_voice_event_id AND e.event_kind = 'final_transcript' AND e.actor_user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'voice_event_not_found'); END IF;
  IF v_root.idempotency_key <> p_idempotency_key OR v_root.execution_mode <> 'assist'
     OR v_root.normalized_command->>'intent_domain' <> 'board' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_event_payload_mismatch');
  END IF;
  SELECT * INTO v_existing_receipt FROM public.tracker_voice_events e
  WHERE e.root_event_id = v_root.id AND e.event_kind = 'canonical_receipt' FOR UPDATE;
  IF FOUND THEN RETURN v_existing_receipt.receipt || jsonb_build_object('duplicate', true); END IF;

  v_request := v_root.normalized_command->'canonical_request';
  v_payload := v_request->'payload';
  v_street := v_payload->>'street';
  v_cards := v_payload->'cumulativeCards';
  BEGIN v_expected_count := (v_payload->>'expectedExistingBoardCount')::INTEGER; EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_payload'); END;
  IF v_street NOT IN ('flop', 'turn', 'river') OR jsonb_typeof(v_cards) <> 'array'
     OR v_expected_count NOT IN (0, 3, 4) THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_payload'); END IF;
  IF (v_street = 'flop' AND (v_expected_count <> 0 OR jsonb_array_length(v_cards) <> 3))
     OR (v_street = 'turn' AND (v_expected_count <> 3 OR jsonb_array_length(v_cards) <> 4))
     OR (v_street = 'river' AND (v_expected_count <> 4 OR jsonb_array_length(v_cards) <> 5)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_board_payload');
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(v_root.tournament_id);
  v_assignment := public._tracker_voice_assignment_context(v_root.tournament_id, v_root.tournament_table_id, v_actor);
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN RETURN v_assignment; END IF;
  SELECT * INTO v_config FROM public.tracker_voice_configs c
  WHERE c.tournament_id = v_root.tournament_id AND c.tournament_table_id = v_root.tournament_table_id FOR UPDATE;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE OR v_config.correction_state <> 'ready' THEN RETURN jsonb_build_object('ok', false, 'error', 'voice_not_ready'); END IF;
  IF v_config.configured_mode = 'shadow' THEN RETURN jsonb_build_object('ok', false, 'error', 'assist_not_allowed'); END IF;
  IF v_config.physical_table_id <> (v_assignment->>'physical_table_id')::UUID
     OR v_config.club_id <> (v_assignment->>'club_id')::UUID THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_config_scope_mismatch');
  END IF;
  IF v_config.provider_model IN ('gemini-3.1-flash-live-preview', 'gemini-3.5-transcribe-live') THEN
    IF v_root.provider_name <> 'gemini_live' OR v_root.provider_model <> v_config.provider_model THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
    END IF;
  ELSIF v_root.provider_name <> 'openai_realtime' OR v_root.provider_model <> v_config.provider_model THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
  SELECT h.* INTO v_hand FROM public.tournament_hands h WHERE h.id = v_root.hand_id FOR UPDATE;
  IF NOT FOUND OR v_hand.tournament_id IS DISTINCT FROM v_root.tournament_id
     OR v_hand.table_id IS DISTINCT FROM v_root.tournament_table_id
     OR v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN RETURN jsonb_build_object('ok', false, 'error', 'lock_lost'); END IF;
  v_before := public._tracker_voice_hand_state_version(v_root.hand_id);
  IF v_before <> v_root.state_version THEN RETURN jsonb_build_object('ok', false, 'error', 'stale_state_version'); END IF;
  v_previous := COALESCE(v_hand.community_cards, '[]'::JSONB);
  IF jsonb_array_length(v_previous) <> v_expected_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'board_already_persisted');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_cards) AS new_card(card)
    JOIN public.hand_players hp ON hp.hand_id = v_root.hand_id
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(hp.hole_cards, '[]'::JSONB)) AS used_card(card)
    WHERE new_card.card = used_card.card
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'card_already_used_by_hole_cards');
  END IF;
  v_result := public.update_community_cards(v_root.hand_id, v_cards, v_actor);
  IF v_result->>'error' IS NOT NULL THEN RETURN v_result; END IF;
  v_after := public._tracker_voice_hand_state_version(v_root.hand_id);
  v_receipt := jsonb_build_object('ok', true, 'voice_event_id', v_root.id,
    'canonical_receipt_event_id', v_receipt_id, 'idempotency_key', p_idempotency_key, 'trace_id', p_trace_id,
    'street', v_street, 'previous_board', v_previous, 'community_cards', v_cards,
    'state_version_before', v_before, 'state_version_after', v_after);
  INSERT INTO public.tracker_voice_events (
    id, root_event_id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id, dealer_id,
    assignment_id, actor_user_id, event_kind, provider_name, provider_model, normalized_command, state_version,
    execution_mode, execution_result, validation_mode, turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_receipt_id, v_root.id, v_root.club_id, v_root.tournament_id, v_root.tournament_table_id, v_root.physical_table_id,
    v_root.hand_id, v_root.dealer_id, v_root.assignment_id, v_actor, 'canonical_receipt', v_root.provider_name,
    v_root.provider_model, v_root.normalized_command, v_after, 'assist', 'committed', 'enforce', true,
    p_idempotency_key, public._tracker_voice_request_hash(jsonb_build_object('root_event_id', v_root.id, 'community_cards', v_cards)),
    p_trace_id, v_receipt
  );
  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_tracker_voice_board_v0(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.commit_tracker_voice_board_v0(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
