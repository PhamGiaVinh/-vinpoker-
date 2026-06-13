-- ============================================================================
-- ROLLBACK for 20260820000002_op_submit_action_chip_conservation_filter.sql
--
-- Restores op_submit_action to its pre-N2-fix body (the 20260820000000 version)
-- by re-creating it with the UNFILTERED post-sum. Only run this to revert the N2
-- safety patch — it reintroduces the latent over-count described in that migration.
-- The runtime is dark (enabled=false), so applying or reverting has no behavioural
-- impact until enablement. Idempotent (CREATE OR REPLACE).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.op_submit_action(
  p_hand_id               uuid,
  p_actor_user_id         uuid,
  p_action                jsonb,
  p_new_state             jsonb,
  p_board_future          jsonb,
  p_events                jsonb,
  p_expected_state_version int,
  p_act_deadline          timestamptz,
  p_idempotency_key       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hand       public.online_poker_hands%ROWTYPE;
  v_seat       int := (p_action->>'seat')::int;
  v_seat_owner uuid;
  v_pre_total  bigint;
  v_post_total bigint;
  v_seq_start  int;
  v_existing   jsonb;
  v_response   jsonb;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  SELECT response INTO v_existing FROM public.online_poker_actions
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN COALESCE(v_existing, jsonb_build_object('outcome', 'duplicate'));
  END IF;

  SELECT * INTO v_hand FROM public.online_poker_hands WHERE id = p_hand_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_hand.status NOT IN ('dealing', 'betting') THEN
    RETURN jsonb_build_object('outcome', 'hand_not_active', 'status', v_hand.status);
  END IF;

  IF v_hand.state_version <> p_expected_state_version THEN
    RETURN jsonb_build_object('outcome', 'race_lost',
      'expected', p_expected_state_version, 'actual', v_hand.state_version);
  END IF;

  SELECT user_id INTO v_seat_owner FROM public.online_poker_hand_seats
  WHERE hand_id = p_hand_id AND seat_no = v_seat;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'seat_not_in_hand', 'seat', v_seat);
  END IF;
  IF v_seat_owner IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'actor does not own seat');
  END IF;

  IF p_new_state ? 'deck'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_state->'seats') s WHERE s ? 'holeCards') THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'public state carries secret data');
  END IF;

  IF (p_new_state->>'pot')::bigint < 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_state->'seats') s
                WHERE (s->>'stack')::bigint < 0) THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'negative stack/pot');
  END IF;

  -- ORIGINAL (pre-N2) UNFILTERED post-sum:
  SELECT COALESCE(SUM(stack), 0) + v_hand.pot INTO v_pre_total
  FROM public.online_poker_hand_seats WHERE hand_id = p_hand_id;
  SELECT COALESCE(SUM((s->>'stack')::bigint), 0) + (p_new_state->>'pot')::bigint INTO v_post_total
  FROM jsonb_array_elements(p_new_state->'seats') AS s;
  IF v_pre_total <> v_post_total THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'chip conservation violated',
      'pre', v_pre_total, 'post', v_post_total);
  END IF;

  UPDATE public.online_poker_hands SET
    state = p_new_state,
    state_version = state_version + 1,
    street = p_new_state->>'street',
    board = COALESCE(p_new_state->'board', '[]'::jsonb),
    pot = (p_new_state->>'pot')::bigint,
    side_pots = COALESCE(p_new_state->'sidePots', '[]'::jsonb),
    to_act_seat = (p_new_state->>'toAct')::int,
    status = p_new_state->>'status',
    act_deadline = p_act_deadline,
    updated_at = now()
  WHERE id = p_hand_id AND state_version = p_expected_state_version;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'race_lost');
  END IF;

  UPDATE public.online_poker_hand_seats hs SET
    stack = (s->>'stack')::bigint,
    committed = (s->>'committed')::bigint,
    total_committed = (s->>'totalCommitted')::bigint,
    status = s->>'status',
    revealed_cards = CASE WHEN s ? 'revealedCards' THEN s->'revealedCards' ELSE hs.revealed_cards END
  FROM jsonb_array_elements(p_new_state->'seats') AS s
  WHERE hs.hand_id = p_hand_id AND hs.seat_no = (s->>'seat')::int
    AND (s->>'status') IN ('active', 'folded', 'allin');

  SELECT COALESCE(MAX(event_seq) + 1, 0) INTO v_seq_start
  FROM public.online_poker_hand_events WHERE hand_id = p_hand_id;
  INSERT INTO public.online_poker_hand_events (hand_id, event_seq, type, payload)
  SELECT p_hand_id, v_seq_start + (t.ord - 1)::int, t.e->>'type', COALESCE(t.e->'payload', '{}'::jsonb)
  FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, ord);

  UPDATE public.online_poker_hand_secrets
  SET cards = p_board_future
  WHERE hand_id = p_hand_id AND kind = 'board_future';

  v_response := jsonb_build_object('outcome', 'ok', 'hand_id', p_hand_id,
    'state_version', v_hand.state_version + 1);
  INSERT INTO public.online_poker_actions (hand_id, user_id, idempotency_key, action, response)
  VALUES (p_hand_id, p_actor_user_id, p_idempotency_key, p_action, v_response);

  RETURN v_response;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) TO service_role;

COMMIT;

-- Then remove the version row:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260820000002';
