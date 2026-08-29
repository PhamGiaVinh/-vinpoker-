-- Source-only pending migration for Tracker Voice Hole Cards Assist.
-- Requires the qualified 080 -> 12003 -> 12008 -> 13000007 -> 13000009 chain.
-- This keeps manual show_hole_cards as the public ABI and routes both manual
-- batches and one-seat Voice confirms through one private mutation core.
BEGIN;

CREATE OR REPLACE FUNCTION public._tracker_apply_hole_cards_core_v0(
  p_hand_id UUID,
  p_player_hole_cards JSONB,
  p_actor_user_id UUID,
  p_voice_strict BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_hand RECORD;
  v_item JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_cards JSONB;
  v_existing_cards JSONB;
  v_validation TEXT;
  v_entry_count INTEGER := 0;
BEGIN
  IF p_actor_user_id IS NULL
     OR jsonb_typeof(p_player_hole_cards) <> 'array'
     OR jsonb_array_length(p_player_hole_cards) < 1 THEN
    RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
  END IF;

  SELECT h.id, h.community_cards
  INTO v_hand
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'hand_not_found'); END IF;

  -- Serialize every entry for this hand. The outer public writer has already
  -- proven actor/lock scope; the private core owns card and partial-write rules.
  PERFORM 1 FROM public.hand_players hp WHERE hp.hand_id = p_hand_id FOR UPDATE;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_player_hole_cards) LOOP
    BEGIN
      v_player_id := (v_item->>'player_id')::UUID;
      v_entry_number := (v_item->>'entry_number')::INTEGER;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END;
    v_cards := v_item->'hole_cards';
    IF v_player_id IS NULL OR v_entry_number IS NULL OR v_entry_number < 1 THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END IF;
    IF jsonb_typeof(v_cards) <> 'array' THEN
      RETURN jsonb_build_object('error', 'invalid_hole_cards_payload');
    END IF;
    v_validation := public.validate_cards(v_cards);
    IF v_validation <> 'ok' OR jsonb_array_length(v_cards) <> 2 THEN
      RETURN jsonb_build_object('error', COALESCE(NULLIF(v_validation, 'ok'), 'invalid_hole_cards_payload'));
    END IF;

    SELECT hp.hole_cards INTO v_existing_cards
    FROM public.hand_players hp
    WHERE hp.hand_id = p_hand_id
      AND hp.player_id = v_player_id
      AND hp.entry_number = v_entry_number;
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'player_not_in_hand'); END IF;

    IF p_voice_strict AND COALESCE(v_existing_cards, '[]'::JSONB) <> '[]'::JSONB THEN
      IF v_existing_cards = v_cards THEN
        RETURN jsonb_build_object('error', 'hole_cards_already_persisted');
      END IF;
      RETURN jsonb_build_object('error', 'voice_hole_card_correction_required');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_cards) AS proposed(card)
      WHERE proposed.card IN (
        SELECT jsonb_array_elements_text(COALESCE(v_hand.community_cards, '[]'::JSONB))
        UNION
        SELECT jsonb_array_elements_text(COALESCE(other_hp.hole_cards, '[]'::JSONB))
        FROM public.hand_players other_hp
        WHERE other_hp.hand_id = p_hand_id
          AND (other_hp.player_id, other_hp.entry_number) <> (v_player_id, v_entry_number)
          AND COALESCE(other_hp.hole_cards, '[]'::JSONB) <> '[]'::JSONB
      )
    ) THEN
      RETURN jsonb_build_object('error', 'card_already_used_by_board_or_hole_cards');
    END IF;

    UPDATE public.hand_players
    SET hole_cards = v_cards
    WHERE hand_id = p_hand_id
      AND player_id = v_player_id
      AND entry_number = v_entry_number;
    v_entry_count := v_entry_count + 1;
  END LOOP;

  UPDATE public.tournament_hands
  SET updated_at = now(), locked_at = now()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success', 'entry_count', v_entry_count);
END;
$function$;

REVOKE ALL ON FUNCTION public._tracker_apply_hole_cards_core_v0(UUID, JSONB, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;

-- The original manual ABI remains the only public hole-card writer. It has the
-- existing tracker/assigned Dealer authorization and delegates the exact batch
-- entries to the shared private core.
CREATE OR REPLACE FUNCTION public.show_hole_cards(
  p_hand_id UUID,
  p_player_hole_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
BEGIN
  IF v_actor IS NULL THEN RETURN jsonb_build_object('error', 'unauthenticated'); END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN RETURN jsonb_build_object('error', 'actor_mismatch'); END IF;
  SELECT h.status, h.locked_by_user_id, h.locked_at, h.tournament_id, h.table_id, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'hand_not_found'); END IF;
  IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
    IF NOT EXISTS (
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
    ) THEN RETURN jsonb_build_object('error', 'actor_not_allowed'); END IF;
  END IF;
  IF v_hand.status <> 'in_progress' THEN RETURN jsonb_build_object('error', 'hand_not_in_progress'); END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN
    RETURN jsonb_build_object('error', 'lock_lost');
  END IF;
  RETURN public._tracker_apply_hole_cards_core_v0(p_hand_id, p_player_hole_cards, v_actor, FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION public.show_hole_cards(UUID, JSONB, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.show_hole_cards(UUID, JSONB, UUID) TO authenticated;

-- Only Edge (service_role) can create the redacted root, invoke the shared
-- mutation core, and append its immutable receipt in one transaction. Raw card
-- speech is parsed transiently in Edge and never reaches this SQL function.
CREATE OR REPLACE FUNCTION public.commit_tracker_voice_hole_cards_v0(
  p_actor_user_id UUID,
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_hand_id UUID,
  p_provider_name TEXT,
  p_provider_model TEXT,
  p_provider_event_id TEXT,
  p_expected_state_version TEXT,
  p_idempotency_key TEXT,
  p_trace_id TEXT,
  p_seat_number INTEGER,
  p_hole_cards JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_assignment JSONB;
  v_config RECORD;
  v_hand RECORD;
  v_target RECORD;
  v_existing RECORD;
  v_existing_receipt RECORD;
  v_request_hash TEXT;
  v_state_before TEXT;
  v_state_after TEXT;
  v_core_result JSONB;
  v_root_event_id UUID := gen_random_uuid();
  v_receipt_event_id UUID := gen_random_uuid();
  v_live_count INTEGER := 0;
  v_all_in_count INTEGER := 0;
  v_redacted_transcript TEXT;
  v_normalized_command JSONB;
  v_receipt JSONB;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;
  IF p_actor_user_id IS NULL
     OR p_seat_number NOT BETWEEN 1 AND 10
     OR p_expected_state_version !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'
     OR p_trace_id IS NULL OR char_length(p_trace_id) NOT BETWEEN 8 AND 255
     OR jsonb_typeof(p_hole_cards) <> 'array' OR jsonb_array_length(p_hole_cards) <> 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_hole_cards_request');
  END IF;

  -- Serializing on the canonical tournament before the idempotency lookup makes
  -- concurrent same-key confirms return the original receipt, not a second write.
  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  v_request_hash := public._tracker_voice_request_hash(jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id,
    'provider_name', p_provider_name,
    'provider_model', p_provider_model,
    'provider_event_id', p_provider_event_id,
    'state_version', p_expected_state_version,
    'seat_number', p_seat_number,
    'hole_cards', p_hole_cards,
    'execution_mode', 'assist'
  ));
  SELECT * INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = p_actor_user_id
    AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    SELECT * INTO v_existing_receipt
    FROM public.tracker_voice_events e
    WHERE e.root_event_id = v_existing.id AND e.event_kind = 'canonical_receipt';
    IF FOUND THEN RETURN v_existing_receipt.receipt || jsonb_build_object('duplicate', true); END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'voice_event_incomplete');
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, p_actor_user_id
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN RETURN v_assignment; END IF;
  SELECT * INTO v_config FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id
    AND c.tournament_table_id = p_tournament_table_id
  FOR UPDATE;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE OR v_config.correction_state <> 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_not_ready');
  END IF;
  IF v_config.configured_mode = 'shadow' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assist_not_allowed');
  END IF;
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

  SELECT h.* INTO v_hand
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id
    AND h.tournament_id = p_tournament_id
    AND h.table_id = p_tournament_table_id
  FOR UPDATE;
  IF NOT FOUND OR v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, p_actor_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_lost');
  END IF;
  v_state_before := public._tracker_voice_hand_state_version(p_hand_id);
  IF v_state_before <> p_expected_state_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_state_version', 'state_version', v_state_before);
  END IF;
  IF jsonb_array_length(COALESCE(v_hand.community_cards, '[]'::JSONB)) >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'showdown_hole_cards_deferred_muck_authority');
  END IF;

  -- Canonical action history, not a browser draft, proves this is a genuine
  -- all-in runout: at least two live players and every live player is all-in.
  WITH player_state AS (
    SELECT hp.player_id, hp.entry_number, hp.starting_stack,
      EXISTS (
        SELECT 1 FROM public.hand_actions folded
        WHERE folded.hand_id = hp.hand_id
          AND folded.player_id = hp.player_id
          AND folded.entry_number = hp.entry_number
          AND folded.action_type = 'fold'
      ) AS folded,
      COALESCE((
        SELECT sum(action.action_amount)
        FROM public.hand_actions action
        WHERE action.hand_id = hp.hand_id
          AND action.player_id = hp.player_id
          AND action.entry_number = hp.entry_number
          AND action.action_type IN ('post_sb', 'post_bb', 'post_ante', 'call', 'bet', 'raise', 'all_in')
      ), 0) AS committed
    FROM public.hand_players hp
    WHERE hp.hand_id = p_hand_id
  )
  SELECT count(*) FILTER (WHERE NOT folded),
         count(*) FILTER (WHERE NOT folded AND committed >= starting_stack)
  INTO v_live_count, v_all_in_count
  FROM player_state;
  IF v_live_count < 2 OR v_live_count <> v_all_in_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'runout_reveal_not_authoritative');
  END IF;

  SELECT hp.player_id, hp.entry_number, hp.hole_cards
  INTO v_target
  FROM public.hand_players hp
  WHERE hp.hand_id = p_hand_id AND hp.seat_number = p_seat_number
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'hole_cards_seat_not_found'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.hand_actions ha
    WHERE ha.hand_id = p_hand_id
      AND ha.player_id = v_target.player_id
      AND ha.entry_number = v_target.entry_number
      AND ha.action_type = 'fold'
  ) THEN RETURN jsonb_build_object('ok', false, 'error', 'player_folded'); END IF;

  -- The core mutates exactly one explicit entry. A later root/receipt failure
  -- raises and rolls this mutation back with the enclosing transaction.
  v_core_result := public._tracker_apply_hole_cards_core_v0(
    p_hand_id,
    jsonb_build_array(jsonb_build_object(
      'player_id', v_target.player_id,
      'entry_number', v_target.entry_number,
      'hole_cards', p_hole_cards
    )),
    p_actor_user_id,
    TRUE
  );
  IF v_core_result->>'error' IS NOT NULL THEN
    RETURN v_core_result || jsonb_build_object('ok', false);
  END IF;

  v_redacted_transcript := format('Seat %s [HOLE_CARDS_REDACTED]', p_seat_number);
  v_normalized_command := jsonb_build_object(
    'kind', 'hole_cards',
    'intent_domain', 'hole_cards',
    'redacted', true,
    'seat_number', p_seat_number,
    'actor_player_id', v_target.player_id,
    'entry_number', v_target.entry_number,
    'hardener_version', 'none-private-hole-cards-v1',
    'grammar_version', 'dealer-hole-cards-v1',
    'vocabulary_version', 'poker-dealer-v2',
    'requires_confirmation', true
  );
  INSERT INTO public.tracker_voice_events (
    id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id, dealer_id,
    assignment_id, actor_user_id, actor_player_id, event_kind, provider_name, provider_model,
    provider_event_id, final_transcript, normalized_command, state_version, execution_mode,
    execution_result, validation_mode, turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_root_event_id, (v_assignment->>'club_id')::UUID, p_tournament_id, p_tournament_table_id,
    (v_assignment->>'physical_table_id')::UUID, p_hand_id, (v_assignment->>'dealer_id')::UUID,
    (v_assignment->>'assignment_id')::UUID, p_actor_user_id, v_target.player_id, 'final_transcript',
    p_provider_name, p_provider_model, NULLIF(p_provider_event_id, ''), v_redacted_transcript,
    v_normalized_command, v_state_before, 'assist', 'validated', 'enforce', true,
    p_idempotency_key, v_request_hash, p_trace_id, jsonb_build_object('redacted', true)
  );
  v_state_after := public._tracker_voice_hand_state_version(p_hand_id);
  v_receipt := jsonb_build_object(
    'ok', true,
    'voice_event_id', v_root_event_id,
    'canonical_receipt_event_id', v_receipt_event_id,
    'idempotency_key', p_idempotency_key,
    'trace_id', p_trace_id,
    'seat_number', p_seat_number,
    'player_id', v_target.player_id,
    'entry_number', v_target.entry_number,
    'redacted', true,
    'state_version_before', v_state_before,
    'state_version_after', v_state_after
  );
  INSERT INTO public.tracker_voice_events (
    id, root_event_id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id,
    dealer_id, assignment_id, actor_user_id, actor_player_id, event_kind, provider_name, provider_model,
    normalized_command, state_version, execution_mode, execution_result, validation_mode,
    turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_receipt_event_id, v_root_event_id, (v_assignment->>'club_id')::UUID, p_tournament_id,
    p_tournament_table_id, (v_assignment->>'physical_table_id')::UUID, p_hand_id,
    (v_assignment->>'dealer_id')::UUID, (v_assignment->>'assignment_id')::UUID, p_actor_user_id,
    v_target.player_id, 'canonical_receipt', p_provider_name, p_provider_model, v_normalized_command,
    v_state_after, 'assist', 'committed', 'enforce', true, p_idempotency_key,
    public._tracker_voice_request_hash(jsonb_build_object('root_event_id', v_root_event_id, 'redacted', true)),
    p_trace_id, v_receipt
  );
  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_tracker_voice_hole_cards_v0(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tracker_voice_hole_cards_v0(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB)
  TO service_role;

COMMIT;
