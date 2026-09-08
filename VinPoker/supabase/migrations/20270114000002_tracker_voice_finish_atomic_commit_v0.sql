-- Source-only forward migration. Do not apply without a separate owner-gated rollout.
-- It retains record_hand as the only hand DML writer and only admits a validated
-- service-role Dealer call through the private Voice Finish wrapper below.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_hand(
  p_tournament_id UUID,
  p_table_id UUID,
  p_hand_number INTEGER,
  p_hand_time TIMESTAMPTZ,
  p_players JSONB,
  p_actions JSONB,
  p_side_pots JSONB DEFAULT '[]'::JSONB,
  p_community_cards JSONB DEFAULT '[]'::JSONB,
  p_pot_size INTEGER DEFAULT 0,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_service_voice_call BOOLEAN := COALESCE(auth.jwt()->>'role', '') = 'service_role';
  v_club_id UUID;
  v_tt RECORD;
  v_hand RECORD;
  v_table_matches INTEGER;
  v_hand_matches INTEGER;
  v_snapshot_count INTEGER;
  v_payload_count INTEGER;
  v_payload_distinct INTEGER;
  v_invalid_players INTEGER;
  v_starting_total BIGINT;
  v_ending_total BIGINT;
  v_invalid_actions INTEGER;
  v_action_count INTEGER;
  v_action_distinct INTEGER;
  v_player JSONB;
  v_action JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_seat_number INTEGER;
  v_starting_stack INTEGER;
  v_ending_stack INTEGER;
  v_is_eliminated BOOLEAN;
  v_seat RECORD;
BEGIN
  IF v_service_voice_call THEN
    IF p_created_by IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'voice_actor_required');
    END IF;
    v_actor := p_created_by;
  ELSIF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  IF p_created_by IS NOT NULL AND p_created_by IS DISTINCT FROM v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_mismatch');
  END IF;

  IF p_tournament_id IS NULL OR p_table_id IS NULL OR p_hand_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_hand_identity');
  END IF;

  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_actions) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_side_pots, '[]'::JSONB)) IS DISTINCT FROM 'array'
     OR jsonb_typeof(COALESCE(p_community_cards, '[]'::JSONB)) IS DISTINCT FROM 'array'
     OR COALESCE(p_pot_size, 0) < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'malformed_hand_payload');
  END IF;

  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  IF NOT public.is_club_tracker(v_actor, v_club_id) AND NOT v_service_voice_call THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  PERFORM 1 FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;

  SELECT count(*) INTO v_table_matches
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND p_table_id IN (tt.id, tt.table_id);
  IF v_table_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  ELSIF v_table_matches <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_table_identity');
  END IF;

  SELECT tt.id, tt.table_id, tt.status
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND p_table_id IN (tt.id, tt.table_id)
  FOR UPDATE;

  -- Direct service_role execution remains impossible by ACL. The only service
  -- call is the Finish wrapper below, and this keeps its dealer identity bound
  -- to the same active physical-table assignment used by the Voice runtime.
  IF v_service_voice_call AND NOT EXISTS (
    SELECT 1
    FROM public.dealers d
    JOIN public.dealer_assignments da ON da.dealer_id = d.id
    JOIN public.tournament_tables assigned_tt ON assigned_tt.table_id = da.table_id
    WHERE d.user_id = v_actor
      AND d.club_id = v_club_id
      AND da.status = 'assigned'
      AND assigned_tt.id = v_tt.id
      AND assigned_tt.tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_dealer_assignment_required');
  END IF;

  SELECT count(*) INTO v_hand_matches
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id IN (v_tt.id, v_tt.table_id)
    AND h.hand_number = p_hand_number
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false;
  IF v_hand_matches = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_hand_not_found');
  ELSIF v_hand_matches <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ambiguous_active_hand');
  END IF;

  SELECT h.* INTO v_hand
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id IN (v_tt.id, v_tt.table_id)
    AND h.hand_number = p_hand_number
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false
  FOR UPDATE;

  PERFORM 1 FROM public.hand_players hp WHERE hp.hand_id = v_hand.id FOR UPDATE;
  PERFORM 1
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
  FOR UPDATE;
  PERFORM 1
  FROM public.tournament_entries e
  WHERE e.id IN (
    SELECT s.entry_id
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.entry_id IS NOT NULL
  )
  FOR UPDATE;
  PERFORM 1
  FROM public.tournament_chip_counts c
  WHERE c.tournament_id = p_tournament_id
    AND EXISTS (
      SELECT 1
      FROM public.tournament_seats s
      WHERE s.tournament_id = c.tournament_id
        AND s.table_id = v_tt.id
        AND s.player_id = c.player_id
        AND s.entry_number = c.entry_number
    )
  FOR UPDATE;

  BEGIN
    SELECT
      count(*),
      count(DISTINCT (p.player_id, p.entry_number)),
      count(*) FILTER (
        WHERE p.player_id IS NULL
           OR p.entry_number IS NULL
           OR p.entry_number < 1
           OR p.seat_number IS NULL
           OR p.seat_number < 1
           OR p.starting_stack IS NULL
           OR p.starting_stack < 0
           OR p.ending_stack IS NULL
           OR p.ending_stack < 0
           OR p.is_eliminated IS NULL
           OR p.is_eliminated IS DISTINCT FROM (p.ending_stack = 0)
      ),
      COALESCE(sum(p.starting_stack), 0),
      COALESCE(sum(p.ending_stack), 0)
    INTO
      v_payload_count,
      v_payload_distinct,
      v_invalid_players,
      v_starting_total,
      v_ending_total
    FROM jsonb_to_recordset(p_players) AS p(
      player_id UUID,
      entry_number INTEGER,
      seat_number INTEGER,
      starting_stack INTEGER,
      ending_stack INTEGER,
      is_eliminated BOOLEAN,
      side_pots JSONB,
      hole_cards JSONB
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'malformed_player_payload');
  END;

  SELECT count(*) INTO v_snapshot_count
  FROM public.hand_players hp
  WHERE hp.hand_id = v_hand.id;

  IF v_payload_count = 0
     OR v_payload_count <> v_payload_distinct
     OR v_invalid_players <> 0
     OR v_payload_count <> v_snapshot_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_snapshot_mismatch');
  END IF;

  IF v_starting_total <> v_ending_total THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'chip_conservation_failed',
      'starting_total', v_starting_total,
      'ending_total', v_ending_total
    );
  END IF;

  IF EXISTS (
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    ), snapshot AS (
      SELECT hp.player_id, hp.entry_number, hp.seat_number, hp.starting_stack
      FROM public.hand_players hp
      WHERE hp.hand_id = v_hand.id
    )
    SELECT 1
    FROM snapshot hp
    FULL JOIN payload p
      ON p.player_id = hp.player_id
     AND p.entry_number = hp.entry_number
    WHERE hp.player_id IS NULL
       OR p.player_id IS NULL
       OR p.seat_number IS DISTINCT FROM hp.seat_number
       OR p.starting_stack IS DISTINCT FROM hp.starting_stack
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_snapshot_mismatch');
  END IF;

  IF EXISTS (
    WITH payload AS (
      SELECT *
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    )
    SELECT 1
    FROM payload p
    LEFT JOIN public.tournament_seats s
      ON s.tournament_id = p_tournament_id
     AND s.table_id = v_tt.id
     AND s.player_id = p.player_id
     AND s.entry_number = p.entry_number
     AND s.seat_number = p.seat_number
     AND s.is_active = true
    LEFT JOIN public.tournament_entries e
      ON e.id = s.entry_id
     AND e.tournament_id = p_tournament_id
     AND e.player_id = p.player_id
     AND e.entry_no = p.entry_number
     AND e.status = 'seated'
     AND e.table_id IS NOT DISTINCT FROM v_tt.table_id
     AND e.seat_number IS NOT DISTINCT FROM p.seat_number
    LEFT JOIN public.tournament_chip_counts c
      ON c.tournament_id = p_tournament_id
     AND c.player_id = p.player_id
     AND c.entry_number = p.entry_number
    WHERE s.id IS NULL
       OR e.id IS NULL
       OR s.chip_count IS DISTINCT FROM p.starting_stack
       OR e.current_stack IS DISTINCT FROM p.starting_stack
       OR (c.player_id IS NOT NULL AND c.chip_count IS DISTINCT FROM p.starting_stack)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stack_or_entry_projection_mismatch');
  END IF;

  BEGIN
    SELECT
      count(*),
      count(DISTINCT a.action_order),
      count(*) FILTER (
        WHERE a.player_id IS NULL
           OR a.entry_number IS NULL
           OR a.action_order IS NULL
           OR a.action_order < 1
           OR NULLIF(btrim(a.action_type), '') IS NULL
      )
    INTO v_action_count, v_action_distinct, v_invalid_actions
    FROM jsonb_to_recordset(p_actions) AS a(
      player_id UUID,
      entry_number INTEGER,
      street TEXT,
      action_type TEXT,
      action_amount INTEGER,
      action_order INTEGER
    );
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'error', 'malformed_action_payload');
  END;

  IF v_action_count <> v_action_distinct OR v_invalid_actions <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'malformed_action_payload');
  END IF;

  IF EXISTS (
    WITH actions AS (
      SELECT *
      FROM jsonb_to_recordset(p_actions) AS a(
        player_id UUID,
        entry_number INTEGER,
        street TEXT,
        action_type TEXT,
        action_amount INTEGER,
        action_order INTEGER
      )
    ), players AS (
      SELECT p.player_id, p.entry_number
      FROM jsonb_to_recordset(p_players) AS p(
        player_id UUID,
        entry_number INTEGER,
        seat_number INTEGER,
        starting_stack INTEGER,
        ending_stack INTEGER,
        is_eliminated BOOLEAN,
        side_pots JSONB,
        hole_cards JSONB
      )
    )
    SELECT 1
    FROM actions a
    LEFT JOIN players p
      ON p.player_id = a.player_id
     AND p.entry_number = a.entry_number
    WHERE p.player_id IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'action_player_mismatch');
  END IF;

  IF EXISTS (
    WITH actions AS (
      SELECT *
      FROM jsonb_to_recordset(p_actions) AS a(
        player_id UUID,
        entry_number INTEGER,
        street TEXT,
        action_type TEXT,
        action_amount INTEGER,
        action_order INTEGER
      )
    )
    SELECT 1
    FROM public.hand_actions existing
    JOIN actions incoming ON incoming.action_order = existing.action_order
    WHERE existing.hand_id = v_hand.id
      AND (
        existing.player_id IS DISTINCT FROM incoming.player_id
        OR COALESCE(existing.entry_number, 1) IS DISTINCT FROM incoming.entry_number
        OR COALESCE(existing.street, 'preflop') IS DISTINCT FROM COALESCE(incoming.street, 'preflop')
        OR existing.action_type IS DISTINCT FROM incoming.action_type
        OR COALESCE(existing.action_amount, 0) IS DISTINCT FROM COALESCE(incoming.action_amount, 0)
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'action_conflict');
  END IF;

  UPDATE public.tournament_hands
  SET community_cards = COALESCE(p_community_cards, '[]'::JSONB),
      pot_size = COALESCE(p_pot_size, 0),
      side_pots = COALESCE(p_side_pots, '[]'::JSONB),
      status = 'completed',
      updated_at = now(),
      locked_by_user_id = NULL,
      locked_at = NULL
  WHERE id = v_hand.id;

  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_player_id := (v_player->>'player_id')::UUID;
    v_entry_number := (v_player->>'entry_number')::INTEGER;
    v_seat_number := (v_player->>'seat_number')::INTEGER;
    v_starting_stack := (v_player->>'starting_stack')::INTEGER;
    v_ending_stack := (v_player->>'ending_stack')::INTEGER;
    v_is_eliminated := (v_player->>'is_eliminated')::BOOLEAN;

    SELECT s.id, s.entry_id, s.player_name, s.avatar_url
    INTO v_seat
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.player_id = v_player_id
      AND s.entry_number = v_entry_number
      AND s.seat_number = v_seat_number
      AND s.is_active = true;

    UPDATE public.hand_players hp
    SET ending_stack = v_ending_stack,
        is_eliminated = v_is_eliminated,
        side_pots = COALESCE(v_player->'side_pots', '[]'::JSONB),
        hole_cards = COALESCE(v_player->'hole_cards', '[]'::JSONB),
        player_name = COALESCE(hp.player_name, v_seat.player_name),
        avatar_url = COALESCE(hp.avatar_url, v_seat.avatar_url)
    WHERE hp.hand_id = v_hand.id
      AND hp.player_id = v_player_id
      AND hp.entry_number = v_entry_number;

    UPDATE public.tournament_seats
    SET chip_count = v_ending_stack,
        is_active = NOT v_is_eliminated,
        status = CASE WHEN v_is_eliminated THEN 'busted' ELSE 'active' END
    WHERE id = v_seat.id;

    INSERT INTO public.tournament_chip_counts (
      tournament_id, player_id, entry_number, chip_count
    ) VALUES (
      p_tournament_id, v_player_id, v_entry_number, v_ending_stack
    )
    ON CONFLICT (tournament_id, player_id, entry_number)
    DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = now();

    UPDATE public.tournament_entries
    SET current_stack = v_ending_stack,
        status = CASE WHEN v_is_eliminated THEN 'busted' ELSE 'seated' END,
        busted_at = CASE
          WHEN v_is_eliminated THEN COALESCE(busted_at, now())
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = v_seat.entry_id;

    IF v_is_eliminated AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_eliminations te
      WHERE te.tournament_id = p_tournament_id
        AND te.player_id = v_player_id
        AND te.entry_number = v_entry_number
        AND te.hand_id = v_hand.id
    ) THEN
      INSERT INTO public.tournament_eliminations (
        tournament_id, player_id, entry_number, hand_id, position, prize
      ) VALUES (
        p_tournament_id, v_player_id, v_entry_number, v_hand.id, 0, 0
      );
    END IF;
  END LOOP;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    INSERT INTO public.hand_actions (
      hand_id, player_id, entry_number, street,
      action_type, action_amount, action_order
    ) VALUES (
      v_hand.id,
      (v_action->>'player_id')::UUID,
      (v_action->>'entry_number')::INTEGER,
      COALESCE(v_action->>'street', 'preflop'),
      v_action->>'action_type',
      COALESCE((v_action->>'action_amount')::INTEGER, 0),
      (v_action->>'action_order')::INTEGER
    )
    ON CONFLICT (hand_id, action_order) DO NOTHING;
  END LOOP;

  UPDATE public.tournaments
  SET players_remaining = (
        SELECT count(*)
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      average_stack = (
        SELECT COALESCE(round(avg(s.chip_count)), 0)::INTEGER
        FROM public.tournament_seats s
        WHERE s.tournament_id = p_tournament_id
          AND s.is_active = true
      ),
      updated_at = now()
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'success',
    'hand_id', v_hand.id,
    'starting_total', v_starting_total,
    'ending_total', v_ending_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_hand(
  UUID, UUID, INTEGER, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, INTEGER, UUID
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_hand(
  UUID, UUID, INTEGER, TIMESTAMPTZ, JSONB, JSONB, JSONB, JSONB, INTEGER, UUID
) TO authenticated, postgres;

-- Edge supplies only a freshly recomputed server settlement. This service-only
-- function serializes idempotency, calls the unchanged manual ABI above, then
-- appends the immutable root and receipt in the same transaction.
CREATE OR REPLACE FUNCTION public.commit_tracker_voice_finish_v0(
  p_actor_user_id UUID,
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_hand_id UUID,
  p_provider_name TEXT,
  p_provider_model TEXT,
  p_provider_event_id TEXT,
  p_final_transcript TEXT,
  p_expected_state_version TEXT,
  p_idempotency_key TEXT,
  p_trace_id TEXT,
  p_settlement_origin TEXT,
  p_settlement_digest TEXT,
  p_record_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_assignment JSONB;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_hand RECORD;
  v_existing RECORD;
  v_existing_receipt RECORD;
  v_request_hash TEXT;
  v_state_before TEXT;
  v_state_after TEXT;
  v_core_result JSONB;
  v_root_event_id UUID := gen_random_uuid();
  v_receipt_event_id UUID := gen_random_uuid();
  v_live_count INTEGER := 0;
  v_hole_count INTEGER := 0;
  v_actions JSONB;
  v_normalized_command JSONB;
  v_receipt JSONB;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;
  IF p_actor_user_id IS NULL
     OR p_expected_state_version !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'
     OR p_trace_id IS NULL OR char_length(p_trace_id) NOT BETWEEN 8 AND 255
     OR p_final_transcript IS NULL OR char_length(p_final_transcript) NOT BETWEEN 1 AND 500
     OR p_settlement_origin NOT IN ('engine_fold_win', 'engine_showdown')
     OR p_settlement_digest !~ '^[0-9a-f]{64}$'
     OR jsonb_typeof(p_record_payload) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_finish_request');
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);
  v_request_hash := public._tracker_voice_request_hash(jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id,
    'provider_name', p_provider_name,
    'provider_model', p_provider_model,
    'provider_event_id', p_provider_event_id,
    'state_version', p_expected_state_version,
    'settlement_origin', p_settlement_origin,
    'settlement_digest', p_settlement_digest,
    'record_payload', p_record_payload,
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
  IF NOT FOUND OR v_config.enabled IS NOT TRUE OR v_config.correction_state <> 'ready'
     OR v_config.configured_mode NOT IN ('assist', 'auto') THEN
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
    RETURN jsonb_build_object('ok', false, 'error', 'finish_proposal_stale', 'state_version', v_state_before);
  END IF;
  IF (p_record_payload->>'hand_number') !~ '^[0-9]+$'
     OR COALESCE((p_record_payload->>'hand_number')::INTEGER, -1) <> v_hand.hand_number
     OR COALESCE(p_record_payload->'community_cards', '[]'::JSONB) <> COALESCE(v_hand.community_cards, '[]'::JSONB)
     OR jsonb_typeof(p_record_payload->'players') <> 'array'
     OR jsonb_typeof(p_record_payload->'actions') <> 'array'
     OR jsonb_typeof(p_record_payload->'side_pots') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'finish_payload_mismatch');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', ha.player_id,
    'entry_number', ha.entry_number,
    'street', COALESCE(ha.street, 'preflop'),
    'action_type', ha.action_type,
    'action_amount', COALESCE(ha.action_amount, 0),
    'action_order', ha.action_order
  ) ORDER BY ha.action_order, ha.id), '[]'::JSONB)
  INTO v_actions
  FROM public.hand_actions ha WHERE ha.hand_id = p_hand_id;
  IF p_record_payload->'actions' <> v_actions THEN
    RETURN jsonb_build_object('ok', false, 'error', 'finish_payload_mismatch');
  END IF;

  WITH player_state AS (
    SELECT hp.player_id, hp.entry_number, hp.hole_cards,
      EXISTS (
        SELECT 1 FROM public.hand_actions folded
        WHERE folded.hand_id = hp.hand_id
          AND folded.player_id = hp.player_id
          AND folded.entry_number = hp.entry_number
          AND folded.action_type = 'fold'
      ) AS folded
    FROM public.hand_players hp WHERE hp.hand_id = p_hand_id
  )
  SELECT count(*) FILTER (WHERE NOT folded),
         count(*) FILTER (WHERE NOT folded AND jsonb_array_length(COALESCE(hole_cards, '[]'::JSONB)) = 2)
  INTO v_live_count, v_hole_count FROM player_state;
  IF (p_settlement_origin = 'engine_fold_win' AND v_live_count <> 1)
     OR (p_settlement_origin = 'engine_showdown' AND (
       v_live_count < 2 OR jsonb_array_length(COALESCE(v_hand.community_cards, '[]'::JSONB)) <> 5 OR v_hole_count <> v_live_count
     )) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'finish_requires_manual_showdown');
  END IF;

  -- This is the sole poker-state mutation. It keeps all historical validation,
  -- projections, Viewer/Replay publication, and the manual public ABI intact.
  IF (p_record_payload->>'pot_size') IS NOT NULL AND (p_record_payload->>'pot_size') !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'finish_payload_mismatch');
  END IF;

  v_core_result := public.record_hand(
    p_tournament_id,
    p_tournament_table_id,
    (p_record_payload->>'hand_number')::INTEGER,
    COALESCE((p_record_payload->>'hand_time')::TIMESTAMPTZ, v_hand.created_at),
    p_record_payload->'players',
    p_record_payload->'actions',
    p_record_payload->'side_pots',
    p_record_payload->'community_cards',
    COALESCE((p_record_payload->>'pot_size')::INTEGER, 0),
    p_actor_user_id
  );
  IF COALESCE((v_core_result->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_core_result || jsonb_build_object('ok', false);
  END IF;

  v_normalized_command := jsonb_build_object(
    'kind', 'finish_hand',
    'intent_domain', 'finish_hand',
    'normalized_transcript', 'ket thuc hand',
    'settlement_origin', p_settlement_origin,
    'settlement_digest', p_settlement_digest,
    'hardener_version', 'none-exact-finish-v1',
    'grammar_version', 'dealer-finish-v1',
    'vocabulary_version', 'poker-dealer-v2',
    'requires_confirmation', true
  );
  INSERT INTO public.tracker_voice_events (
    id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id, dealer_id,
    assignment_id, actor_user_id, event_kind, provider_name, provider_model, provider_event_id,
    final_transcript, normalized_command, state_version, execution_mode, execution_result,
    validation_mode, turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_root_event_id, (v_assignment->>'club_id')::UUID, p_tournament_id, p_tournament_table_id,
    (v_assignment->>'physical_table_id')::UUID, p_hand_id, (v_assignment->>'dealer_id')::UUID,
    (v_assignment->>'assignment_id')::UUID, p_actor_user_id, 'final_transcript', p_provider_name,
    p_provider_model, NULLIF(p_provider_event_id, ''), p_final_transcript, v_normalized_command,
    v_state_before, 'assist', 'validated', 'enforce', true, p_idempotency_key, v_request_hash,
    p_trace_id, jsonb_build_object('settlement_digest', p_settlement_digest)
  );
  v_state_after := public._tracker_voice_hand_state_version(p_hand_id);
  v_receipt := jsonb_build_object(
    'ok', true,
    'voice_event_id', v_root_event_id,
    'canonical_receipt_event_id', v_receipt_event_id,
    'idempotency_key', p_idempotency_key,
    'trace_id', p_trace_id,
    'hand_id', p_hand_id,
    'settlement_origin', p_settlement_origin,
    'settlement_digest', p_settlement_digest,
    'state_version_before', v_state_before,
    'state_version_after', v_state_after
  );
  INSERT INTO public.tracker_voice_events (
    id, root_event_id, club_id, tournament_id, tournament_table_id, physical_table_id, hand_id,
    dealer_id, assignment_id, actor_user_id, event_kind, provider_name, provider_model,
    normalized_command, state_version, execution_mode, execution_result, validation_mode,
    turn_order_enforced, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_receipt_event_id, v_root_event_id, (v_assignment->>'club_id')::UUID, p_tournament_id,
    p_tournament_table_id, (v_assignment->>'physical_table_id')::UUID, p_hand_id,
    (v_assignment->>'dealer_id')::UUID, (v_assignment->>'assignment_id')::UUID, p_actor_user_id,
    'canonical_receipt', p_provider_name, p_provider_model, v_normalized_command, v_state_after,
    'assist', 'committed', 'enforce', true, p_idempotency_key,
    public._tracker_voice_request_hash(jsonb_build_object('root_event_id', v_root_event_id, 'settlement_digest', p_settlement_digest)),
    p_trace_id, v_receipt
  );
  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public.commit_tracker_voice_finish_v0(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tracker_voice_finish_v0(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;

COMMIT;
