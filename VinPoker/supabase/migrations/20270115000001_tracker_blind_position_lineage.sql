-- Freeze Floor blind structure and blind positions without changing writer ABIs.
-- ROLLBACK: disable the new suggestion; retain the two audit columns. A forward
-- migration may drop the trigger/function after all readers stop using them.
BEGIN;

ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS tracker_sb_position integer,
  ADD COLUMN IF NOT EXISTS tracker_bb_position integer;

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_attribute
      WHERE attrelid = 'public.tournament_hands'::regclass
        AND attname IN ('table_session_id', 'tracker_level_id', 'tracker_level_number',
          'tracker_small_blind', 'tracker_big_blind', 'tracker_bba', 'tracker_is_break')
        AND attnum > 0 AND NOT attisdropped) <> 7
    OR to_regclass('public.table_sessions') IS NULL
    OR to_regclass('public.tournament_levels') IS NULL
    OR to_regclass('public.tournament_seats') IS NULL THEN
    RAISE EXCEPTION 'tracker_blind_floor_structure_dependency_missing';
  END IF;
END;
$preflight$;

-- The existing Tracker start_hand writer inserts the hand before posting blinds.
-- Freeze the Floor level and positional lineage in that INSERT transaction.
CREATE OR REPLACE FUNCTION floor_private.snapshot_tracker_hand_blinds()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tour record;
  v_session record;
  v_level record;
  v_seats integer[];
  v_count integer;
  v_prior record;
  v_prior_sb integer;
  v_prior_bb integer;
  v_sb integer;
  v_bb integer;
BEGIN
  IF NEW.table_session_id IS NULL THEN RETURN NEW; END IF;

  SELECT control_mode, closed_at INTO v_session
  FROM public.table_sessions
  WHERE id = NEW.table_session_id
    AND tournament_id = NEW.tournament_id;
  IF NOT FOUND OR v_session.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'tracker_table_session_unavailable';
  END IF;
  IF v_session.control_mode IS DISTINCT FROM 'tracker' THEN RETURN NEW; END IF;

  SELECT current_level_id, current_level INTO v_tour
  FROM public.tournaments WHERE id = NEW.tournament_id;
  SELECT id, level_number, small_blind, big_blind, ante, is_break INTO v_level
  FROM public.tournament_levels
  WHERE tournament_id = NEW.tournament_id
    AND ((v_tour.current_level_id IS NOT NULL AND id = v_tour.current_level_id)
      OR (v_tour.current_level_id IS NULL AND level_number = v_tour.current_level))
  LIMIT 1;
  IF NOT FOUND OR COALESCE(v_level.is_break, true)
    OR v_level.small_blind IS NULL OR v_level.small_blind <= 0
    OR v_level.big_blind IS NULL OR v_level.big_blind <= v_level.small_blind
    OR v_level.ante IS NULL OR v_level.ante < 0 THEN
    RAISE EXCEPTION 'tracker_floor_blind_level_unavailable';
  END IF;
  NEW.tracker_level_id := v_level.id;
  NEW.tracker_level_number := v_level.level_number;
  NEW.tracker_small_blind := v_level.small_blind;
  NEW.tracker_big_blind := v_level.big_blind;
  NEW.tracker_bba := v_level.ante;
  NEW.tracker_is_break := false;

  SELECT array_agg(seat_number ORDER BY seat_number), count(*)::integer
    INTO v_seats, v_count
  FROM public.tournament_seats
  WHERE tournament_id = NEW.tournament_id AND table_id = NEW.table_id
    AND is_active = true;
  IF v_count < 2 THEN RAISE EXCEPTION 'tracker_blind_roster_unavailable'; END IF;

  SELECT id, tracker_sb_position, tracker_bb_position INTO v_prior
  FROM public.tournament_hands
  WHERE tournament_id = NEW.tournament_id AND table_id = NEW.table_id
    AND table_session_id = NEW.table_session_id AND hand_number < NEW.hand_number
    AND status = 'completed' AND COALESCE(is_voided, false) = false
  ORDER BY hand_number DESC LIMIT 1;
  IF FOUND THEN
    v_prior_sb := v_prior.tracker_sb_position;
    v_prior_bb := v_prior.tracker_bb_position;
    IF v_prior_sb IS NULL THEN
      SELECT player.seat_number INTO v_prior_sb
      FROM public.hand_actions action_row
      JOIN public.hand_players player ON player.hand_id = action_row.hand_id
        AND player.player_id = action_row.player_id
        AND player.entry_number = action_row.entry_number
      WHERE action_row.hand_id = v_prior.id AND action_row.action_type = 'post_sb'
      ORDER BY action_row.action_order DESC LIMIT 1;
    END IF;
    IF v_prior_bb IS NULL THEN
      SELECT player.seat_number INTO v_prior_bb
      FROM public.hand_actions action_row
      JOIN public.hand_players player ON player.hand_id = action_row.hand_id
        AND player.player_id = action_row.player_id
        AND player.entry_number = action_row.entry_number
      WHERE action_row.hand_id = v_prior.id AND action_row.action_type = 'post_bb'
      ORDER BY action_row.action_order DESC LIMIT 1;
    END IF;
  END IF;

  IF v_count = 2 THEN
    IF NOT NEW.button_seat = ANY(v_seats) THEN
      RAISE EXCEPTION 'tracker_heads_up_button_unoccupied';
    END IF;
    v_sb := NEW.button_seat;
    SELECT seat INTO v_bb FROM unnest(v_seats) AS seat WHERE seat <> v_sb LIMIT 1;
  ELSIF v_prior_sb IS NOT NULL AND v_prior_bb IS NOT NULL
    AND NEW.button_seat = v_prior_sb THEN
    -- The old BB position is the new SB position, even if that seat busted.
    v_sb := v_prior_bb;
    SELECT seat INTO v_bb FROM unnest(v_seats) AS seat
      WHERE seat > v_prior_bb ORDER BY seat LIMIT 1;
    v_bb := COALESCE(v_bb, v_seats[1]);
  ELSE
    -- First hand or explicit Dealer button override.
    SELECT seat INTO v_sb FROM unnest(v_seats) AS seat
      WHERE seat > NEW.button_seat ORDER BY seat LIMIT 1;
    v_sb := COALESCE(v_sb, v_seats[1]);
    SELECT seat INTO v_bb FROM unnest(v_seats) AS seat
      WHERE seat > v_sb ORDER BY seat LIMIT 1;
    v_bb := COALESCE(v_bb, v_seats[1]);
  END IF;
  NEW.tracker_sb_position := v_sb;
  NEW.tracker_bb_position := v_bb;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.snapshot_tracker_hand_blinds() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.snapshot_tracker_hand_blinds()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_snapshot_tracker_hand_blinds ON public.tournament_hands;
CREATE TRIGGER trg_snapshot_tracker_hand_blinds BEFORE INSERT ON public.tournament_hands
  FOR EACH ROW EXECUTE FUNCTION floor_private.snapshot_tracker_hand_blinds();

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournament_hands'::regclass
      AND conname = 'tracker_blind_positions_range'
  ) THEN
    ALTER TABLE public.tournament_hands
      ADD CONSTRAINT tracker_blind_positions_range CHECK (
        (tracker_sb_position IS NULL OR tracker_sb_position BETWEEN 1 AND 10)
        AND (tracker_bb_position IS NULL OR tracker_bb_position BETWEEN 1 AND 10)
      );
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION floor_private.guard_tracker_blind_positions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF current_user <> 'postgres' AND (
    (TG_OP = 'INSERT' AND (NEW.tracker_sb_position IS NOT NULL OR NEW.tracker_bb_position IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (
      NEW.tracker_sb_position IS DISTINCT FROM OLD.tracker_sb_position
      OR NEW.tracker_bb_position IS DISTINCT FROM OLD.tracker_bb_position
    ))
  ) THEN
    RAISE EXCEPTION 'tracker_blind_positions_server_owned';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.guard_tracker_blind_positions() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.guard_tracker_blind_positions()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION floor_private.guard_tracker_blind_post_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hand record;
  v_stack integer;
  v_paid integer;
  v_expected integer;
BEGIN
  IF NEW.action_type NOT IN ('post_sb', 'post_bb') THEN RETURN NEW; END IF;
  SELECT tracker_level_number, tracker_small_blind, tracker_big_blind
    INTO v_hand FROM public.tournament_hands WHERE id = NEW.hand_id;
  IF NOT FOUND OR v_hand.tracker_level_number IS NULL THEN RETURN NEW; END IF;
  SELECT starting_stack INTO v_stack FROM public.hand_players
  WHERE hand_id = NEW.hand_id AND player_id = NEW.player_id
    AND entry_number = NEW.entry_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'tracker_blind_player_missing'; END IF;
  SELECT COALESCE(sum(action_amount), 0)::integer INTO v_paid
  FROM public.hand_actions
  WHERE hand_id = NEW.hand_id AND player_id = NEW.player_id
    AND entry_number = NEW.entry_number
    AND action_type IN ('post_ante', 'post_sb', 'post_bb');
  v_expected := LEAST(
    CASE WHEN NEW.action_type = 'post_sb' THEN v_hand.tracker_small_blind
      ELSE v_hand.tracker_big_blind END,
    GREATEST(0, v_stack - v_paid)
  );
  IF NEW.action_amount IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'tracker_blind_amount_mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.guard_tracker_blind_post_amount() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.guard_tracker_blind_post_amount()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_guard_tracker_blind_post_amount ON public.hand_actions;
CREATE TRIGGER trg_guard_tracker_blind_post_amount BEFORE INSERT ON public.hand_actions
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_blind_post_amount();

DROP TRIGGER IF EXISTS trg_guard_tracker_blind_positions_insert ON public.tournament_hands;
CREATE TRIGGER trg_guard_tracker_blind_positions_insert
  BEFORE INSERT ON public.tournament_hands
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_blind_positions();
DROP TRIGGER IF EXISTS trg_guard_tracker_blind_positions_update ON public.tournament_hands;
CREATE TRIGGER trg_guard_tracker_blind_positions_update
  BEFORE UPDATE OF tracker_sb_position, tracker_bb_position ON public.tournament_hands
  FOR EACH ROW EXECUTE FUNCTION floor_private.guard_tracker_blind_positions();

CREATE OR REPLACE FUNCTION floor_private.capture_tracker_blind_positions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hand_id uuid;
  v_hand public.tournament_hands%ROWTYPE;
  v_sb integer;
  v_bb integer;
  v_prior_sb integer;
  v_prior_bb integer;
  v_prior_hand_id uuid;
  v_prior_status text;
  v_prior_voided boolean;
  v_post_count integer;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.action_type NOT IN ('post_sb', 'post_bb') THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND OLD.action_type NOT IN ('post_sb', 'post_bb') THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW.action_type NOT IN ('post_sb', 'post_bb')
    AND OLD.action_type NOT IN ('post_sb', 'post_bb') THEN RETURN NEW; END IF;

  v_hand_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.hand_id ELSE NEW.hand_id END;
  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = v_hand_id FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_hand.tracker_level_number IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT player.seat_number INTO v_sb
  FROM public.hand_actions action_row
  JOIN public.hand_players player
    ON player.hand_id = action_row.hand_id
   AND player.player_id = action_row.player_id
   AND player.entry_number = action_row.entry_number
  WHERE action_row.hand_id = v_hand_id AND action_row.action_type = 'post_sb'
  ORDER BY action_row.action_order DESC LIMIT 1;

  SELECT player.seat_number INTO v_bb
  FROM public.hand_actions action_row
  JOIN public.hand_players player
    ON player.hand_id = action_row.hand_id
   AND player.player_id = action_row.player_id
   AND player.entry_number = action_row.entry_number
  WHERE action_row.hand_id = v_hand_id AND action_row.action_type = 'post_bb'
  ORDER BY action_row.action_order DESC LIMIT 1;

  v_sb := COALESCE(v_sb, v_hand.tracker_sb_position);
  v_bb := COALESCE(v_bb, v_hand.tracker_bb_position);

  IF v_sb IS NULL AND v_bb IS NOT NULL THEN
    SELECT prior.id, prior.tracker_sb_position, prior.tracker_bb_position, prior.status, prior.is_voided
      INTO v_prior_hand_id, v_prior_sb, v_prior_bb, v_prior_status, v_prior_voided
    FROM public.tournament_hands prior
    WHERE prior.tournament_id = v_hand.tournament_id
      AND prior.table_id = v_hand.table_id
      AND prior.table_session_id IS NOT DISTINCT FROM v_hand.table_session_id
      AND prior.hand_number < v_hand.hand_number
    ORDER BY prior.hand_number DESC LIMIT 1;
    IF v_prior_status = 'completed' AND v_prior_voided IS NOT TRUE THEN
      IF v_prior_sb IS NULL THEN
        SELECT count(*)::integer, max(player.seat_number)
          INTO v_post_count, v_prior_sb
        FROM public.hand_actions prior_action
        JOIN public.hand_players player
          ON player.hand_id = prior_action.hand_id
         AND player.player_id = prior_action.player_id
         AND player.entry_number = prior_action.entry_number
        WHERE prior_action.hand_id = v_prior_hand_id AND prior_action.action_type = 'post_sb';
        IF v_post_count <> 1 THEN v_prior_sb := NULL; END IF;
      END IF;
      IF v_prior_bb IS NULL THEN
        SELECT count(*)::integer, max(player.seat_number)
          INTO v_post_count, v_prior_bb
        FROM public.hand_actions prior_action
        JOIN public.hand_players player
          ON player.hand_id = prior_action.hand_id
         AND player.player_id = prior_action.player_id
         AND player.entry_number = prior_action.entry_number
        WHERE prior_action.hand_id = v_prior_hand_id AND prior_action.action_type = 'post_bb';
        IF v_post_count <> 1 THEN v_prior_bb := NULL; END IF;
      END IF;
    END IF;
    IF v_prior_status = 'completed' AND v_prior_voided IS NOT TRUE
      AND v_hand.button_seat = v_prior_sb AND v_prior_bb IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.hand_players player
        WHERE player.hand_id = v_hand_id AND player.seat_number = v_prior_bb
      ) THEN
      v_sb := v_prior_bb;
    END IF;
  END IF;

  UPDATE public.tournament_hands
  SET tracker_sb_position = v_sb, tracker_bb_position = v_bb
  WHERE id = v_hand_id
    AND (tracker_sb_position, tracker_bb_position) IS DISTINCT FROM (v_sb, v_bb);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.capture_tracker_blind_positions() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.capture_tracker_blind_positions()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_capture_tracker_blind_positions ON public.hand_actions;
CREATE TRIGGER trg_capture_tracker_blind_positions
  AFTER INSERT OR UPDATE OR DELETE ON public.hand_actions
  FOR EACH ROW EXECUTE FUNCTION floor_private.capture_tracker_blind_positions();

COMMENT ON FUNCTION floor_private.capture_tracker_blind_positions() IS
  'Copies canonical blind posts into hand positional lineage; derives an unposted dead SB only from the preceding completed hand in the same session.';

COMMIT;
