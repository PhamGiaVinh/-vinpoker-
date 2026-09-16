-- Persist the actual blind positions without changing the start_hand or record_action ABI.
-- ROLLBACK: disable the new suggestion; retain the two audit columns. A forward
-- migration may drop the trigger/function after all readers stop using them.
BEGIN;

ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS tracker_sb_position integer,
  ADD COLUMN IF NOT EXISTS tracker_bb_position integer;

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
  IF v_hand.table_session_id IS NULL THEN
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
