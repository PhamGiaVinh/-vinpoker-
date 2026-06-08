-- ============================================================
-- 20260617000000_realtime_hand_tracking.sql
-- Real-time hand tracking: community cards, hole cards, lock mechanism
-- ============================================================

-- A. Add columns
ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('in_progress', 'completed', 'voided')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS locked_by_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE public.hand_players
  ADD COLUMN IF NOT EXISTS hole_cards JSONB DEFAULT '[]'::jsonb;

-- B. Backfill status for existing data
UPDATE public.tournament_hands
SET status = CASE WHEN is_voided THEN 'voided' ELSE 'completed' END
WHERE status IS NULL OR status = 'completed';

-- C. Constraints & Indexes
ALTER TABLE public.hand_players
  DROP CONSTRAINT IF EXISTS hand_players_unique_entry,
  ADD CONSTRAINT hand_players_unique_entry
    UNIQUE (hand_id, player_id, entry_number);

ALTER TABLE public.hand_actions
  DROP CONSTRAINT IF EXISTS uk_hand_action_order,
  ADD CONSTRAINT uk_hand_action_order
    UNIQUE (hand_id, action_order);

CREATE INDEX IF NOT EXISTS idx_tournament_hands_in_progress
  ON public.tournament_hands(tournament_id, table_id, status)
  WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_tournament_hands_updated_at
  ON public.tournament_hands(updated_at)
  WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS idx_hand_players_hole_cards
  ON public.hand_players USING GIN (hole_cards);

CREATE INDEX IF NOT EXISTS idx_hand_actions_hand_order
  ON public.hand_actions(hand_id, action_order);

-- D. validate_cards helper (regex set-based)
CREATE OR REPLACE FUNCTION public.validate_cards(p_cards JSONB)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_cards IS NULL OR p_cards = '[]'::jsonb THEN
    RETURN 'ok';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_cards) AS c
    WHERE c !~ '^[AKQJT2-9][shdc]$'
  ) THEN
    RETURN 'Invalid card format';
  END IF;

  IF jsonb_array_length(p_cards) != (
    SELECT COUNT(DISTINCT val) FROM jsonb_array_elements_text(p_cards) AS val
  ) THEN
    RETURN 'Duplicate cards in array';
  END IF;

  RETURN 'ok';
END;
$$;

-- E. start_hand RPC (with EXCEPTION WHEN unique_violation retry loop)
CREATE OR REPLACE FUNCTION public.start_hand(
  p_tournament_id UUID,
  p_table_id UUID,
  p_hand_number INTEGER,
  p_hand_time TIMESTAMPTZ DEFAULT NOW(),
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_hand_id UUID;
  v_existing_id UUID;
  v_existing_lock_time TIMESTAMPTZ;
  v_retry_count INTEGER := 0;
  v_seat RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tournament_tables
    WHERE id = p_table_id AND tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('error', 'Table does not belong to tournament');
  END IF;

  <<retry_loop>>
  LOOP
    BEGIN
      INSERT INTO public.tournament_hands
        (tournament_id, table_id, hand_number, hand_time, community_cards, pot_size, side_pots, status, created_by, locked_by_user_id, locked_at)
      VALUES
        (p_tournament_id, p_table_id, p_hand_number, p_hand_time, '[]'::jsonb, 0, '[]'::jsonb, 'in_progress', p_created_by, p_created_by, NOW())
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
           COALESCE(cc.chip_count, 0) AS chip_count
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
      (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots, hole_cards)
    VALUES
      (v_hand_id, p_tournament_id, v_seat.player_id, v_seat.entry_number,
       v_seat.seat_number, v_seat.chip_count, NULL, false, '[]'::jsonb, '[]'::jsonb);
  END LOOP;

  RETURN jsonb_build_object('status', 'success', 'hand_id', v_hand_id);
END;
$$;

-- F. update_community_cards RPC
CREATE OR REPLACE FUNCTION public.update_community_cards(
  p_hand_id UUID,
  p_community_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_validation TEXT;
BEGIN
  SELECT status, locked_by_user_id INTO v_status, v_locked_by
  FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress', 'status', v_status);
  END IF;

  IF v_locked_by IS NOT NULL AND p_user_id IS NOT NULL AND v_locked_by != p_user_id THEN
    RETURN jsonb_build_object('error', 'Hand is locked by another tracker', 'locked_by', v_locked_by);
  END IF;

  v_validation := public.validate_cards(p_community_cards);
  IF v_validation != 'ok' THEN
    RETURN jsonb_build_object('error', v_validation);
  END IF;

  IF jsonb_array_length(p_community_cards) NOT IN (0, 3, 4, 5) THEN
    RETURN jsonb_build_object('error', 'Invalid number of community cards', 'count', jsonb_array_length(p_community_cards));
  END IF;

  UPDATE public.tournament_hands
  SET community_cards = p_community_cards,
      updated_at = NOW(),
      locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- G. record_action RPC
CREATE OR REPLACE FUNCTION public.record_action(
  p_hand_id UUID,
  p_player_id UUID,
  p_entry_number INTEGER DEFAULT 1,
  p_street TEXT DEFAULT 'preflop',
  p_action_type TEXT,
  p_action_amount INTEGER DEFAULT 0,
  p_action_order INTEGER
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hand_players
    WHERE hand_id = p_hand_id AND player_id = p_player_id AND entry_number = p_entry_number
  ) THEN
    RETURN jsonb_build_object('error', 'Player not found in this hand');
  END IF;

  IF p_action_order IS NULL OR p_action_order < 1 THEN
    RETURN jsonb_build_object('error', 'Invalid action_order');
  END IF;

  INSERT INTO public.hand_actions
    (hand_id, player_id, entry_number, street, action_type, action_amount, action_order)
  VALUES
    (p_hand_id, p_player_id, p_entry_number, p_street, p_action_type, p_action_amount, p_action_order);

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- H. show_hole_cards RPC (with FOR UPDATE row-level lock)
CREATE OR REPLACE FUNCTION public.show_hole_cards(
  p_hand_id UUID,
  p_player_hole_cards JSONB,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
  v_community_cards JSONB;
  v_validation TEXT;
  v_item JSONB;
  v_player_id UUID;
  v_entry_number INTEGER;
  v_cards JSONB;
BEGIN
  SELECT status, locked_by_user_id, community_cards
  INTO v_status, v_locked_by, v_community_cards
  FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  IF v_locked_by IS NOT NULL AND p_user_id IS NOT NULL AND v_locked_by != p_user_id THEN
    RETURN jsonb_build_object('error', 'Hand is locked by another tracker');
  END IF;

  -- Lock all player rows for this hand to prevent race condition
  PERFORM 1 FROM public.hand_players
  WHERE hand_id = p_hand_id
  FOR UPDATE;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_player_hole_cards) LOOP
    v_player_id := (v_item ->> 'player_id')::UUID;
    v_entry_number := COALESCE((v_item ->> 'entry_number')::INTEGER, 1);
    v_cards := v_item -> 'hole_cards';

    v_validation := public.validate_cards(v_cards);
    IF v_validation != 'ok' THEN
      RETURN jsonb_build_object('error', v_validation);
    END IF;

    IF jsonb_array_length(v_cards) != 2 THEN
      RETURN jsonb_build_object('error', 'Must provide exactly 2 hole cards per player');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.hand_players
      WHERE hand_id = p_hand_id AND player_id = v_player_id AND entry_number = v_entry_number
    ) THEN
      RETURN jsonb_build_object('error', 'Player not found in this hand');
    END IF;

    -- Cross-validate: check against community cards + other players' hole cards
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_cards) AS new_card(c1)
      WHERE c1 IN (
        SELECT jsonb_array_elements_text(v_community_cards)
        UNION
        SELECT jsonb_array_elements_text(hp.hole_cards)
        FROM public.hand_players hp
        WHERE hp.hand_id = p_hand_id
          AND hp.player_id != v_player_id
          AND hp.hole_cards IS NOT NULL
          AND hp.hole_cards != '[]'::jsonb
      )
    ) THEN
      RETURN jsonb_build_object('error', 'Card already used by another player or in community cards');
    END IF;

    UPDATE public.hand_players
    SET hole_cards = v_cards
    WHERE hand_id = p_hand_id AND player_id = v_player_id AND entry_number = v_entry_number;
  END LOOP;

  -- Auto-extend lock (heartbeat)
  UPDATE public.tournament_hands
  SET updated_at = NOW(), locked_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success');
END;
$$;

-- I. record_hand (UPSERT — 5 steps, recalculate from source of truth)
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

    INSERT INTO public.hand_players
      (hand_id, tournament_id, player_id, entry_number, seat_number, starting_stack, ending_stack, is_eliminated, side_pots, hole_cards)
    VALUES
      (v_hand_id, p_tournament_id, v_player_id, v_entry_number,
       (v_player ->> 'seat_number')::INTEGER,
       (v_player ->> 'starting_stack')::INTEGER,
       (v_player ->> 'ending_stack')::INTEGER,
       v_is_eliminated,
       COALESCE(v_player -> 'side_pots', '[]'::JSONB),
       COALESCE(v_player -> 'hole_cards', '[]'::JSONB))
    ON CONFLICT (hand_id, player_id, entry_number) DO UPDATE SET
      ending_stack = EXCLUDED.ending_stack,
      is_eliminated = EXCLUDED.is_eliminated,
      side_pots = EXCLUDED.side_pots,
      hole_cards = EXCLUDED.hole_cards;

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

-- J. void_last_hand (conditional chip restore, release lock)
CREATE OR REPLACE FUNCTION public.void_last_hand(p_hand_id UUID)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_tournament_id UUID;
  v_hand_record RECORD;
  v_player_record RECORD;
BEGIN
  SELECT * INTO v_hand_record FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_hand_record.is_voided THEN
    RETURN jsonb_build_object('error', 'Hand already voided');
  END IF;

  v_tournament_id := v_hand_record.tournament_id;

  -- Only restore chip if hand was completed (has ending_stack)
  IF v_hand_record.status = 'completed' THEN
    FOR v_player_record IN
      SELECT * FROM public.hand_players WHERE hand_id = p_hand_id
    LOOP
      UPDATE public.tournament_chip_counts
      SET chip_count = v_player_record.starting_stack, updated_at = NOW()
      WHERE tournament_id = v_tournament_id
        AND player_id = v_player_record.player_id
        AND entry_number = v_player_record.entry_number;

      UPDATE public.tournament_seats
      SET chip_count = v_player_record.starting_stack, is_active = true
      WHERE tournament_id = v_tournament_id
        AND player_id = v_player_record.player_id
        AND entry_number = v_player_record.entry_number;
    END LOOP;

    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
  END IF;

  -- For in_progress hands: delete orphan actions + reset hole_cards
  IF v_hand_record.status = 'in_progress' THEN
    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;
    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
    UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false WHERE hand_id = p_hand_id;
  END IF;

  -- Void hand + release lock
  UPDATE public.tournament_hands
  SET is_voided = true, status = 'voided',
      locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
  WHERE id = p_hand_id;

  -- Recalculate from source of truth
  UPDATE public.tournaments
  SET players_remaining = (
      SELECT COUNT(*) FROM public.tournament_seats WHERE tournament_id = v_tournament_id AND is_active = true
    ),
    average_stack = (
      SELECT COALESCE(AVG(chip_count), 0) FROM public.tournament_chip_counts WHERE tournament_id = v_tournament_id
    ),
    updated_at = NOW()
  WHERE id = v_tournament_id;

  RETURN jsonb_build_object('status', 'success', 'message', 'Hand voided successfully', 'hand_id', p_hand_id);
END;
$$;

-- K. cleanup_orphan_hands (hard cap 60 min, no chip restore)
CREATE OR REPLACE FUNCTION public.cleanup_orphan_hands(
  p_older_than INTERVAL DEFAULT '10 minutes'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_ids UUID[];
  v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE public.tournament_hands SET
      status = 'voided', is_voided = true,
      locked_by_user_id = NULL, locked_at = NULL, updated_at = NOW()
    WHERE status = 'in_progress'
      AND (
        locked_at < NOW() - p_older_than
        OR (locked_at IS NULL AND created_at < NOW() - p_older_than)
        OR created_at < NOW() - (p_older_than * 6)
      )
    RETURNING id
  )
  SELECT array_agg(id), count(*) INTO v_ids, v_count FROM updated;

  IF v_count IS NULL OR v_count = 0 THEN
    RETURN jsonb_build_object('status', 'success', 'voided_count', 0);
  END IF;

  -- Cleanup orphan data (order matters for FK constraints)
  DELETE FROM public.hand_actions WHERE hand_id = ANY(v_ids);
  DELETE FROM public.tournament_eliminations WHERE hand_id = ANY(v_ids);
  UPDATE public.hand_players SET hole_cards = '[]'::jsonb, ending_stack = NULL, is_eliminated = false WHERE hand_id = ANY(v_ids);
  -- NO chip restore: in_progress hands never committed to tournament_chip_counts

  RETURN jsonb_build_object('status', 'success', 'voided_count', v_count, 'voided_ids', v_ids);
END;
$$;

-- L. heartbeat_lock RPC (ownership check, only updates locked_at)
CREATE OR REPLACE FUNCTION public.heartbeat_lock(
  p_hand_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status TEXT;
  v_locked_by UUID;
BEGIN
  SELECT status, locked_by_user_id INTO v_status, v_locked_by
  FROM public.tournament_hands WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_status != 'in_progress' THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  -- Only lock owner can extend
  IF v_locked_by IS NOT NULL AND p_user_id IS NOT NULL AND v_locked_by != p_user_id THEN
    RETURN jsonb_build_object('error', 'Unauthorized: Hand is locked by another user');
  END IF;

  UPDATE public.tournament_hands
  SET locked_at = NOW(), updated_at = NOW()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success', 'locked_at', NOW());
END;
$$;

-- M. RLS Policy — keep existing viewable policy, update manageable policy
-- The existing "Tournament hands manageable by admins" policy already allows
-- club owners/cashiers/trackers/dealer_controls to manage hands.
-- No additional RLS changes needed for the UPDATE case since the existing
-- policy covers authenticated users who are club members.