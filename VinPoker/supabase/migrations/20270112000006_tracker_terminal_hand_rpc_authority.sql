-- P0 Tracker terminal-writer authority binding.
--
-- WHY: the legacy terminal RPCs relied on broad table RLS. That let a same-club
-- cashier or dealer-control caller mutate terminal hand state, and a cashier
-- could complete only part of void_last_hand before the tournament aggregate
-- update was silently rejected by RLS. The caller must be bound inside each
-- SECURITY DEFINER function, not inferred from client input or table policies.
--
-- ROLLBACK: re-apply the immediately preceding function definitions from
-- 20261225000000_edit_completed_hand.sql and
-- 20260617000000_realtime_hand_tracking.sql, then restore their prior grants.
-- Do not use this migration as a data repair tool.

BEGIN;

CREATE OR REPLACE FUNCTION public.void_last_hand(p_hand_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_tournament_id UUID;
  v_club_id UUID;
  v_hand_record RECORD;
  v_player_record RECORD;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;

  -- Resolve identity from the hand, then lock the tournament before any chip
  -- projection can be restored. The client controls only the hand identifier.
  SELECT tournament_id
  INTO v_tournament_id
  FROM public.tournament_hands
  WHERE id = p_hand_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  SELECT club_id
  INTO v_club_id
  FROM public.tournaments
  WHERE id = v_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Tournament not found');
  END IF;

  IF NOT public.is_club_tracker(v_actor, v_club_id) THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;

  SELECT *
  INTO v_hand_record
  FROM public.tournament_hands
  WHERE id = p_hand_id
    AND tournament_id = v_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;

  IF v_hand_record.is_voided THEN
    RETURN jsonb_build_object('error', 'Hand already voided');
  END IF;

  -- A tracker may void its own active lock. Owners and super admins can
  -- explicitly recover another operator's lock; a second tracker cannot.
  IF v_hand_record.status = 'in_progress'
     AND v_hand_record.locked_by_user_id IS NOT NULL
     AND v_hand_record.locked_by_user_id IS DISTINCT FROM v_actor
     AND NOT public.is_club_owner(v_actor, v_club_id) THEN
    RETURN jsonb_build_object('error', 'lock_owned_by_other');
  END IF;

  -- Never restore a completed hand's opening stack after a later live hand.
  PERFORM 1
  FROM public.tournament_hands h2
  WHERE h2.tournament_id = v_tournament_id
    AND h2.table_id = v_hand_record.table_id
    AND h2.id <> p_hand_id
    AND h2.is_voided = false
    AND h2.status IN ('completed', 'in_progress')
    AND h2.hand_number > v_hand_record.hand_number
  FOR UPDATE;

  IF v_hand_record.status = 'completed' AND FOUND THEN
    RETURN jsonb_build_object(
      'error',
      'Khong the void van nay - da co van moi hon tren ban. Chi void duoc van moi nhat (neu khong chip se sai).'
    );
  END IF;

  IF v_hand_record.status = 'completed' THEN
    FOR v_player_record IN
      SELECT *
      FROM public.hand_players
      WHERE hand_id = p_hand_id
      FOR UPDATE
    LOOP
      UPDATE public.tournament_chip_counts
      SET chip_count = v_player_record.starting_stack,
          updated_at = NOW()
      WHERE tournament_id = v_tournament_id
        AND player_id = v_player_record.player_id
        AND entry_number = v_player_record.entry_number;

      UPDATE public.tournament_seats AS t
      SET chip_count = v_player_record.starting_stack,
          is_active = CASE
            WHEN EXISTS (
              SELECT 1
              FROM public.tournament_seats s2
              WHERE s2.tournament_id = v_tournament_id
                AND s2.player_id = v_player_record.player_id
                AND s2.is_active = true
                AND s2.id <> t.id
            ) THEN t.is_active
            ELSE true
          END
      WHERE t.tournament_id = v_tournament_id
        AND t.player_id = v_player_record.player_id
        AND t.entry_number = v_player_record.entry_number;
    END LOOP;

    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
  END IF;

  IF v_hand_record.status = 'in_progress' THEN
    DELETE FROM public.hand_actions WHERE hand_id = p_hand_id;
    DELETE FROM public.tournament_eliminations WHERE hand_id = p_hand_id;
    UPDATE public.hand_players
    SET hole_cards = '[]'::jsonb,
        ending_stack = NULL,
        is_eliminated = false
    WHERE hand_id = p_hand_id;
  END IF;

  UPDATE public.tournament_hands
  SET is_voided = true,
      status = 'voided',
      locked_by_user_id = NULL,
      locked_at = NULL,
      updated_at = NOW()
  WHERE id = p_hand_id;

  UPDATE public.tournaments
  SET players_remaining = (
        SELECT COUNT(*)
        FROM public.tournament_seats
        WHERE tournament_id = v_tournament_id
          AND is_active = true
      ),
      average_stack = (
        SELECT COALESCE(AVG(chip_count), 0)
        FROM public.tournament_chip_counts
        WHERE tournament_id = v_tournament_id
      ),
      updated_at = NOW()
  WHERE id = v_tournament_id;

  RETURN jsonb_build_object(
    'status', 'success',
    'message', 'Hand voided successfully',
    'hand_id', p_hand_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_orphan_hands(
  p_older_than INTERVAL DEFAULT '10 minutes'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_ids UUID[];
  v_count INTEGER;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;

  -- The caller cannot use a zero or negative interval to void current hands,
  -- nor extend this recovery operation beyond its documented one-hour cap.
  IF p_older_than IS NULL
     OR p_older_than < INTERVAL '10 minutes'
     OR p_older_than > INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('error', 'invalid_cleanup_window');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.clubs c
    WHERE public.is_club_tracker(v_actor, c.id)
  ) THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed');
  END IF;

  WITH updated AS (
    UPDATE public.tournament_hands h
    SET status = 'voided',
        is_voided = true,
        locked_by_user_id = NULL,
        locked_at = NULL,
        updated_at = NOW()
    FROM public.tournaments t
    WHERE h.tournament_id = t.id
      AND h.status = 'in_progress'
      AND public.is_club_tracker(v_actor, t.club_id)
      AND (
        h.locked_by_user_id IS NULL
        OR h.locked_by_user_id = v_actor
        OR public.is_club_owner(v_actor, t.club_id)
      )
      AND (
        h.locked_at < NOW() - p_older_than
        OR (h.locked_at IS NULL AND h.created_at < NOW() - p_older_than)
        OR h.created_at < NOW() - (p_older_than * 6)
      )
    RETURNING h.id
  )
  SELECT array_agg(id), count(*)
  INTO v_ids, v_count
  FROM updated;

  IF v_count IS NULL OR v_count = 0 THEN
    RETURN jsonb_build_object('status', 'success', 'voided_count', 0);
  END IF;

  DELETE FROM public.hand_actions WHERE hand_id = ANY(v_ids);
  DELETE FROM public.tournament_eliminations WHERE hand_id = ANY(v_ids);
  UPDATE public.hand_players
  SET hole_cards = '[]'::jsonb,
      ending_stack = NULL,
      is_eliminated = false
  WHERE hand_id = ANY(v_ids);

  RETURN jsonb_build_object(
    'status', 'success',
    'voided_count', v_count,
    'voided_ids', v_ids
  );
END;
$function$;

-- No source or Edge caller uses this superseded writer. The lock-aware
-- delete_last_action RPC is the only supported undo path after 12005.
REVOKE ALL ON FUNCTION public.undo_last_action(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.void_last_hand(UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.void_last_hand(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.cleanup_orphan_hands(INTERVAL)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_orphan_hands(INTERVAL)
  TO authenticated;

COMMIT;
