-- ĐỢT E1 — Historical name/avatar SNAPSHOT on hand_players.
--
-- WHY: recorded-hand history/replay/feed resolve the player name/avatar on READ from
-- tournament_seats.player_name/avatar_url keyed by player_id. That is correct only while
-- the player is still seated; once a player busts/leaves and their seat row is cleared or
-- reused, the read falls back to the 6-char id. To make history 100% accurate (the name/
-- avatar AS OF when the hand was played, immune to later seat changes), we SNAPSHOT
-- player_name + avatar_url into the hand_players row at hand time.
--
-- WHAT (all additive; existing behaviour byte-identical except the snapshot writes):
--   A. hand_players gains nullable player_name / avatar_url columns (inert for old rows,
--      inherits hand_players RLS).
--   B. start_hand CREATE OR REPLACE (identical signature) — the seed loop also copies
--      ts.player_name / ts.avatar_url → snapshot captured at hand START.
--   C. record_hand CREATE OR REPLACE (identical signature) — the UPSERT loop reads
--      tournament_seats.player_name/avatar_url for each player_id (server-authoritative,
--      the seat row still exists at record time) and writes them; ON CONFLICT keeps the
--      earlier (start_hand) snapshot via COALESCE so a later NULL never clobbers it.
--      NO client/Edge payload change → record_hand write-path parity stays byte-identical.
--   D. One-time backfill of existing hand_players rows from tournament_seats (best-effort;
--      rows whose seat is hard-gone stay NULL → read falls back to the existing resolver).
--
-- COALESCE ORDER (owner decision, default here): keep the START-hand name
-- (COALESCE(existing, EXCLUDED)). If the owner wants a mid-hand name correction (B1 edit)
-- to win in history, flip to COALESCE(EXCLUDED.player_name, hand_players.player_name).
--
-- DEPENDS ON: 20261215000000 (tournament_seats.avatar_url — live 2026-07-05),
--   20261012000000 (current start_hand), 20260617000000 (current record_hand). The guard
--   below aborts cleanly if tournament_seats.avatar_url is absent (plpgsql bodies are not
--   column-validated at CREATE, so a missing column would otherwise fail at the next hand).
--
-- ⚠️ NOT APPLIED here. Production apply is OWNER-GATED (vinpoker-production-patch runbook),
-- in a separate controlled session, after PR-green + owner review of this diff + smoke
-- (record_hand is money-path settlement — golden-diff a sample hand's chip results).
-- Rollback: re-apply 20261012000000 (start_hand) + 20260617000000 (record_hand) to restore
-- the pre-snapshot RPCs; the two nullable columns can stay (inert) or be dropped.

-- ── Dependency guard ─────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tournament_seats' AND column_name = 'avatar_url'
  ) THEN
    RAISE EXCEPTION 'hand_players snapshot migration requires tournament_seats.avatar_url — apply 20261215000000 first';
  END IF;
END
$guard$;

-- ── A. Snapshot columns (additive, nullable) ─────────────────────────────────
ALTER TABLE public.hand_players
  ADD COLUMN IF NOT EXISTS player_name text,
  ADD COLUMN IF NOT EXISTS avatar_url  text;

-- ── B. start_hand — seed the snapshot at hand start ──────────────────────────
-- Identical to 20261012000000 EXCEPT: the seed SELECT + INSERT also carry
-- ts.player_name / ts.avatar_url.
CREATE OR REPLACE FUNCTION public.start_hand(
  p_tournament_id uuid,
  p_table_id uuid,
  p_hand_number integer,
  p_hand_time timestamp with time zone DEFAULT now(),
  p_created_by uuid DEFAULT NULL::uuid,
  p_button_seat integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_hand_id UUID;
  v_existing_id UUID;
  v_existing_lock_time TIMESTAMPTZ;
  v_retry_count INTEGER := 0;
  v_seat RECORD;
  v_bad_seat INTEGER;  -- PR-P0: first dealt-in seat whose resolved seed is <= 0
BEGIN
  IF p_button_seat IS NULL OR p_button_seat < 1 OR p_button_seat > 10 THEN
    RETURN jsonb_build_object('error', 'Invalid button_seat: must be between 1 and 10');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_tables
    WHERE id = p_table_id AND tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('error', 'Table does not belong to tournament');
  END IF;

  -- PR-P0 PRECONDITION: every dealt-in seat must resolve to a POSITIVE starting
  -- stack (from tournament_chip_counts, falling back to tournament_seats.chip_count —
  -- the SAME source used to seed hand_players below). If any seat resolves to <= 0,
  -- fail LOUD here (full rollback, no hand created) instead of seeding 0 and breaking
  -- every subsequent action. Runs BEFORE the hand insert so nothing is persisted.
  SELECT ts.seat_number INTO v_bad_seat
  FROM public.tournament_seats ts
  LEFT JOIN public.tournament_chip_counts cc
    ON cc.tournament_id = ts.tournament_id
    AND cc.player_id = ts.player_id
    AND cc.entry_number = ts.entry_number
  WHERE ts.tournament_id = p_tournament_id
    AND ts.table_id = p_table_id
    AND ts.is_active = true
    AND COALESCE(cc.chip_count, ts.chip_count, 0) <= 0
  ORDER BY ts.seat_number
  LIMIT 1;

  IF v_bad_seat IS NOT NULL THEN
    RAISE EXCEPTION 'start_hand: ghế % chưa có chip (seed stack = 0) — không thể bắt đầu hand. Hãy nạp chip cho người chơi trước.', v_bad_seat;
  END IF;

  <<retry_loop>>
  LOOP
    BEGIN
      INSERT INTO public.tournament_hands
        (tournament_id, table_id, hand_number, hand_time, community_cards, pot_size, side_pots, status, created_by, locked_by_user_id, locked_at, button_seat)
      VALUES
        (p_tournament_id, p_table_id, p_hand_number, p_hand_time, '[]'::jsonb, 0, '[]'::jsonb, 'in_progress', p_created_by, p_created_by, NOW(), p_button_seat)
      RETURNING id INTO v_hand_id;

      EXIT retry_loop;

    EXCEPTION WHEN unique_violation THEN
      v_retry_count := v_retry_count + 1;

      IF v_retry_count > 1 THEN
        SELECT id, locked_at INTO v_existing_id, v_existing_lock_time
        FROM public.tournament_hands
        WHERE tournament_id = p_tournament_id AND table_id = p_table_id AND status = 'in_progress';

        RETURN jsonb_build_object('error', 'Table already has an active hand', 'hand_id', v_existing_id);
      END IF;

      SELECT id, locked_at INTO v_existing_id, v_existing_lock_time
      FROM public.tournament_hands
      WHERE tournament_id = p_tournament_id AND table_id = p_table_id AND status = 'in_progress';

      IF v_existing_id IS NULL THEN
        CONTINUE retry_loop;
      END IF;

      IF v_existing_lock_time < NOW() - INTERVAL '10 minutes' THEN
        UPDATE public.tournament_hands
        SET status = 'voided', is_voided = true,
            locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
        WHERE id = v_existing_id AND status = 'in_progress';

        DELETE FROM public.hand_actions WHERE hand_id = v_existing_id;
        DELETE FROM public.tournament_eliminations WHERE hand_id = v_existing_id;
        UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false
        WHERE hand_id = v_existing_id;

        CONTINUE retry_loop;
      ELSE
        RETURN jsonb_build_object('error', 'Table already has an active hand', 'hand_id', v_existing_id);
      END IF;
    END;
  END LOOP;

  FOR v_seat IN
    SELECT ts.player_id, ts.entry_number, ts.seat_number,
           -- FIX: tournament_chip_counts may have no row yet (e.g. seats created
           -- without a chip-count row); fall back to tournament_seats.chip_count —
           -- the same stack the operator UI shows — instead of defaulting to 0.
           COALESCE(cc.chip_count, ts.chip_count, 0) AS chip_count,
           -- ĐỢT E1: snapshot the display name/avatar at hand start.
           ts.player_name, ts.avatar_url
    FROM public.tournament_seats ts
    LEFT JOIN public.tournament_chip_counts cc
      ON cc.tournament_id = ts.tournament_id
      AND cc.player_id = ts.player_id
      AND cc.entry_number = ts.entry_number
    WHERE ts.tournament_id = p_tournament_id
      AND ts.table_id = p_table_id
      AND ts.is_active = true
    ORDER BY ts.seat_number
  LOOP
    INSERT INTO public.hand_players
      (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots, hole_cards, player_name, avatar_url)
    VALUES
      (v_hand_id, p_tournament_id, v_seat.player_id, v_seat.entry_number,
       v_seat.seat_number, v_seat.chip_count, NULL, false, '[]'::jsonb, '[]'::jsonb,
       v_seat.player_name, v_seat.avatar_url);
  END LOOP;

  RETURN jsonb_build_object('status', 'success', 'hand_id', v_hand_id, 'button_seat', p_button_seat);
END;
$function$;

-- ── C. record_hand — snapshot at record time (server-authoritative) ──────────
-- Identical to 20260617000000 EXCEPT: Step 2 reads tournament_seats.player_name/
-- avatar_url for v_player_id and writes them into hand_players; ON CONFLICT keeps the
-- earlier start_hand snapshot (COALESCE(existing, EXCLUDED)).
CREATE OR REPLACE FUNCTION public.record_hand(
  p_tournament_id UUID,
  p_table_id UUID,
  p_hand_number INTEGER,
  p_hand_time TIMESTAMPTZ,
  p_players JSONB,
  p_actions JSONB,
  p_side_pots JSONB DEFAULT '[]'::jsonb,
  p_community_cards JSONB DEFAULT '[]'::jsonb,
  p_pot_size INTEGER DEFAULT 0,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_hand_id UUID;
  v_player JSONB;
  v_action JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_is_eliminated BOOLEAN;
  v_seat_name TEXT;    -- ĐỢT E1: name/avatar snapshot read from tournament_seats
  v_seat_avatar TEXT;
BEGIN
  -- Step 1: UPSERT tournament_hands metadata
  INSERT INTO public.tournament_hands
    (tournament_id, table_id, hand_number, hand_time, community_cards, pot_size, side_pots, status, created_by, locked_by_user_id, locked_at)
  VALUES
    (p_tournament_id, p_table_id, p_hand_number, p_hand_time, p_community_cards, p_pot_size, p_side_pots, 'completed', p_created_by, NULL, NULL)
  ON CONFLICT (tournament_id, table_id, hand_number) DO UPDATE SET
    community_cards = EXCLUDED.community_cards,
    pot_size = EXCLUDED.pot_size,
    side_pots = EXCLUDED.side_pots,
    status = 'completed',
    updated_at = NOW(),
    locked_by_user_id = NULL,
    locked_at = NULL
  RETURNING id INTO v_hand_id;

  -- Step 2: UPSERT hand_players (idempotent)
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_player_id := (v_player ->> 'player_id')::UUID;
    v_entry_number := COALESCE((v_player ->> 'entry_number')::INTEGER, 1);
    v_is_eliminated := (v_player ->> 'is_eliminated')::BOOLEAN;

    -- ĐỢT E1: snapshot the display name/avatar from the seat (still present at record
    -- time — elimination only flips is_active below, it does not delete the row).
    SELECT player_name, avatar_url INTO v_seat_name, v_seat_avatar
    FROM public.tournament_seats
    WHERE tournament_id = p_tournament_id
      AND player_id = v_player_id
      AND entry_number = v_entry_number;

    INSERT INTO public.hand_players
      (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots, hole_cards, player_name, avatar_url)
    VALUES
      (v_hand_id, p_tournament_id, v_player_id, v_entry_number,
       (v_player ->> 'seat_number')::INTEGER,
       (v_player ->> 'starting_stack')::INTEGER,
       (v_player ->> 'ending_stack')::INTEGER,
       v_is_eliminated,
       COALESCE(v_player -> 'side_pots', '[]'::JSONB),
       COALESCE(v_player -> 'hole_cards', '[]'::JSONB),
       v_seat_name, v_seat_avatar)
    ON CONFLICT (hand_id, player_id, entry_number) DO UPDATE SET
      ending_stack = EXCLUDED.ending_stack,
      is_eliminated = EXCLUDED.is_eliminated,
      side_pots = EXCLUDED.side_pots,
      hole_cards = EXCLUDED.hole_cards,
      -- Keep the earliest (start_hand) snapshot; only fill if it was NULL.
      player_name = COALESCE(public.hand_players.player_name, EXCLUDED.player_name),
      avatar_url  = COALESCE(public.hand_players.avatar_url,  EXCLUDED.avatar_url);

    INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
    VALUES (p_tournament_id, v_player_id, v_entry_number, (v_player ->> 'ending_stack')::INTEGER)
    ON CONFLICT (tournament_id, player_id, entry_number)
    DO UPDATE SET chip_count = EXCLUDED.ending_stack, updated_at = NOW();

    IF v_is_eliminated THEN
      UPDATE public.tournament_seats
      SET is_active = false
      WHERE tournament_id = p_tournament_id
        AND player_id = v_player_id
        AND entry_number = v_entry_number;
    END IF;
  END LOOP;

  -- Step 3: INSERT hand_actions (append-only, ON CONFLICT DO NOTHING for idempotency)
  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    INSERT INTO public.hand_actions
      (hand_id, player_id, entry_number, street, action_type, action_amount, action_order)
    VALUES
      (v_hand_id,
       (v_action ->> 'player_id')::UUID,
       COALESCE((v_action ->> 'entry_number')::INTEGER, 1),
       COALESCE(v_action ->> 'street', 'preflop'),
       v_action ->> 'action_type',
       COALESCE((v_action ->> 'action_amount')::INTEGER, 0),
       (v_action ->> 'action_order')::INTEGER)
    ON CONFLICT (hand_id, action_order) DO NOTHING;
  END LOOP;

  -- Step 4: Elimination records (position = 0, deferred)
  FOR v_player IN SELECT * FROM jsonb_array_elements(p_players) LOOP
    v_player_id := (v_player ->> 'player_id')::UUID;
    v_entry_number := COALESCE((v_player ->> 'entry_number')::INTEGER, 1);
    v_is_eliminated := (v_player ->> 'is_eliminated')::BOOLEAN;

    IF v_is_eliminated THEN
      INSERT INTO public.tournament_eliminations (tournament_id, player_id, entry_number, hand_id, position, prize)
      VALUES (p_tournament_id, v_player_id, v_entry_number, v_hand_id, 0, 0)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- Step 5: Recalculate from source of truth
  UPDATE public.tournaments
  SET players_remaining = (
      SELECT COUNT(*) FROM public.tournament_seats
      WHERE tournament_id = p_tournament_id AND is_active = true
    ),
    average_stack = (
      SELECT COALESCE(AVG(chip_count), 0) FROM public.tournament_chip_counts
      WHERE tournament_id = p_tournament_id
    ),
    updated_at = NOW()
  WHERE id = p_tournament_id;

  RETURN jsonb_build_object('hand_id', v_hand_id, 'status', 'success');
END;
$$;

-- ── D. Backfill existing hand_players from the current seat roster (best-effort) ──
-- tournament_seats is UNIQUE(tournament_id, player_id); join on that (not entry_number,
-- which on the seat reflects only the latest re-entry). Rows whose seat is hard-gone
-- stay NULL → the read path falls back to its resolver.
UPDATE public.hand_players hp
SET player_name = ts.player_name,
    avatar_url  = ts.avatar_url
FROM public.tournament_seats ts
WHERE ts.tournament_id = hp.tournament_id
  AND ts.player_id     = hp.player_id
  AND hp.player_name IS NULL;
