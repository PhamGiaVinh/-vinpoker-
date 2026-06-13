-- ============================================================================
-- 20260820000000_online_poker_runtime_rpcs.sql
-- Online Poker (play-money) RUNTIME layer — GE-2C. SOURCE-ONLY: authored, NOT
-- applied here. Adds the feature flag + the op_* SECURITY DEFINER RPCs that the
-- thin Edge function (online-poker-action) calls. The Edge runtime is the ONLY
-- place the TS poker engine executes; these RPCs are pure DB-transaction
-- primitives (idempotency, row lock, optimistic CAS, auth, persistence).
--
-- AUTH MODEL (locked):
--   * ENGINE/WRITE rpcs (op_load_action_context, op_start_hand, op_submit_action,
--     op_timeout_sweep) are SERVICE-ROLE ONLY. The Edge is the sole caller; it
--     passes p_actor_user_id taken from a JWT-verified auth.getUser(). Clients
--     cannot reach this surface at all. Seat-ownership is enforced against that
--     uid (the Seat-Assignment P0-guard intent, enforced at a closed boundary).
--   * SELF/CLIENT rpcs (op_get_my_hole_cards, op_sit_down, op_stand_up,
--     op_claim_daily_chips) are AUTHENTICATED and bind to auth.uid() directly.
--     op_get_my_hole_cards returns ONLY the caller's own cards from the deny-all
--     secrets table.
--
-- DARK BY DEFAULT: online_poker_config.enabled defaults FALSE; every op_* refuses
-- while disabled. Until this migration is applied, the RPCs + flag table do not
-- exist live, so the Edge function (which deploys on merge) treats every call as
-- "disabled" and refuses — the runtime ships dark.
--
-- PLAY MONEY ONLY: online_poker_chip_ledger is a play-chip ledger. NO cashier,
-- payroll, staking, payout, real wallet, or club-money linkage anywhere.
--
-- Tables created by 20260817000000_online_poker_core.sql (applied live, GE-2B).
-- Rollback: DROP the op_* functions + online_poker_config (see bottom note).
-- ============================================================================

BEGIN;

-- ── Feature flag (singleton, default OFF) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.online_poker_config (
  id boolean PRIMARY KEY DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT online_poker_config_singleton CHECK (id)   -- only one row (id = true)
);
INSERT INTO public.online_poker_config (id, enabled) VALUES (true, false)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.online_poker_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS op_config_select ON public.online_poker_config;
CREATE POLICY op_config_select ON public.online_poker_config FOR SELECT USING (true);
DROP POLICY IF EXISTS op_config_admin_write ON public.online_poker_config;
CREATE POLICY op_config_admin_write ON public.online_poker_config FOR ALL
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

DROP TRIGGER IF EXISTS trg_online_poker_config_updated_at ON public.online_poker_config;
CREATE TRIGGER trg_online_poker_config_updated_at
  BEFORE UPDATE ON public.online_poker_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.online_poker_config IS
  'Online-poker runtime feature flag (singleton). enabled defaults FALSE; every op_* RPC refuses while false. Flipping it is an owner-approved controlled operation.';

-- ── op_is_enabled — the dark switch every op_* checks first ─────────────────
CREATE OR REPLACE FUNCTION public.op_is_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT enabled FROM public.online_poker_config WHERE id LIMIT 1), false);
$$;

-- ============================================================================
-- ENGINE / WRITE RPCs — SERVICE ROLE ONLY (Edge is the sole caller)
-- ============================================================================

-- op_load_action_context — rebuild inputs for the Edge engine: stored public
-- state + the secret live deck + per-seat hole cards. Returns secrets, so it is
-- service-role only and never reachable by a client.
CREATE OR REPLACE FUNCTION public.op_load_action_context(p_hand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hand public.online_poker_hands%ROWTYPE;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  SELECT * INTO v_hand FROM public.online_poker_hands WHERE id = p_hand_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'hand_id', v_hand.id,
    'table_id', v_hand.table_id,
    'status', v_hand.status,
    'state_version', v_hand.state_version,
    'state', v_hand.state,
    'live_deck', (SELECT s.cards FROM public.online_poker_hand_secrets s
                  WHERE s.hand_id = v_hand.id AND s.kind = 'board_future' LIMIT 1),
    'holes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('seat', s.seat_no, 'cards', s.cards)
                              ORDER BY s.seat_no), '[]'::jsonb)
              FROM public.online_poker_hand_secrets s
              WHERE s.hand_id = v_hand.id AND s.kind = 'hole')
  );
END;
$$;

-- op_start_hand — persist a hand the EDGE already built (createHand + shuffle ran
-- in the engine). Cards never originate in SQL. Extracts ids/config from the
-- public wire state; stores the original deck + live deck + holes as secrets.
CREATE OR REPLACE FUNCTION public.op_start_hand(
  p_state          jsonb,
  p_deck           jsonb,
  p_board_future   jsonb,
  p_holes          jsonb,
  p_events         jsonb,
  p_engine_version text,
  p_act_deadline   timestamptz,
  p_actor_user_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hand_id   uuid := (p_state->'config'->>'handId')::uuid;
  v_table_id  uuid := (p_state->'config'->>'tableId')::uuid;
  v_hand_no   bigint := (p_state->'config'->>'handNo')::bigint;
  v_button    int := (p_state->'config'->>'buttonSeat')::int;
  v_schema_v  int := (p_state->'config'->>'schemaVersion')::int;
BEGIN
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  -- Public state must never carry secret data.
  IF p_state ? 'deck'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_state->'seats') s WHERE s ? 'holeCards') THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'detail', 'public state carries secret data');
  END IF;

  -- One active hand per table (the partial unique index is the hard backstop).
  IF EXISTS (SELECT 1 FROM public.online_poker_hands
             WHERE table_id = v_table_id AND status IN ('dealing', 'betting')) THEN
    RETURN jsonb_build_object('outcome', 'already_active');
  END IF;

  INSERT INTO public.online_poker_hands (
    id, table_id, hand_no, state_version, state_schema_version, engine_version,
    button_seat, street, board, pot, side_pots, to_act_seat, act_deadline, status, state
  ) VALUES (
    v_hand_id, v_table_id, v_hand_no, 0, v_schema_v, p_engine_version,
    v_button, p_state->>'street', COALESCE(p_state->'board', '[]'::jsonb),
    (p_state->>'pot')::bigint, COALESCE(p_state->'sidePots', '[]'::jsonb),
    (p_state->>'toAct')::int, p_act_deadline, p_state->>'status', p_state
  );

  -- Per-seat public facts (in-hand seats only).
  INSERT INTO public.online_poker_hand_seats (
    hand_id, seat_no, user_id, starting_stack, stack, committed, total_committed, status, revealed_cards
  )
  SELECT v_hand_id, (s->>'seat')::int, (s->>'playerId')::uuid,
         (s->>'startingStack')::bigint, (s->>'stack')::bigint,
         (s->>'committed')::bigint, (s->>'totalCommitted')::bigint,
         s->>'status',
         CASE WHEN s ? 'revealedCards' THEN s->'revealedCards' ELSE NULL END
  FROM jsonb_array_elements(p_state->'seats') AS s
  WHERE (s->>'status') IN ('active', 'folded', 'allin');

  -- Secrets: original deck (immutable / audit), live deck (resume), per-seat holes.
  INSERT INTO public.online_poker_hand_secrets (hand_id, kind, seat_no, cards) VALUES
    (v_hand_id, 'deck', NULL, p_deck),
    (v_hand_id, 'board_future', NULL, p_board_future);
  INSERT INTO public.online_poker_hand_secrets (hand_id, kind, seat_no, cards)
  SELECT v_hand_id, 'hole', (h->>'seat')::int, h->'cards'
  FROM jsonb_array_elements(p_holes) AS h;

  -- Initial events.
  INSERT INTO public.online_poker_hand_events (hand_id, event_seq, type, payload)
  SELECT v_hand_id, (e->>'event_seq')::int, e->>'type', COALESCE(e->'payload', '{}'::jsonb)
  FROM jsonb_array_elements(p_events) AS e;

  RETURN jsonb_build_object('outcome', 'ok', 'hand_id', v_hand_id, 'state_version', 0);
END;
$$;

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
  SELECT COALESCE(SUM(stack), 0) + v_hand.pot INTO v_pre_total
  FROM public.online_poker_hand_seats WHERE hand_id = p_hand_id;
  SELECT COALESCE(SUM((s->>'stack')::bigint), 0) + (p_new_state->>'pot')::bigint INTO v_post_total
  FROM jsonb_array_elements(p_new_state->'seats') AS s;
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

  -- Append events (seq assigned by the Edge, continuing the per-hand sequence).
  INSERT INTO public.online_poker_hand_events (hand_id, event_seq, type, payload)
  SELECT p_hand_id, (e->>'event_seq')::int, e->>'type', COALESCE(e->'payload', '{}'::jsonb)
  FROM jsonb_array_elements(p_events) AS e;

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

-- op_timeout_sweep — list hands whose action clock expired; the Edge runs the
-- engine's forcedTimeoutAction for each and routes it through op_submit_action.
CREATE OR REPLACE FUNCTION public.op_timeout_sweep()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'outcome', CASE WHEN public.op_is_enabled() THEN 'ok' ELSE 'disabled' END,
    'hands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'hand_id', id, 'to_act_seat', to_act_seat, 'state_version', state_version))
      FROM public.online_poker_hands
      WHERE public.op_is_enabled()
        AND status = 'betting' AND act_deadline IS NOT NULL AND act_deadline < now()
    ), '[]'::jsonb)
  );
$$;

-- ============================================================================
-- SELF / CLIENT RPCs — AUTHENTICATED, bound to auth.uid()
-- ============================================================================

-- op_get_my_hole_cards — returns ONLY the caller's own hole cards. SECURITY
-- DEFINER to read the deny-all secrets table, scoped strictly to auth.uid().
CREATE OR REPLACE FUNCTION public.op_get_my_hole_cards(p_hand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_seat  int;
  v_cards jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  SELECT seat_no INTO v_seat FROM public.online_poker_hand_seats
  WHERE hand_id = p_hand_id AND user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_seated');
  END IF;

  SELECT cards INTO v_cards FROM public.online_poker_hand_secrets
  WHERE hand_id = p_hand_id AND kind = 'hole' AND seat_no = v_seat;

  RETURN jsonb_build_object('outcome', 'ok', 'seat', v_seat, 'cards', COALESCE(v_cards, '[]'::jsonb));
END;
$$;

-- op_sit_down — claim a seat and move a play-chip buy-in from wallet to table.
CREATE OR REPLACE FUNCTION public.op_sit_down(
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
  v_uid       uuid := auth.uid();
  v_table     public.online_poker_tables%ROWTYPE;
  v_balance   bigint;
  v_new_bal   bigint;
  v_claimed   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;
  IF p_buyin <= 0 THEN
    RETURN jsonb_build_object('outcome', 'invalid_buyin');
  END IF;

  -- Idempotency: ledger key already used => already applied.
  IF EXISTS (SELECT 1 FROM public.online_poker_chip_ledger WHERE idempotency_key = p_idempotency_key) THEN
    RETURN jsonb_build_object('outcome', 'ok', 'idempotent', true);
  END IF;

  SELECT * INTO v_table FROM public.online_poker_tables WHERE id = p_table_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'table_not_found');
  END IF;
  IF p_seat_no < 1 OR p_seat_no > v_table.max_seats THEN
    RETURN jsonb_build_object('outcome', 'bad_seat');
  END IF;
  IF p_buyin < v_table.min_buyin OR p_buyin > v_table.max_buyin THEN
    RETURN jsonb_build_object('outcome', 'buyin_out_of_range');
  END IF;

  -- Already seated at this table?
  IF EXISTS (SELECT 1 FROM public.online_poker_seats
             WHERE table_id = p_table_id AND user_id = v_uid AND status IN ('sitting', 'sitting_out')) THEN
    RETURN jsonb_build_object('outcome', 'already_seated');
  END IF;

  -- Wallet must cover the buy-in.
  SELECT balance INTO v_balance FROM public.online_poker_player_accounts
  WHERE user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_wallet', 'detail', 'claim daily chips first');
  END IF;
  IF v_balance < p_buyin THEN
    RETURN jsonb_build_object('outcome', 'insufficient_funds');
  END IF;

  -- Claim the seat (only if empty). Insert the row if it does not exist yet.
  INSERT INTO public.online_poker_seats (table_id, seat_no, user_id, stack, status)
  VALUES (p_table_id, p_seat_no, v_uid, p_buyin, 'sitting')
  ON CONFLICT (table_id, seat_no) DO UPDATE
    SET user_id = EXCLUDED.user_id, stack = EXCLUDED.stack, status = 'sitting', joined_at = now()
    WHERE public.online_poker_seats.status = 'empty' AND public.online_poker_seats.user_id IS NULL
  RETURNING id INTO v_claimed;
  IF v_claimed IS NULL THEN
    RETURN jsonb_build_object('outcome', 'seat_taken');
  END IF;

  -- Move chips wallet -> table seat (play money).
  v_new_bal := v_balance - p_buyin;
  UPDATE public.online_poker_player_accounts SET balance = v_new_bal, updated_at = now()
  WHERE user_id = v_uid;
  INSERT INTO public.online_poker_chip_ledger (user_id, table_id, type, amount, balance_after, idempotency_key)
  VALUES (v_uid, p_table_id, 'buyin', -p_buyin, v_new_bal, p_idempotency_key);

  RETURN jsonb_build_object('outcome', 'ok', 'seat', p_seat_no,
    'stack', p_buyin::text, 'wallet', v_new_bal::text);
END;
$$;

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

-- op_claim_daily_chips — grant daily PLAY chips; idempotent per UTC day.
CREATE OR REPLACE FUNCTION public.op_claim_daily_chips()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_key     text;
  v_balance bigint;
  v_new_bal bigint;
  c_grant   constant bigint := 1000000;   -- play chips; NOT real money
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('outcome', 'unauthenticated');
  END IF;
  IF NOT public.op_is_enabled() THEN
    RETURN jsonb_build_object('outcome', 'disabled');
  END IF;

  v_key := 'grant_' || v_uid::text || '_' || to_char((now() AT TIME ZONE 'UTC'), 'YYYYMMDD');
  IF EXISTS (SELECT 1 FROM public.online_poker_chip_ledger WHERE idempotency_key = v_key) THEN
    RETURN jsonb_build_object('outcome', 'already_claimed');
  END IF;

  INSERT INTO public.online_poker_player_accounts (user_id, balance) VALUES (v_uid, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO v_balance FROM public.online_poker_player_accounts
  WHERE user_id = v_uid FOR UPDATE;
  v_new_bal := v_balance + c_grant;
  UPDATE public.online_poker_player_accounts SET balance = v_new_bal, updated_at = now()
  WHERE user_id = v_uid;
  INSERT INTO public.online_poker_chip_ledger (user_id, type, amount, balance_after, idempotency_key)
  VALUES (v_uid, 'grant', c_grant, v_new_bal, v_key);

  RETURN jsonb_build_object('outcome', 'ok', 'granted', c_grant::text, 'wallet', v_new_bal::text);
END;
$$;

-- ============================================================================
-- Grants — engine/write RPCs are SERVICE-ROLE ONLY; self RPCs are AUTHENTICATED.
-- (anon is denied everywhere; the dark flag still gates execution.)
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.op_is_enabled()                                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_load_action_context(uuid)                                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.op_start_hand(jsonb, jsonb, jsonb, jsonb, jsonb, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.op_timeout_sweep()                                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.op_get_my_hole_cards(uuid)                                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_sit_down(uuid, int, bigint, text)                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_stand_up(uuid, text)                                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.op_claim_daily_chips()                                        FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.op_is_enabled()                                                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.op_load_action_context(uuid)                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.op_start_hand(jsonb, jsonb, jsonb, jsonb, jsonb, text, timestamptz, uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.op_timeout_sweep()                                              TO service_role;
GRANT EXECUTE ON FUNCTION public.op_get_my_hole_cards(uuid)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.op_sit_down(uuid, int, bigint, text)                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.op_stand_up(uuid, text)                                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.op_claim_daily_chips()                                          TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- ROLLBACK (manual, if ever needed before runtime use):
--   DROP FUNCTION IF EXISTS public.op_claim_daily_chips();
--   DROP FUNCTION IF EXISTS public.op_stand_up(uuid, text);
--   DROP FUNCTION IF EXISTS public.op_sit_down(uuid, int, bigint, text);
--   DROP FUNCTION IF EXISTS public.op_get_my_hole_cards(uuid);
--   DROP FUNCTION IF EXISTS public.op_timeout_sweep();
--   DROP FUNCTION IF EXISTS public.op_submit_action(uuid, uuid, jsonb, jsonb, jsonb, jsonb, int, timestamptz, text);
--   DROP FUNCTION IF EXISTS public.op_start_hand(jsonb, jsonb, jsonb, jsonb, jsonb, text, timestamptz, uuid);
--   DROP FUNCTION IF EXISTS public.op_load_action_context(uuid);
--   DROP FUNCTION IF EXISTS public.op_is_enabled();
--   DROP TABLE IF EXISTS public.online_poker_config;
-- ============================================================================
