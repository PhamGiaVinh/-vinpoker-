-- ============================================================================
-- 20261022000000_online_poker_buyin_log.sql
--
-- Online-poker FRIENDS-PRACTICE buy-in HISTORY (source-only; NOT applied by this PR).
--
-- The friends-practice model is wallet-free and keeps only the CURRENT seat stack
-- (which drifts as you win/lose), so there is no way to see "how many chips a player
-- has bought in". This adds a tiny append-only LEDGER (online_poker_buyins) that
-- records one row per buy-in EVENT — a 'sit' (initial buy-in when sitting / creating)
-- or a 'rebuy' — and re-defines the three funding RPCs to append to it.
--
-- It is deliberately additive + minimal:
--   * APPEND-ONLY: rows are NEVER deleted on leave, so a player's history survives a
--     leave→re-sit (a new 'sit' event simply stacks on). Per-user TOTAL buy-in = SUM
--     over the table's whole lifetime (no reset). Same display name on two rows is fine.
--   * The ledger only adds an INSERT inside each RPC; the seat funding logic is byte-
--     for-byte the live behaviour (stack/host/idempotency unchanged).
--   * Display name is resolved client-side from `profiles` (same as seats) — not stored
--     here — so a renamed/departed player still shows a current name.
--
-- SECURITY: RLS ON. SELECT is allowed to a participant of the table (a seated player
-- sees the whole table's history; anyone sees their OWN rows) — no INSERT/UPDATE/DELETE
-- policy, so ONLY the SECURITY DEFINER RPCs (which bypass RLS) ever write. The RPCs keep
-- their auth.uid()-bound, op_is_enabled()-gated, search_path-locked, authenticated+
-- service_role-only grants.
--
-- APPLY (owner-gated): apply the table + policy + the three CREATE OR REPLACE functions
-- via a controlled Management-API op; verify bodies/grants/search_path/RLS; leave
-- schema_migrations untouched. Do NOT supabase db push / deploy_db=true.
--
-- ROLLBACK (manual): re-apply the prior bodies of op_create_open_table / op_sit_open /
-- op_rebuy_open (drop the INSERT), then:
--   DROP TABLE IF EXISTS public.online_poker_buyins;
-- ============================================================================

BEGIN;

-- ── ledger table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.online_poker_buyins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   uuid NOT NULL REFERENCES public.online_poker_tables(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id),
  seat_no    int,
  kind       text   NOT NULL CHECK (kind IN ('sit', 'rebuy')),
  amount     bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_op_buyins_table_created
  ON public.online_poker_buyins (table_id, created_at);

ALTER TABLE public.online_poker_buyins ENABLE ROW LEVEL SECURITY;

-- SELECT: your own rows always; ALL rows of a table where you currently hold a seat
-- (so friends at the table can see each other's totals, incl. players who already left).
DROP POLICY IF EXISTS op_buyins_select ON public.online_poker_buyins;
CREATE POLICY op_buyins_select ON public.online_poker_buyins
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.online_poker_seats s
      WHERE s.table_id = online_poker_buyins.table_id
        AND s.user_id = auth.uid()
        AND s.status IN ('sitting', 'sitting_out')
    )
  );

-- No INSERT/UPDATE/DELETE policy → only the SECURITY DEFINER RPCs below ever write.
REVOKE ALL    ON TABLE public.online_poker_buyins FROM PUBLIC, anon;
GRANT  SELECT ON TABLE public.online_poker_buyins TO authenticated;
GRANT  SELECT, INSERT ON TABLE public.online_poker_buyins TO service_role;

-- ── op_create_open_table (+ record the creator's initial 'sit' buy-in) ───────
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

  -- buy-in ledger: the creator's initial buy-in.
  INSERT INTO public.online_poker_buyins (table_id, user_id, seat_no, kind, amount)
  VALUES (v_table, v_uid, 1, 'sit', p_buyin);

  RETURN jsonb_build_object('outcome', 'ok', 'table_id', v_table, 'seat_no', 1);
END;
$$;

-- ── op_sit_open (+ record a 'sit' buy-in on a fresh claim) ────────────────────
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
  -- (No new buy-in row on the idempotent / already-seated paths.)
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

  -- buy-in ledger: a fresh sit (append-only; survives a later leave).
  INSERT INTO public.online_poker_buyins (table_id, user_id, seat_no, kind, amount)
  VALUES (p_table_id, v_uid, p_seat_no, 'sit', p_buyin);

  -- First sitter at a host-less table becomes the host.
  UPDATE public.online_poker_tables
  SET host_user_id = v_uid
  WHERE id = p_table_id AND host_user_id IS NULL;

  RETURN jsonb_build_object('outcome', 'ok', 'seat', p_seat_no, 'stack', p_buyin::text);
END;
$$;

-- ── op_rebuy_open (+ record a 'rebuy' buy-in) ────────────────────────────────
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

  IF v_table.starting_stack_default < 1 OR p_amount <> v_table.starting_stack_default THEN
    RETURN jsonb_build_object('outcome', 'bad_amount', 'expected', v_table.starting_stack_default::text);
  END IF;

  SELECT * INTO v_seat FROM public.online_poker_seats
  WHERE table_id = p_table_id AND user_id = v_uid AND status IN ('sitting', 'sitting_out')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_seated');
  END IF;

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

  -- buy-in ledger: a rebuy (server-dictated starting stack).
  INSERT INTO public.online_poker_buyins (table_id, user_id, seat_no, kind, amount)
  VALUES (p_table_id, v_uid, v_seat.seat_no, 'rebuy', v_table.starting_stack_default);

  RETURN jsonb_build_object('outcome', 'ok', 'stack', v_table.starting_stack_default::text);
END;
$$;

-- ── grants (unchanged: revoke PUBLIC/anon, grant authenticated + service_role) ──
REVOKE EXECUTE ON FUNCTION public.op_create_open_table(text, bigint, bigint, bigint, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_sit_open(uuid, int, bigint, text)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_rebuy_open(uuid, bigint, text)                          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.op_create_open_table(text, bigint, bigint, bigint, int) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.op_sit_open(uuid, int, bigint, text)                      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.op_rebuy_open(uuid, bigint, text)                          TO authenticated, service_role;

COMMIT;
