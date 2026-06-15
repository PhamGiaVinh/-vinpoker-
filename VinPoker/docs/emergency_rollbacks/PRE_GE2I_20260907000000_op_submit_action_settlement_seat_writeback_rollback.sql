-- ============================================================================
-- PRE_GE2I_20260907000000_op_submit_action_settlement_seat_writeback_rollback.sql
--
-- ROLLBACK for 20260907000000_op_submit_action_settlement_seat_writeback.sql.
--
-- Restores op_submit_action to its PRE-GE-2I definition — i.e. the
-- 20260820000002 (N2 chip-conservation filter) body, WITHOUT the settlement seat
-- writeback block. This is a CREATE OR REPLACE back to the prior function source,
-- byte-for-byte equal to 20260820000002's body. Run only if the GE-2I patch must be
-- reverted after a (future, owner-gated) live apply.
--
-- SAFETY: function-body only. No data change, no schema change, no schema_migrations
-- edit beyond deleting the GE-2I version row if one was recorded at apply time
-- (see the final optional statement). The runtime is play-money + dark; reverting the
-- writeback re-opens the GE-2H stale-cashout finding, so only roll back if the GE-2I
-- body itself is implicated.
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

  -- Idempotency: a replayed key returns the stored response, never re-applies.
  SELECT response INTO v_existing FROM public.online_poker_actions
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN COALESCE(v_existing, jsonb_build_object('outcome', 'duplicate'));
  END IF;

  -- Lock the hand row.
  SELECT * INTO v_hand FROM public.online_poker_hands WHERE id = p_hand_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- G4(c): hand still active.
  IF v_hand.status NOT IN ('dealing', 'betting') THEN
    RETURN jsonb_build_object('outcome', 'hand_not_active', 'status', v_hand.status);
  END IF;

  -- G4(a): optimistic CAS.
  IF v_hand.state_version <> p_expected_state_version THEN
    RETURN jsonb_build_object('outcome', 'race_lost',
      'expected', p_expected_state_version, 'actual', v_hand.state_version);
  END IF;

  -- G4(d) + G4(b): the action's seat exists in this hand AND is owned by the actor.
  SELECT user_id INTO v_seat_owner FROM public.online_poker_hand_seats
  WHERE hand_id = p_hand_id AND seat_no = v_seat;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'seat_not_in_hand', 'seat', v_seat);
  END IF;
  IF v_seat_owner IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'actor does not own seat');
  END IF;

  -- G4(h): the new PUBLIC state must not carry secret data.
  IF p_new_state ? 'deck'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_state->'seats') s WHERE s ? 'holeCards') THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'public state carries secret data');
  END IF;

  -- G4(e): no negative stack/pot in the new state.
  IF (p_new_state->>'pot')::bigint < 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_new_state->'seats') s
                WHERE (s->>'stack')::bigint < 0) THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'negative stack/pot');
  END IF;

  -- G4(f): chip conservation — Σ(seat stacks) + pot unchanged across the action.
  -- N2 fix: the post-sum is filtered to the SAME statuses the pre-sum (dealt seats in
  -- online_poker_hand_seats) and the persist UPDATE use, so a stray sitting_out/empty
  -- wire seat can never over-count and false-reject a valid action.
  SELECT COALESCE(SUM(stack), 0) + v_hand.pot INTO v_pre_total
  FROM public.online_poker_hand_seats WHERE hand_id = p_hand_id;
  SELECT COALESCE(SUM((s->>'stack')::bigint), 0) + (p_new_state->>'pot')::bigint INTO v_post_total
  FROM jsonb_array_elements(p_new_state->'seats') AS s
  WHERE (s->>'status') IN ('active', 'folded', 'allin');
  IF v_pre_total <> v_post_total THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'chip conservation violated',
      'pre', v_pre_total, 'post', v_post_total);
  END IF;

  -- Persist public rails (CAS re-checked in the WHERE).
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

  -- Append events. The RPC owns per-hand seq: continue from the current max
  -- (the Edge passes {type, payload} only, never a seq).
  SELECT COALESCE(MAX(event_seq) + 1, 0) INTO v_seq_start
  FROM public.online_poker_hand_events WHERE hand_id = p_hand_id;
  INSERT INTO public.online_poker_hand_events (hand_id, event_seq, type, payload)
  SELECT p_hand_id, v_seq_start + (t.ord - 1)::int, t.e->>'type', COALESCE(t.e->'payload', '{}'::jsonb)
  FROM jsonb_array_elements(p_events) WITH ORDINALITY AS t(e, ord);

  -- Advance the live remaining deck (G4(g): secret stays in the secrets table).
  UPDATE public.online_poker_hand_secrets
  SET cards = p_board_future
  WHERE hand_id = p_hand_id AND kind = 'board_future';

  -- Record the action + store the response (durable idempotency).
  v_response := jsonb_build_object('outcome', 'ok', 'hand_id', p_hand_id,
    'state_version', v_hand.state_version + 1);
  INSERT INTO public.online_poker_actions (hand_id, user_id, idempotency_key, action, response)
  VALUES (p_hand_id, p_actor_user_id, p_idempotency_key, p_action, v_response);

  RETURN v_response;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) TO service_role;

-- Optional, only if a GE-2I version row was recorded at apply time:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260907000000';

COMMIT;
