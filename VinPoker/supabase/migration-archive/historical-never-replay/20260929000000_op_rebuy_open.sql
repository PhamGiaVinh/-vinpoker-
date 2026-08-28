-- 20260929000000_op_rebuy_open.sql
-- E5 — Online poker friends-practice REBUY (source-only; NOT applied by this PR).
--
-- A seated player who has BUSTED (seat stack = 0) can re-buy a fresh stack to keep
-- playing. Server-authoritative and deliberately minimal/safe for the wallet-free
-- friends-practice model:
--   * AMOUNT IS SERVER-DICTATED — must equal the table's fixed starting_stack_default.
--     The client cannot pick an arbitrary amount (no wallet/ledger/buy-in rules yet).
--   * BUSTED-ONLY + SET (never ADD): stack is SET to the starting stack and only when
--     it is currently 0, so it is idempotent (set-twice = same) and a player who still
--     has chips can never reset their stack (returns 'has_chips').
--   * NO REBUY MID-HAND: blocked while the seat is still contesting a live hand
--     (mirrors op_leave_open_table's guard exactly).
--   * auth.uid()-bound, op_is_enabled()-gated, SECURITY DEFINER, search_path locked,
--     EXECUTE granted to authenticated + service_role only (never anon/PUBLIC).
--
-- Idempotent CREATE OR REPLACE. Rollback: DROP FUNCTION public.op_rebuy_open(uuid,bigint,text);
--
-- APPLY (owner-gated, E5B): apply this single function via a controlled Management-API
-- op, verify body/grants/search_path, leave schema_migrations untouched. Do NOT
-- supabase db push / deploy_db=true.

CREATE OR REPLACE FUNCTION public.op_rebuy_open(
  p_table_id        uuid,
  p_amount          bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_table public.online_poker_tables%ROWTYPE;
  v_seat  public.online_poker_seats%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  SELECT * INTO v_table FROM public.online_poker_tables WHERE id = p_table_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'table_not_found');
  END IF;
  IF v_table.status <> 'open' THEN
    RETURN jsonb_build_object('outcome', 'table_not_open');
  END IF;

  -- Amount is SERVER-DICTATED: it must equal the table's fixed starting stack. This
  -- removes any client-chosen amount path (no arbitrary stack sizing without buy-in rules).
  IF v_table.starting_stack_default < 1 OR p_amount <> v_table.starting_stack_default THEN
    RETURN jsonb_build_object('outcome', 'bad_amount', 'expected', v_table.starting_stack_default::text);
  END IF;

  SELECT * INTO v_seat FROM public.online_poker_seats
  WHERE table_id = p_table_id AND user_id = v_uid AND status IN ('sitting', 'sitting_out')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_seated');
  END IF;

  -- Cannot rebuy while still contesting an active hand (mirror op_leave_open_table).
  IF EXISTS (
    SELECT 1 FROM public.online_poker_hands h
    JOIN public.online_poker_hand_seats hs ON hs.hand_id = h.id
    WHERE h.table_id = p_table_id AND h.status IN ('dealing', 'betting')
      AND hs.seat_no = v_seat.seat_no AND hs.status IN ('active', 'allin')
  ) THEN
    RETURN jsonb_build_object('outcome', 'in_active_hand');
  END IF;

  -- Busted-only: SET (idempotent), never ADD. A player with chips cannot rebuy.
  IF v_seat.stack <> 0 THEN
    RETURN jsonb_build_object('outcome', 'has_chips', 'stack', v_seat.stack::text);
  END IF;

  UPDATE public.online_poker_seats
  SET stack = v_table.starting_stack_default, status = 'sitting'
  WHERE id = v_seat.id;

  RETURN jsonb_build_object('outcome', 'ok', 'stack', v_table.starting_stack_default::text);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.op_rebuy_open(uuid, bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.op_rebuy_open(uuid, bigint, text) TO authenticated, service_role;
