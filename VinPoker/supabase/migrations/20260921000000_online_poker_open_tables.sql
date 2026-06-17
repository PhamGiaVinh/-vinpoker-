-- ============================================================================
-- 20260921000000_online_poker_open_tables.sql
--
-- Online poker "friends practice" model: OPEN tables with a transferable HOST,
-- and WALLET-FREE seating. Replaces the buggy daily-chips / preset-table flow.
--
--   * A player CREATES an open table, choosing the blinds + their own starting
--     chips, and becomes the host (first sitter).
--   * Any player can sit at an empty seat DIRECTLY (no approval), choosing their
--     own chip amount. No wallet, no daily grant, no chip ledger — chips are just
--     agreed numbers for practice (non-persistent across sits).
--   * The host can TRANSFER the host role to another seated player.
--   * When the host leaves, the host role AUTO-REASSIGNS to the remaining seated
--     player with the lowest seat number (or NULL if the table empties).
--
-- The in-hand chip-conservation invariant is still enforced by the engine; this
-- migration only changes how a seat is funded (self-set stack, no wallet move).
--
-- The legacy op_sit_down / op_stand_up / op_claim_daily_chips are LEFT INTACT but
-- become dormant (the frontend stops calling them). Additive + idempotent.
--
-- SECURITY: every RPC is SECURITY DEFINER + search_path=public, auth.uid()-bound,
-- gated by op_is_enabled(); EXECUTE granted to authenticated + service_role only
-- (the Edge calls them with the USER client so auth.uid() binds).
--
-- ROLLBACK (manual):
--   DROP FUNCTION IF EXISTS public.op_create_open_table(text,bigint,bigint,bigint,int);
--   DROP FUNCTION IF EXISTS public.op_sit_open(uuid,int,bigint,text);
--   DROP FUNCTION IF EXISTS public.op_transfer_host(uuid,uuid);
--   DROP FUNCTION IF EXISTS public.op_leave_open_table(uuid);
--   ALTER TABLE public.online_poker_tables DROP COLUMN IF EXISTS host_user_id;
-- ============================================================================

BEGIN;

-- Mutable current host (created_by stays as the immutable original creator).
ALTER TABLE public.online_poker_tables
  ADD COLUMN IF NOT EXISTS host_user_id uuid REFERENCES auth.users(id);

-- A sane technical ceiling on practice chips (avoid silly / overflow values).
-- 1e9 fits comfortably in bigint and in JS Number for display.
-- (No floor constant needed; each RPC checks p_buyin >= 1 inline.)

-- ── op_create_open_table ────────────────────────────────────────────────────
-- Create an open table (host = caller) and seat the caller at seat 1.
CREATE OR REPLACE FUNCTION public.op_create_open_table(
  p_name      text,
  p_sb        bigint,
  p_bb        bigint,
  p_buyin     bigint,
  p_max_seats int DEFAULT 9
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_name   text;
  v_table  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  IF p_sb <= 0 OR p_bb <= p_sb THEN
    RETURN jsonb_build_object('outcome', 'bad_blinds');
  END IF;
  IF p_buyin < 1 OR p_buyin > 1000000000 THEN
    RETURN jsonb_build_object('outcome', 'bad_buyin');
  END IF;
  IF p_max_seats < 2 OR p_max_seats > 10 THEN
    RETURN jsonb_build_object('outcome', 'bad_max_seats');
  END IF;

  v_name := NULLIF(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN v_name := 'Bàn của bạn'; END IF;
  IF length(v_name) > 40 THEN v_name := left(v_name, 40); END IF;

  INSERT INTO public.online_poker_tables (
    club_id, name, max_seats, sb, bb, min_buyin, max_buyin,
    starting_stack_default, act_timeout_secs, status, created_by, host_user_id
  ) VALUES (
    NULL, v_name, p_max_seats, p_sb, p_bb, 1, 1000000000,
    p_buyin, 30, 'open', v_uid, v_uid
  ) RETURNING id INTO v_table;

  -- Seat the creator at seat 1 (wallet-free).
  INSERT INTO public.online_poker_seats (table_id, seat_no, user_id, stack, status)
  VALUES (v_table, 1, v_uid, p_buyin, 'sitting');

  RETURN jsonb_build_object('outcome', 'ok', 'table_id', v_table, 'seat_no', 1);
END;
$$;

-- ── op_sit_open ─────────────────────────────────────────────────────────────
-- Sit directly at an empty seat with a self-chosen stack (no wallet, no ledger).
-- First sitter at a host-less table becomes the host.
CREATE OR REPLACE FUNCTION public.op_sit_open(
  p_table_id        uuid,
  p_seat_no         int,
  p_buyin           bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_table   public.online_poker_tables%ROWTYPE;
  v_mine    public.online_poker_seats%ROWTYPE;
  v_claimed uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;
  IF p_buyin < 1 OR p_buyin > 1000000000 THEN
    RETURN jsonb_build_object('outcome', 'bad_buyin');
  END IF;

  SELECT * INTO v_table FROM public.online_poker_tables WHERE id = p_table_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'table_not_found');
  END IF;
  IF v_table.status <> 'open' THEN
    RETURN jsonb_build_object('outcome', 'table_not_open');
  END IF;
  IF p_seat_no < 1 OR p_seat_no > v_table.max_seats THEN
    RETURN jsonb_build_object('outcome', 'bad_seat');
  END IF;

  -- Already seated at this table? Idempotent if it's the same seat; else reject.
  SELECT * INTO v_mine FROM public.online_poker_seats
  WHERE table_id = p_table_id AND user_id = v_uid AND status IN ('sitting', 'sitting_out');
  IF FOUND THEN
    IF v_mine.seat_no = p_seat_no THEN
      RETURN jsonb_build_object('outcome', 'ok', 'seat', p_seat_no, 'stack', v_mine.stack::text, 'idempotent', true);
    END IF;
    RETURN jsonb_build_object('outcome', 'already_seated');
  END IF;

  -- Claim the seat only if empty (insert the row if it does not exist yet).
  INSERT INTO public.online_poker_seats (table_id, seat_no, user_id, stack, status)
  VALUES (p_table_id, p_seat_no, v_uid, p_buyin, 'sitting')
  ON CONFLICT (table_id, seat_no) DO UPDATE
    SET user_id = EXCLUDED.user_id, stack = EXCLUDED.stack, status = 'sitting', joined_at = now()
    WHERE public.online_poker_seats.status = 'empty' AND public.online_poker_seats.user_id IS NULL
  RETURNING id INTO v_claimed;
  IF v_claimed IS NULL THEN
    RETURN jsonb_build_object('outcome', 'seat_taken');
  END IF;

  -- First sitter at a host-less table becomes the host.
  UPDATE public.online_poker_tables
  SET host_user_id = v_uid
  WHERE id = p_table_id AND host_user_id IS NULL;

  RETURN jsonb_build_object('outcome', 'ok', 'seat', p_seat_no, 'stack', p_buyin::text);
END;
$$;

-- ── op_transfer_host ────────────────────────────────────────────────────────
-- The current host hands the host role to another seated player.
CREATE OR REPLACE FUNCTION public.op_transfer_host(
  p_table_id   uuid,
  p_to_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_host uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  SELECT host_user_id INTO v_host FROM public.online_poker_tables WHERE id = p_table_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'table_not_found');
  END IF;
  IF v_host IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('outcome', 'not_host');
  END IF;
  IF p_to_user_id = v_uid THEN
    RETURN jsonb_build_object('outcome', 'ok', 'host_user_id', v_uid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.online_poker_seats
    WHERE table_id = p_table_id AND user_id = p_to_user_id AND status IN ('sitting', 'sitting_out')
  ) THEN
    RETURN jsonb_build_object('outcome', 'target_not_seated');
  END IF;

  UPDATE public.online_poker_tables SET host_user_id = p_to_user_id WHERE id = p_table_id;
  RETURN jsonb_build_object('outcome', 'ok', 'host_user_id', p_to_user_id);
END;
$$;

-- ── op_leave_open_table ─────────────────────────────────────────────────────
-- Leave a seat (wallet-free); auto-reassign the host if the leaver was host.
CREATE OR REPLACE FUNCTION public.op_leave_open_table(
  p_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_seat     public.online_poker_seats%ROWTYPE;
  v_host     uuid;
  v_new_host uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  SELECT * INTO v_seat FROM public.online_poker_seats
  WHERE table_id = p_table_id AND user_id = v_uid AND status IN ('sitting', 'sitting_out')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_seated');
  END IF;

  -- Cannot leave while still contesting an active hand.
  IF EXISTS (
    SELECT 1 FROM public.online_poker_hands h
    JOIN public.online_poker_hand_seats hs ON hs.hand_id = h.id
    WHERE h.table_id = p_table_id AND h.status IN ('dealing', 'betting')
      AND hs.seat_no = v_seat.seat_no AND hs.status IN ('active', 'allin')
  ) THEN
    RETURN jsonb_build_object('outcome', 'in_active_hand');
  END IF;

  -- Clear the seat (chips simply vanish — practice money, no wallet).
  UPDATE public.online_poker_seats
  SET user_id = NULL, stack = 0, status = 'empty'
  WHERE id = v_seat.id;

  -- If the leaver was the host, reassign to the lowest-seat remaining player.
  SELECT host_user_id INTO v_host FROM public.online_poker_tables WHERE id = p_table_id FOR UPDATE;
  IF v_host = v_uid THEN
    SELECT user_id INTO v_new_host FROM public.online_poker_seats
    WHERE table_id = p_table_id AND user_id IS NOT NULL AND status IN ('sitting', 'sitting_out')
    ORDER BY seat_no ASC LIMIT 1;
    UPDATE public.online_poker_tables SET host_user_id = v_new_host WHERE id = p_table_id;
  END IF;

  RETURN jsonb_build_object('outcome', 'ok', 'host_user_id', v_new_host);
END;
$$;

-- ── grants (mirror op_sit_down: revoke PUBLIC/anon, grant authenticated + service_role) ──
REVOKE EXECUTE ON FUNCTION public.op_create_open_table(text, bigint, bigint, bigint, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_sit_open(uuid, int, bigint, text)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_transfer_host(uuid, uuid)                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_leave_open_table(uuid)                                 FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.op_create_open_table(text, bigint, bigint, bigint, int) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.op_sit_open(uuid, int, bigint, text)                      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.op_transfer_host(uuid, uuid)                              TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.op_leave_open_table(uuid)                                 TO authenticated, service_role;

COMMIT;
