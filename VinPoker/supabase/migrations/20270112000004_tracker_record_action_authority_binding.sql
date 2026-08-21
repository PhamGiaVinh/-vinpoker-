-- P0 Tracker authority hotfix.
--
-- Production is intentionally on the pre-Voice schema, while a clean migration
-- chain reaches this file after 20270112000003. Keep both states safe: patch the
-- current invoker function when Voice tables are absent, and otherwise verify
-- that 120 supplied the reviewed Voice-aware definition instead of overwriting it.
BEGIN;

DO $authority_hotfix$
DECLARE
  v_record_action TEXT;
  v_heartbeat TEXT;
BEGIN
  IF to_regclass('public.tracker_voice_events') IS NULL THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.heartbeat_lock(
        p_hand_id UUID,
        p_user_id UUID DEFAULT NULL
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      DECLARE
        v_actor UUID := auth.uid();
        v_hand RECORD;
        v_is_tracker BOOLEAN := FALSE;
      BEGIN
        IF v_actor IS NULL THEN
          RETURN jsonb_build_object('error', 'unauthorized');
        END IF;
        IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
          RETURN jsonb_build_object('error', 'actor_mismatch');
        END IF;

        SELECT h.id, h.status, h.is_voided, h.locked_by_user_id, h.locked_at, t.club_id
        INTO v_hand
        FROM public.tournament_hands h
        JOIN public.tournaments t ON t.id = h.tournament_id
        WHERE h.id = p_hand_id
        FOR UPDATE OF h;
        IF NOT FOUND THEN
          RETURN jsonb_build_object('error', 'Hand not found');
        END IF;
        IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
          RETURN jsonb_build_object('error', 'Hand is not in progress');
        END IF;

        v_is_tracker := public.is_club_tracker(v_actor, v_hand.club_id);
        IF NOT v_is_tracker THEN
          RETURN jsonb_build_object('error', 'actor_not_allowed');
        END IF;

        IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NOT NULL THEN
          RETURN jsonb_build_object('error', 'tracker_lock_ambiguous');
        END IF;
        IF v_hand.locked_by_user_id IS NOT NULL
           AND v_hand.locked_by_user_id <> v_actor
           AND v_hand.locked_at IS NOT NULL
           AND v_hand.locked_at > now() - public.tracker_lock_ttl() THEN
          RETURN jsonb_build_object(
            'error', 'tracker_lock_owned_by_another',
            'locked_by', v_hand.locked_by_user_id
          );
        END IF;

        UPDATE public.tournament_hands
        SET locked_by_user_id = v_actor,
            locked_at = now()
        WHERE id = p_hand_id;

        RETURN jsonb_build_object('status', 'success', 'locked_by', v_actor, 'locked_at', now());
      END;
      $body$;
    $definition$;

    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.record_action(
        p_hand_id UUID,
        p_player_id UUID,
        p_action_type TEXT,
        p_action_order INTEGER,
        p_entry_number INTEGER DEFAULT 1,
        p_street TEXT DEFAULT 'preflop',
        p_action_amount INTEGER DEFAULT 0,
        p_idempotency_key TEXT DEFAULT NULL,
        p_trace_id TEXT DEFAULT NULL,
        p_user_id UUID DEFAULT NULL
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY INVOKER
      SET search_path = public
      AS $body$
      DECLARE
        v_actor UUID := auth.uid();
        v_hand RECORD;
        v_existing public.hand_actions%ROWTYPE;
      BEGIN
        IF v_actor IS NULL THEN
          RETURN jsonb_build_object('error', 'unauthorized', 'trace_id', p_trace_id);
        END IF;
        IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
          RETURN jsonb_build_object('error', 'actor_mismatch', 'trace_id', p_trace_id);
        END IF;

        SELECT h.id, h.status, h.is_voided, h.locked_by_user_id, h.locked_at, t.club_id
        INTO v_hand
        FROM public.tournament_hands h
        JOIN public.tournaments t ON t.id = h.tournament_id
        WHERE h.id = p_hand_id
        FOR UPDATE OF h;
        IF NOT FOUND THEN
          RETURN jsonb_build_object('error', 'Hand not found', 'trace_id', p_trace_id);
        END IF;
        IF NOT public.is_club_tracker(v_actor, v_hand.club_id) THEN
          RETURN jsonb_build_object('error', 'actor_not_allowed', 'trace_id', p_trace_id);
        END IF;
        IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
          RETURN jsonb_build_object('error', 'Hand is not in progress', 'trace_id', p_trace_id);
        END IF;
        IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NULL THEN
          RETURN jsonb_build_object('error', 'tracker_lock_required', 'trace_id', p_trace_id);
        END IF;
        IF v_hand.locked_by_user_id IS NULL OR v_hand.locked_at IS NULL THEN
          RETURN jsonb_build_object('error', 'tracker_lock_ambiguous', 'trace_id', p_trace_id);
        END IF;
        IF v_hand.locked_at <= now() - public.tracker_lock_ttl() THEN
          RETURN jsonb_build_object('error', 'tracker_lock_expired', 'trace_id', p_trace_id);
        END IF;
        IF v_hand.locked_by_user_id <> v_actor THEN
          RETURN jsonb_build_object(
            'error', 'tracker_lock_owned_by_another',
            'locked_by', v_hand.locked_by_user_id,
            'trace_id', p_trace_id
          );
        END IF;

        IF p_idempotency_key IS NOT NULL THEN
          SELECT * INTO v_existing
          FROM public.hand_actions
          WHERE hand_id = p_hand_id AND idempotency_key = p_idempotency_key
          LIMIT 1;
          IF FOUND THEN
            IF v_existing.player_id = p_player_id
               AND v_existing.entry_number = p_entry_number
               AND COALESCE(v_existing.street, 'preflop') = COALESCE(p_street, 'preflop')
               AND v_existing.action_type = p_action_type
               AND COALESCE(v_existing.action_amount, 0) = COALESCE(p_action_amount, 0)
               AND v_existing.action_order = p_action_order THEN
              RETURN jsonb_build_object('status', 'success', 'duplicate', true, 'trace_id', p_trace_id);
            END IF;
            RETURN jsonb_build_object('error', 'idempotency_key_conflict', 'trace_id', p_trace_id);
          END IF;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.hand_players
          WHERE hand_id = p_hand_id AND player_id = p_player_id AND entry_number = p_entry_number
        ) THEN
          RETURN jsonb_build_object('error', 'Player not found in this hand', 'trace_id', p_trace_id);
        END IF;
        IF p_action_order IS NULL OR p_action_order < 1 THEN
          RETURN jsonb_build_object('error', 'Invalid action_order', 'trace_id', p_trace_id);
        END IF;

        BEGIN
          INSERT INTO public.hand_actions (
            hand_id, player_id, entry_number, street, action_type, action_amount,
            action_order, idempotency_key, trace_id
          ) VALUES (
            p_hand_id, p_player_id, p_entry_number, COALESCE(p_street, 'preflop'),
            p_action_type, COALESCE(p_action_amount, 0), p_action_order,
            p_idempotency_key, p_trace_id
          );
        EXCEPTION WHEN unique_violation THEN
          IF p_idempotency_key IS NOT NULL THEN
            SELECT * INTO v_existing
            FROM public.hand_actions
            WHERE hand_id = p_hand_id AND idempotency_key = p_idempotency_key
            LIMIT 1;
            IF FOUND AND v_existing.player_id = p_player_id
               AND v_existing.entry_number = p_entry_number
               AND COALESCE(v_existing.street, 'preflop') = COALESCE(p_street, 'preflop')
               AND v_existing.action_type = p_action_type
               AND COALESCE(v_existing.action_amount, 0) = COALESCE(p_action_amount, 0)
               AND v_existing.action_order = p_action_order THEN
              RETURN jsonb_build_object('status', 'success', 'duplicate', true, 'trace_id', p_trace_id);
            END IF;
            RETURN jsonb_build_object('error', 'idempotency_key_conflict', 'trace_id', p_trace_id);
          END IF;
          RETURN jsonb_build_object(
            'error', 'action_order_conflict',
            'reason', 'Another action already exists at this action_order',
            'trace_id', p_trace_id
          );
        END;

        RETURN jsonb_build_object('status', 'success', 'trace_id', p_trace_id);
      END;
      $body$;
    $definition$;
  ELSE
    v_record_action := pg_get_functiondef(
      'public.record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)'::regprocedure
    );
    v_heartbeat := pg_get_functiondef('public.heartbeat_lock(uuid,uuid)'::regprocedure);
    IF position('auth.uid()' IN v_record_action) = 0
       OR position('actor_mismatch' IN v_record_action) = 0
       OR position('tracker_lock_required' IN v_record_action) = 0
       OR position('tracker_lock_blocks' IN v_record_action) > 0
       OR position('UPDATE public.tournament_hands' IN v_record_action) > 0
       OR position('auth.uid()' IN v_heartbeat) = 0
       OR position('actor_mismatch' IN v_heartbeat) = 0 THEN
      RAISE EXCEPTION 'tracker authority hotfix requires hardened Voice-era record_action and heartbeat_lock definitions';
    END IF;
  END IF;
END;
$authority_hotfix$;

REVOKE ALL ON FUNCTION public.heartbeat_lock(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_lock(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.record_action(
  UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT, UUID
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_action(
  UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT, UUID
) TO authenticated;

COMMIT;
