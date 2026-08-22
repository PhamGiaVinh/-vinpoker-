-- Tracker Voice Gemini Live provider support.
--
-- CRITICAL / RED / SOURCE-ONLY. This migration depends on
-- 20270112000003_tracker_voice_player_analytics_v0 and does not activate Voice.
-- A controlled apply, Edge deploy, secret provisioning, and TEST-only config are
-- separate owner gates.
--
-- ROLLBACK: apply a forward migration that restores the provider check to
-- ('openai_realtime', 'mock') only after no Gemini Voice event remains.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tracker_voice_events') IS NULL
     OR to_regclass('public.tracker_voice_configs') IS NULL THEN
    RAISE EXCEPTION 'tracker_voice_v0_dependency_missing';
  END IF;
END;
$$;

ALTER TABLE public.tracker_voice_events
  DROP CONSTRAINT IF EXISTS tracker_voice_events_provider_name_check;
ALTER TABLE public.tracker_voice_events
  ADD CONSTRAINT tracker_voice_events_provider_name_check
  CHECK (provider_name IN ('openai_realtime', 'gemini_live', 'mock'));
CREATE OR REPLACE FUNCTION public._tracker_voice_register_validated_event(
  p_actor_user_id UUID,
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_hand_id UUID,
  p_provider_name TEXT,
  p_provider_model TEXT,
  p_provider_event_id TEXT,
  p_provider_confidence NUMERIC,
  p_final_transcript TEXT,
  p_normalized_command JSONB,
  p_expected_state_version TEXT,
  p_execution_mode TEXT,
  p_idempotency_key TEXT,
  p_trace_id TEXT,
  p_validation_mode TEXT,
  p_turn_order_enforced BOOLEAN,
  p_capability_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := p_actor_user_id;
  v_assignment JSONB;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_hand RECORD;
  v_state_version TEXT;
  v_kind TEXT;
  v_actor_player_id UUID;
  v_request JSONB;
  v_request_hash TEXT;
  v_existing public.tracker_voice_events%ROWTYPE;
  v_event_id UUID;
  v_alert_id UUID;
  v_result TEXT := 'validated';
  v_receipt JSONB;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  END IF;
  IF p_trace_id IS NULL OR char_length(p_trace_id) NOT BETWEEN 8 AND 255 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_trace_id');
  END IF;
  IF p_final_transcript IS NULL OR char_length(p_final_transcript) NOT BETWEEN 1 AND 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_final_transcript');
  END IF;
  IF p_provider_name NOT IN ('openai_realtime', 'gemini_live', 'mock')
     OR NULLIF(btrim(COALESCE(p_provider_model, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_provider');
  END IF;
  IF p_provider_confidence IS NOT NULL AND (p_provider_confidence < 0 OR p_provider_confidence > 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_provider_confidence');
  END IF;
  IF p_execution_mode NOT IN ('shadow', 'assist', 'auto') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_execution_mode');
  END IF;
  IF p_validation_mode NOT IN ('off', 'warn', 'enforce') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_validation_mode');
  END IF;
  IF p_expected_state_version IS NULL OR p_expected_state_version !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_state_version');
  END IF;

  v_kind := p_normalized_command->>'kind';
  IF v_kind NOT IN ('fold', 'check', 'call', 'bet_to', 'raise_to', 'all_in', 'report_wrong_action', 'call_floor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_command');
  END IF;
  IF jsonb_typeof(COALESCE(p_normalized_command, 'null'::JSONB)) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_command');
  END IF;

  -- Idempotent replay must not depend on mutable hand/assignment state. The
  -- immutable request hash proves this is the exact request already accepted.
  -- A second lookup after the tournament lock closes the concurrent first-call
  -- race before any current-state validation or write occurs.
  v_request := jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id,
    'provider_name', p_provider_name,
    'provider_model', p_provider_model,
    'provider_event_id', p_provider_event_id,
    'provider_confidence', p_provider_confidence,
    'final_transcript', p_final_transcript,
    'normalized_command', p_normalized_command,
    'state_version', p_expected_state_version,
    'execution_mode', p_execution_mode,
    'validation_mode', p_validation_mode,
    'turn_order_enforced', p_turn_order_enforced,
    'capability_version', p_capability_version
  );
  v_request_hash := public._tracker_voice_request_hash(v_request);

  SELECT e.* INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor
    AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript';
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);

  SELECT e.* INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor
    AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, v_actor
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_assignment;
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id
    AND c.tournament_table_id = p_tournament_table_id
  FOR UPDATE;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_not_enabled');
  END IF;
  IF v_config.physical_table_id <> (v_assignment->>'physical_table_id')::UUID
     OR v_config.club_id <> (v_assignment->>'club_id')::UUID THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_config_scope_mismatch');
  END IF;

    IF p_provider_name = 'gemini_live'
     AND v_config.provider_model <> 'gemini-3.1-flash-live-preview' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
  IF p_provider_name = 'openai_realtime'
     AND v_config.provider_model = 'gemini-3.1-flash-live-preview' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_provider_config_mismatch');
  END IF;
SELECT h.id, h.tournament_id, h.table_id, h.status, h.is_voided,
         h.locked_by_user_id, h.locked_at
  INTO v_hand
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_hand.tournament_id <> p_tournament_id
     OR v_hand.table_id <> p_tournament_table_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_in_progress');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_lost');
  END IF;

  v_state_version := public._tracker_voice_hand_state_version(p_hand_id);
  IF v_state_version IS NULL OR v_state_version <> p_expected_state_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stale_state_version',
      'state_version', v_state_version
    );
  END IF;

  IF v_kind NOT IN ('report_wrong_action', 'call_floor')
     AND v_config.correction_state = 'correction_pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'correction_pending');
  END IF;

  IF p_execution_mode = 'assist' AND v_config.configured_mode = 'shadow' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assist_not_allowed');
  END IF;
  IF p_execution_mode = 'auto' THEN
    IF v_config.configured_mode <> 'auto'
       OR v_config.server_auto_allowed IS NOT TRUE
       OR p_validation_mode <> 'enforce'
       OR p_turn_order_enforced IS NOT TRUE
       OR v_config.auto_turn_order_compatible IS NOT TRUE
       OR p_provider_confidence IS NULL
       OR v_config.provider_confidence_threshold IS NULL
       OR p_provider_confidence < v_config.provider_confidence_threshold
       OR NULLIF(v_config.auto_capability_version, '') IS NULL
       OR v_config.auto_capability_version IS DISTINCT FROM p_capability_version THEN
      RETURN jsonb_build_object('ok', false, 'error', 'auto_capability_missing');
    END IF;
  END IF;

  IF v_kind NOT IN ('report_wrong_action', 'call_floor') THEN
    BEGIN
      v_actor_player_id := (p_normalized_command->>'actor_player_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_actor_player');
    END;
    IF v_actor_player_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.hand_players hp
         WHERE hp.hand_id = p_hand_id
           AND hp.player_id = v_actor_player_id
       ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_actor_player');
    END IF;
    IF p_normalized_command->>'canonical_action' NOT IN ('fold', 'check', 'call', 'bet', 'raise', 'all_in')
       OR COALESCE(p_normalized_command->>'action_order', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(p_normalized_command->>'action_amount', '') !~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_canonical_action');
    END IF;
  END IF;

  v_event_id := gen_random_uuid();
  IF v_kind = 'report_wrong_action' THEN
    v_result := 'alert_opened';
    v_alert_id := gen_random_uuid();
    INSERT INTO public.tracker_floor_alerts (
      id, club_id, tournament_id, tournament_table_id, physical_table_id,
      hand_id, voice_event_id, dealer_id, assignment_id, reported_by,
      alert_kind, priority, correction_required, title, message
    ) VALUES (
      v_alert_id,
      (v_assignment->>'club_id')::UUID,
      p_tournament_id,
      p_tournament_table_id,
      (v_assignment->>'physical_table_id')::UUID,
      p_hand_id,
      v_event_id,
      (v_assignment->>'dealer_id')::UUID,
      (v_assignment->>'assignment_id')::UUID,
      v_actor,
      'wrong_action',
      'high',
      true,
      'Sai action tren Tracker',
      left(p_final_transcript, 500)
    );
    UPDATE public.tracker_voice_configs
    SET correction_state = 'correction_pending',
        correction_alert_id = v_alert_id,
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_config.id;
  ELSIF v_kind = 'call_floor' THEN
    v_result := 'alert_opened';
    v_alert_id := gen_random_uuid();
    INSERT INTO public.tracker_floor_alerts (
      id, club_id, tournament_id, tournament_table_id, physical_table_id,
      hand_id, voice_event_id, dealer_id, assignment_id, reported_by,
      alert_kind, priority, correction_required, title, message
    ) VALUES (
      v_alert_id,
      (v_assignment->>'club_id')::UUID,
      p_tournament_id,
      p_tournament_table_id,
      (v_assignment->>'physical_table_id')::UUID,
      p_hand_id,
      v_event_id,
      (v_assignment->>'dealer_id')::UUID,
      (v_assignment->>'assignment_id')::UUID,
      v_actor,
      'call_floor',
      'urgent',
      false,
      'Dealer goi Floor',
      left(p_final_transcript, 500)
    );
  END IF;

  v_receipt := jsonb_build_object(
    'ok', true,
    'voice_event_id', v_event_id,
    'idempotency_key', p_idempotency_key,
    'trace_id', p_trace_id,
    'state_version', v_state_version,
    'execution_mode', p_execution_mode,
    'execution_result', v_result,
    'correction_pending', v_kind = 'report_wrong_action'
      OR v_config.correction_state = 'correction_pending',
    'alert_id', v_alert_id
  );

  INSERT INTO public.tracker_voice_events (
    id, club_id, tournament_id, tournament_table_id, physical_table_id,
    hand_id, dealer_id, assignment_id, actor_user_id, actor_player_id,
    event_kind, provider_name, provider_model, provider_event_id,
    provider_confidence, final_transcript, normalized_command, state_version,
    execution_mode, execution_result, validation_mode, turn_order_enforced,
    capability_version, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_event_id,
    (v_assignment->>'club_id')::UUID,
    p_tournament_id,
    p_tournament_table_id,
    (v_assignment->>'physical_table_id')::UUID,
    p_hand_id,
    (v_assignment->>'dealer_id')::UUID,
    (v_assignment->>'assignment_id')::UUID,
    v_actor,
    v_actor_player_id,
    'final_transcript',
    p_provider_name,
    p_provider_model,
    NULLIF(p_provider_event_id, ''),
    p_provider_confidence,
    p_final_transcript,
    p_normalized_command,
    v_state_version,
    p_execution_mode,
    v_result,
    p_validation_mode,
    COALESCE(p_turn_order_enforced, false),
    p_capability_version,
    p_idempotency_key,
    v_request_hash,
    p_trace_id,
    v_receipt
  );

  IF v_alert_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      club_id, actor_id, action, entity_type, entity_id, payload
    ) VALUES (
      (v_assignment->>'club_id')::UUID,
      v_actor,
      'tracker_floor_alert_opened',
      'tracker_floor_alert',
      v_alert_id,
      jsonb_build_object(
        'kind', v_kind,
        'voice_event_id', v_event_id,
        'tournament_table_id', p_tournament_table_id,
        'hand_id', p_hand_id
      )
    );
  END IF;

  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_register_validated_event(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT,
  TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tracker_voice_register_validated_event(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT,
  TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO service_role;

COMMIT;