-- Allow Voice Hole Cards during a canonical all-in runout when exactly one
-- live player covers the all-in and has already matched the highest wager.
-- The historical atomic-confirm migration remains unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public._tracker_voice_runout_reveal_authoritative_v1(
  p_hand_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  WITH player_state AS (
    SELECT hp.player_id, hp.entry_number, hp.starting_stack,
      EXISTS (
        SELECT 1
        FROM public.hand_actions folded
        WHERE folded.hand_id = hp.hand_id
          AND folded.player_id = hp.player_id
          AND folded.entry_number = hp.entry_number
          AND folded.action_type = 'fold'
      ) AS folded,
      COALESCE((
        SELECT sum(action.action_amount)
        FROM public.hand_actions action
        WHERE action.hand_id = hp.hand_id
          AND action.player_id = hp.player_id
          AND action.entry_number = hp.entry_number
          AND action.action_type IN ('post_sb', 'post_bb', 'post_ante', 'call', 'bet', 'raise', 'all_in')
      ), 0) AS committed
    FROM public.hand_players hp
    WHERE hp.hand_id = p_hand_id
  ),
  live_state AS (
    SELECT * FROM player_state WHERE NOT folded
  ),
  runout_state AS (
    SELECT count(*) AS live_count,
           count(*) FILTER (WHERE committed >= starting_stack) AS all_in_count,
           count(*) FILTER (WHERE committed < starting_stack) AS covering_count,
           max(committed) AS highest_commitment
    FROM live_state
  )
  SELECT state.live_count >= 2
     AND state.all_in_count >= 1
     AND state.covering_count <= 1
     AND NOT EXISTS (
       SELECT 1
       FROM live_state player, runout_state aggregate_state
       WHERE player.committed < player.starting_stack
         AND player.committed < aggregate_state.highest_commitment
     )
  FROM runout_state state;
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_runout_reveal_authoritative_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

DO $migration$
DECLARE
  v_function REGPROCEDURE := 'public.commit_tracker_voice_hole_cards_v0(uuid,uuid,uuid,uuid,text,text,text,text,text,text,integer,jsonb)'::REGPROCEDURE;
  v_definition TEXT;
  v_old_authority TEXT := $old$
  -- Canonical action history, not a browser draft, proves this is a genuine
  -- all-in runout: at least two live players and every live player is all-in.
  WITH player_state AS (
    SELECT hp.player_id, hp.entry_number, hp.starting_stack,
      EXISTS (
        SELECT 1 FROM public.hand_actions folded
        WHERE folded.hand_id = hp.hand_id
          AND folded.player_id = hp.player_id
          AND folded.entry_number = hp.entry_number
          AND folded.action_type = 'fold'
      ) AS folded,
      COALESCE((
        SELECT sum(action.action_amount)
        FROM public.hand_actions action
        WHERE action.hand_id = hp.hand_id
          AND action.player_id = hp.player_id
          AND action.entry_number = hp.entry_number
          AND action.action_type IN ('post_sb', 'post_bb', 'post_ante', 'call', 'bet', 'raise', 'all_in')
      ), 0) AS committed
    FROM public.hand_players hp
    WHERE hp.hand_id = p_hand_id
  )
  SELECT count(*) FILTER (WHERE NOT folded),
         count(*) FILTER (WHERE NOT folded AND committed >= starting_stack)
  INTO v_live_count, v_all_in_count
  FROM player_state;
  IF v_live_count < 2 OR v_live_count <> v_all_in_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'runout_reveal_not_authoritative');
  END IF;
$old$;
  v_new_authority TEXT := $new$
  -- Canonical action history, not a browser draft, must prove either that all
  -- live players are all-in or that one covering player has matched the top.
  IF NOT public._tracker_voice_runout_reveal_authoritative_v1(p_hand_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'runout_reveal_not_authoritative');
  END IF;
$new$;
BEGIN
  SELECT pg_get_functiondef(v_function) INTO v_definition;
  IF v_definition IS NULL
     OR strpos(v_definition, v_old_authority) = 0
     OR strpos(v_definition, '_tracker_voice_runout_reveal_authoritative_v1') > 0 THEN
    RAISE EXCEPTION 'tracker_voice_covering_stack_hole_cards_precondition_failed';
  END IF;

  v_definition := replace(v_definition, v_old_authority, v_new_authority);
  EXECUTE v_definition;

  IF strpos(pg_get_functiondef(v_function), v_new_authority) = 0 THEN
    RAISE EXCEPTION 'tracker_voice_covering_stack_hole_cards_postcondition_failed';
  END IF;
END;
$migration$;

ALTER FUNCTION public.commit_tracker_voice_hole_cards_v0(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commit_tracker_voice_hole_cards_v0(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_tracker_voice_hole_cards_v0(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, JSONB)
  TO service_role;

COMMENT ON FUNCTION public._tracker_voice_runout_reveal_authoritative_v1(UUID) IS
  'Server-only all-in runout authority: all live players all-in, or one matched covering stack.';

COMMIT;
