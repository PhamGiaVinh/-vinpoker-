-- Tracker roster canonical entry link.
--
-- New Tracker-created walk-ins must participate in the same entry-backed
-- identity contract as Floor V3. Existing malformed seats are intentionally
-- not repaired here; an operator edit fails closed until a separately reviewed
-- repair links that exact row.
--
-- ROLLBACK: re-apply the reviewed pre-hotfix function body whose production
-- SHA-256 was 46e50fb1584ff10dac38abc83c33e47add7e1118507baf3386dc449f2bc30fcb.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_tracker_table_roster_seat(
  p_tournament_id uuid,
  p_table_id uuid,
  p_seat_number integer,
  p_player_name text,
  p_chip_count integer,
  p_existing_player_id uuid DEFAULT NULL,
  p_touch_avatar boolean DEFAULT false,
  p_avatar_url text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
  v_club uuid;
  v_tt record;
  v_name text := btrim(COALESCE(p_player_name, ''));
  v_seat_id uuid;
  v_player_id uuid;
  v_entry_number integer;
  v_entry_id uuid;
  v_found boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR p_actor_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  v_actor := p_actor_user_id;

  SELECT t.club_id
  INTO v_club
  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR UPDATE;
  IF v_club IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  IF NOT (public.is_club_tracker(v_actor, v_club) OR public.is_club_floor(v_actor, v_club)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_authorized');
  END IF;

  SELECT
    tt.id,
    COALESCE(tt.game_table_id, tt.table_id) AS game_table_id,
    tt.table_session_id,
    tt.max_seats
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id
    AND (
      tt.id = p_table_id
      OR tt.game_table_id = p_table_id
      OR tt.table_id = p_table_id
    )
  ORDER BY (tt.id = p_table_id) DESC, tt.id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND OR v_tt.game_table_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id
      AND (
        h.tournament_table_id = v_tt.id
        OR h.table_id = v_tt.id
        OR h.table_session_id = v_tt.table_session_id
      )
      AND h.status = 'in_progress'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_in_progress');
  END IF;

  IF p_seat_number < 1 OR p_seat_number > COALESCE(v_tt.max_seats, 10) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_seat_number');
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_player_name');
  END IF;
  IF p_chip_count IS NULL OR p_chip_count < 0 OR p_chip_count > 1000000000000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_chip_count');
  END IF;
  IF p_touch_avatar AND p_avatar_url IS NOT NULL AND p_avatar_url !~ (
    '^https://[^/]+/storage/v1/object/public/tournament-photos/'
    || p_tournament_id::text || '/seat-avatars/[^?#]+$'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_avatar_url');
  END IF;

  SELECT s.id, s.player_id, s.entry_number, s.entry_id
  INTO v_seat_id, v_player_id, v_entry_number, v_entry_id
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND COALESCE(s.tournament_table_id, s.table_id) = v_tt.id
    AND s.seat_number = p_seat_number
    AND s.is_active = true
  ORDER BY s.id
  LIMIT 1
  FOR UPDATE;
  v_found := FOUND;

  IF v_found THEN
    IF p_existing_player_id IS NULL OR p_existing_player_id IS DISTINCT FROM v_player_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'seat_conflict');
    END IF;
    IF v_entry_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tracker_roster_entry_link_required');
    END IF;
    SELECT e.id
    INTO v_entry_id
    FROM public.tournament_entries e
    WHERE e.id = v_entry_id
      AND e.tournament_id = p_tournament_id
      AND e.player_id = v_player_id
      AND e.entry_no = v_entry_number
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tracker_roster_entry_link_required');
    END IF;

    UPDATE public.tournament_seats
    SET player_name = v_name,
        chip_count = p_chip_count,
        avatar_url = CASE WHEN p_touch_avatar THEN p_avatar_url ELSE avatar_url END
    WHERE id = v_seat_id;

    UPDATE public.tournament_entries
    SET current_stack = p_chip_count,
        updated_at = now()
    WHERE id = v_entry_id;
  ELSE
    IF p_existing_player_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'seat_gone');
    END IF;

    v_player_id := gen_random_uuid();
    v_entry_number := 1;
    BEGIN
      INSERT INTO public.tournament_seats (
        tournament_id, player_id, entry_number, table_id,
        tournament_table_id, table_session_id, seat_number, chip_count,
        is_active, player_name, avatar_url, status, assigned_by, assigned_at
      ) VALUES (
        p_tournament_id, v_player_id, v_entry_number, v_tt.id,
        v_tt.id, v_tt.table_session_id, p_seat_number, p_chip_count,
        true, v_name, CASE WHEN p_touch_avatar THEN p_avatar_url ELSE NULL END,
        'active', v_actor, now()
      )
      RETURNING id INTO v_seat_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'seat_conflict');
    END;

    INSERT INTO public.tournament_entries (
      tournament_id, registration_id, player_id, entry_no, source,
      status, current_stack, table_id, seat_id, seat_number, seated_at
    ) VALUES (
      p_tournament_id, NULL, v_player_id, v_entry_number, 'manual',
      'seated', p_chip_count, v_tt.game_table_id, v_seat_id, p_seat_number, now()
    )
    RETURNING id INTO v_entry_id;

    UPDATE public.tournament_seats
    SET entry_id = v_entry_id
    WHERE id = v_seat_id AND entry_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'tracker_roster_entry_link_atomicity_failed';
    END IF;
  END IF;

  INSERT INTO public.tournament_chip_counts (
    tournament_id, player_id, entry_number, chip_count
  ) VALUES (
    p_tournament_id, v_player_id, v_entry_number, p_chip_count
  )
  ON CONFLICT (tournament_id, player_id, entry_number)
  DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'seat', jsonb_build_object(
    'id', v_seat_id,
    'entry_id', v_entry_id,
    'player_id', v_player_id,
    'seat_number', p_seat_number,
    'player_name', v_name,
    'chip_count', p_chip_count,
    'avatar_url', (SELECT avatar_url FROM public.tournament_seats WHERE id = v_seat_id),
    'entry_number', v_entry_number
  ));
END;
$function$;

ALTER FUNCTION public.set_tracker_table_roster_seat(
  uuid, uuid, integer, text, integer, uuid, boolean, text, uuid
) OWNER TO postgres;

COMMENT ON FUNCTION public.set_tracker_table_roster_seat(
  uuid, uuid, integer, text, integer, uuid, boolean, text, uuid
) IS 'Atomically creates or edits a pre-hand Tracker roster seat with canonical tournament entry and chip projections; malformed unlinked existing seats fail closed.';

REVOKE ALL ON FUNCTION public.set_tracker_table_roster_seat(
  uuid, uuid, integer, text, integer, uuid, boolean, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_tracker_table_roster_seat(
  uuid, uuid, integer, text, integer, uuid, boolean, text, uuid
) TO authenticated, service_role;

COMMIT;
