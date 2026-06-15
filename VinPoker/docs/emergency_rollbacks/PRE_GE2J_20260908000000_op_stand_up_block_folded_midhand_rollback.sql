-- ============================================================================
-- PRE_GE2J_20260908000000_op_stand_up_block_folded_midhand_rollback.sql
--
-- ROLLBACK for 20260908000000_op_stand_up_block_folded_midhand.sql.
--
-- Restores op_stand_up to its PRE-GE-2J definition — the 20260820000000 body, whose
-- active-hand guard blocks only ('active','allin') seats (folded players could stand up
-- mid-hand). CREATE OR REPLACE back to the prior source, byte-for-byte equal to the
-- 20260820000000 op_stand_up body. Run only if the GE-2J patch must be reverted after a
-- (future, owner-gated) live apply.
--
-- WARNING: reverting re-opens the mid-hand folded stand-up over-cashout. Only roll back if
-- the GE-2J body itself is implicated.
--
-- SAFETY: function-body only. No data/schema change. The runtime is play-money + dark.
-- ============================================================================

BEGIN;

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

  -- Cannot stand up while still contesting an active hand.
  IF EXISTS (
    SELECT 1 FROM public.online_poker_hands h
    JOIN public.online_poker_hand_seats hs ON hs.hand_id = h.id
    WHERE h.table_id = p_table_id AND h.status IN ('dealing', 'betting')
      AND hs.seat_no = v_seat.seat_no AND hs.status IN ('active', 'allin')
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

REVOKE EXECUTE ON FUNCTION public.op_stand_up(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.op_stand_up(uuid, text) TO authenticated, service_role;

-- Optional, only if a GE-2J version row was recorded at apply time:
-- DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260908000000';

COMMIT;
