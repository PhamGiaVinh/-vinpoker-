-- ============================================================================
-- 20260820000002_op_submit_action_chip_conservation_filter.sql
--
-- GE-2C safety patch (security review finding N2 / P2). Follow-up to
-- 20260820000000_online_poker_runtime_rpcs.sql.
--
-- WHAT: in op_submit_action's G4(f) chip-conservation check, the POST-action sum
--   over p_new_state->'seats' was UNFILTERED while the persist UPDATE (and the set
--   of dealt seats in online_poker_hand_seats) only ever covers seats whose status
--   is in ('active','folded','allin'). If a wire state ever carried an extra
--   sitting_out/empty seat with a non-zero stack, the post-sum would over-count and
--   FALSE-REJECT a legitimate action with 'chip conservation violated'.
--
-- FIX: filter the post-sum to the same statuses the pre-sum/persist use:
--        WHERE (s->>'status') IN ('active','folded','allin')
--   so Σ(persisted seat stacks)+pot is compared symmetrically on both sides.
--
-- This is the ONLY change vs 20260820000000; every other line of op_submit_action
-- is reproduced verbatim (CREATE OR REPLACE needs the full body). All G4 backstops
-- (idempotency, FOR UPDATE, CAS, seat-ownership, hand-active, no-secret, no-negative)
-- are unchanged.
--
-- SAFETY: the runtime is DARK (online_poker_config.enabled=false); op_submit_action
-- is never executed in production yet, so this carries no behavioural risk. It is a
-- pure additive correctness hardening applied before any closed-alpha enablement.
--
-- Slot note: the security review suggested 20260820000001, but that slot was taken
-- by 20260820000001_game_tables_opened_at on origin/main; this patch uses the next
-- free in-day slot 20260820000002 (verified free in source AND live schema_migrations).
-- ============================================================================

BEGIN;

-- op_submit_action — apply ONE engine-computed action atomically. Carries the
-- REQUIRED G4 backstops so a serialize bug can never persist a corrupt state.
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

-- Re-assert the service-role-only grant (CREATE OR REPLACE preserves ACL; this makes
-- the migration self-contained and idempotent if ever replayed on a fresh DB).
REVOKE EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) TO service_role;

COMMIT;
