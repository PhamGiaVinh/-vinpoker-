-- ============================================================================
-- 20260907000000_op_submit_action_settlement_seat_writeback.sql
--
-- GE-2I settlement seat writeback. Follow-up to
--   20260820000000_online_poker_runtime_rpcs.sql  (original op_submit_action)
--   20260820000002_op_submit_action_chip_conservation_filter.sql  (N2 post-sum fix)
--
-- WHAT (the GE-2H spec finding, P0 chip-conservation / stale-cashout leak):
--   op_submit_action persists each action into online_poker_hand_seats.stack, and on
--   the completing action flips online_poker_hands.status to 'complete'. But it never
--   writes the FINAL per-seat stacks back to online_poker_seats.stack — the table seat
--   that op_start_hand reads for the NEXT hand's buy-in and that op_stand_up cashes out.
--   So after a hand: (a) the next hand would deal STALE stacks (pre-hand buy-in, not the
--   carried result), and (b) a winner/loser standing up would cash out their ORIGINAL
--   buy-in instead of their settled stack — chips created/destroyed at the table boundary.
--
-- FIX: when the new state's status is 'complete', reconcile each dealt seat's final
--   online_poker_hand_seats.stack back into online_poker_seats.stack, atomically inside
--   the same op_submit_action transaction that completes the hand.
--
-- IDEMPOTENCY (no double-apply):
--   * The function's existing top-level idempotency guard returns the STORED response for
--     a replayed key without re-executing the body, so the writeback runs at most once
--     per unique completing action.
--   * The writeback SETs the final stack (it does NOT increment), so it is naturally
--     idempotent — re-running it on an already-settled seat is a no-op.
--   * Once the hand is 'complete', the G4(c) hand-active guard rejects any further
--     op_submit_action on that hand ('hand_not_active'), so the completion path (and its
--     writeback) cannot run twice for the same hand.
--
-- CHIP CONSERVATION:
--   The engine guarantees Σ(final hand-seat stacks) = Σ(starting hand-seat stacks), and
--   op_start_hand seeded each starting stack FROM online_poker_seats.stack. The writeback
--   therefore restores Σ(online_poker_seats.stack over the dealt seats) to exactly its
--   pre-hand value — chips only move BETWEEN seats, never in/out. Wallets and
--   online_poker_chip_ledger are untouched (only op_sit_down / op_stand_up cross the
--   table↔wallet boundary). The G4(f) in-hand chip-conservation backstop is unchanged.
--
-- SAFE-MATCH: the writeback joins online_poker_seats on (table_id, seat_no, user_id), so a
--   seat vacated mid-hand (a FOLDED player who stood up → seat becomes empty, user_id NULL)
--   or re-occupied by a different player is NEVER overwritten by the old occupant's stack.
--
-- SCOPE: stack writeback ONLY. Seat status is left unchanged (a busted seat stays
--   'sitting' with stack 0; op_start_hand already excludes it via its stack>0 filter).
--   Auto-sitting_out of busted seats and the mid-hand folded-stand-up over-cashout are
--   documented follow-ups (see docs/online-poker/GE2I_SETTLEMENT_WRITEBACK_VERIFICATION.md),
--   intentionally OUT of this single-purpose patch.
--
-- This is the ONLY change vs 20260820000002 (which is itself 20260820000000 + the N2
-- post-sum filter). Every other line of op_submit_action is reproduced verbatim
-- (CREATE OR REPLACE needs the full body). All G4 backstops are unchanged.
--
-- SAFETY: the runtime is DARK (online_poker_config.enabled=false); op_submit_action is
-- never executed in production yet, so this carries no behavioural risk. Pure additive
-- correctness hardening, applied (later, owner-gated) before any closed-alpha enablement.
--
-- Slot note: originally authored at 20260906000000 (#210), but a parallel payroll session
-- (PR #213, 20260906000000_payroll_p2_open_shift_standard.sql) landed on the SAME slot,
-- creating a duplicate-version collision on main. This engine migration is moved to the
-- next free slot 20260907000000 to de-collide (the payroll slot is left untouched).
-- Neither is applied (live schema_migrations max is 20260820000002). NOT applied by this PR.
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

  -- GE-2I settlement seat writeback. When the engine flips the hand to 'complete',
  -- reconcile each dealt seat's FINAL stack (just persisted above into
  -- online_poker_hand_seats) back to the table seat (online_poker_seats), which
  -- op_start_hand reads for the next buy-in and op_stand_up cashes out. SET (not
  -- increment) ⇒ idempotent; the idempotency + hand-active guards make it run exactly
  -- once per completed hand. Match on user_id so a seat vacated mid-hand (folded
  -- stand-up) or re-occupied by a new player is never overwritten. Σ(table seat stacks)
  -- is conserved (engine guarantees Σ final = Σ starting = pre-hand seat stacks);
  -- wallets / chip ledger are untouched.
  IF p_new_state->>'status' = 'complete' THEN
    UPDATE public.online_poker_seats s SET
      stack = hs.stack
    FROM public.online_poker_hand_seats hs
    WHERE hs.hand_id = p_hand_id
      AND s.table_id = v_hand.table_id
      AND s.seat_no  = hs.seat_no
      AND s.user_id  = hs.user_id;
  END IF;

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
