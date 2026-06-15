-- ============================================================================
-- 20260908000000_op_stand_up_block_folded_midhand.sql
--
-- GE-2J — close the mid-hand folded stand-up over-cashout (the residual flagged by
-- GE-2I). Follow-up to 20260820000000_online_poker_runtime_rpcs.sql (original op_stand_up)
-- and complementary to 20260907000000 (GE-2I settlement seat writeback).
--
-- WHAT: op_stand_up's "cannot leave during an active hand" guard only blocked seats with
--   hand status IN ('active','allin'). A FOLDED player (hand-seat status 'folded') could
--   stand up MID-HAND and cash out v_seat.stack = online_poker_seats.stack — which is the
--   PRE-HAND buy-in (seats.stack is never decremented during a hand). So a player could
--   fold (committing chips to the pot), leave immediately, and recover their FULL buy-in:
--   a chip-conservation / over-cashout leak.
--
-- FIX (one change): widen the guard's status set from ('active','allin') to
--   ('active','folded','allin') — i.e. block stand-up for ANY seat DEALT INTO an active
--   hand. A folded player now waits until the hand completes; at completion the GE-2I
--   writeback (20260907000000) has already set online_poker_seats.stack to the correct
--   FINAL amount, so the subsequent stand-up cashes out the right value. Once the hand is
--   'complete' the guard's h.status IN ('dealing','betting') no longer matches, so leaving
--   is allowed again. Sitting-out players (never dealt into the hand) are unaffected — they
--   have no online_poker_hand_seats row in the active hand.
--
-- DEPENDENCY: this patch only CLOSES THE MID-HAND ESCAPE WINDOW; the correctness of the
--   eventual cash-out depends on GE-2I (20260907000000) having written the final stack back
--   to online_poker_seats. Apply both before any closed-alpha enablement. GE-2J alone (no
--   GE-2I) would merely DELAY a folded player's cash-out without fixing the stale amount.
--
-- This is the ONLY change vs the 20260820000000 op_stand_up body (reproduced verbatim;
-- CREATE OR REPLACE needs the full body). Idempotency (ledger-key), the not_seated check,
-- the wallet cash-out, and the seat clear are unchanged.
--
-- SAFETY: the runtime is DARK (online_poker_config.enabled=false); op_stand_up is never
-- executed in production yet, so this carries no behavioural risk. Pure correctness
-- hardening, applied (later, owner-gated) before any closed-alpha enablement.
--
-- Slot note: GE-2I occupies 20260907000000 (after the de-collision from 20260906000000,
-- which a parallel payroll migration #213 also took). This GE-2J patch uses the next free
-- slot 20260908000000. Live schema_migrations max is 20260820000002, so this is unapplied
-- like every slot after it. NOT applied by this PR.
-- ============================================================================

BEGIN;

-- op_stand_up — leave a seat and cash the seat stack back to the play wallet.
CREATE OR REPLACE FUNCTION public.op_stand_up(
  p_table_id        uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_seat    public.online_poker_seats%ROWTYPE;
  v_balance bigint;
  v_new_bal bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  IF EXISTS (SELECT 1 FROM public.online_poker_chip_ledger WHERE idempotency_key = p_idempotency_key) THEN
    RETURN jsonb_build_object('outcome', 'ok', 'idempotent', true);
  END IF;

  SELECT * INTO v_seat FROM public.online_poker_seats
  WHERE table_id = p_table_id AND user_id = v_uid AND status IN ('sitting', 'sitting_out')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_seated');
  END IF;

  -- Cannot stand up while DEALT INTO an active hand. GE-2J: include 'folded' (was
  -- ('active','allin') only) so a folded player can no longer leave mid-hand and cash out
  -- a STALE online_poker_seats.stack (= pre-hand buy-in). They wait until the hand
  -- completes — at which point the GE-2I writeback (20260907000000) has set seats.stack to
  -- the correct final amount — then stand up and cash out correctly. Sitting-out players
  -- (not dealt in) are unaffected: they have no hand_seats row in the active hand.
  IF EXISTS (
    SELECT 1 FROM public.online_poker_hands h
    JOIN public.online_poker_hand_seats hs ON hs.hand_id = h.id
    WHERE h.table_id = p_table_id AND h.status IN ('dealing', 'betting')
      AND hs.seat_no = v_seat.seat_no AND hs.status IN ('active', 'folded', 'allin')
  ) THEN
    RETURN jsonb_build_object('outcome', 'in_active_hand');
  END IF;

  -- Cash seat stack back to the wallet (play money).
  INSERT INTO public.online_poker_player_accounts (user_id, balance) VALUES (v_uid, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO v_balance FROM public.online_poker_player_accounts
  WHERE user_id = v_uid FOR UPDATE;
  v_new_bal := v_balance + v_seat.stack;
  UPDATE public.online_poker_player_accounts SET balance = v_new_bal, updated_at = now()
  WHERE user_id = v_uid;
  IF v_seat.stack > 0 THEN
    INSERT INTO public.online_poker_chip_ledger (user_id, table_id, type, amount, balance_after, idempotency_key)
    VALUES (v_uid, p_table_id, 'cashout', v_seat.stack, v_new_bal, p_idempotency_key);
  END IF;

  UPDATE public.online_poker_seats
  SET user_id = NULL, stack = 0, status = 'empty'
  WHERE id = v_seat.id;

  RETURN jsonb_build_object('outcome', 'ok', 'cashed_out', v_seat.stack::text, 'wallet', v_new_bal::text);
END;
$$;

-- Re-assert the self-RPC grants (CREATE OR REPLACE preserves ACL; this makes the migration
-- self-contained and idempotent if ever replayed on a fresh DB).
REVOKE EXECUTE ON FUNCTION public.op_stand_up(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.op_stand_up(uuid, text) TO authenticated, service_role;

COMMIT;
