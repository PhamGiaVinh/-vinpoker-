-- ============================================================================
-- MD-1B — create_tournament_event_with_flights (atomic multi-day create)
-- ============================================================================
-- SOURCE-ONLY. Atomically creates a Main Event + N flight tournaments (A..K) +
-- one final tournament, links final_tournament_id, and seeds the (shared) blind
-- structure into every flight + the final. One transaction → no partial event.
-- Flights share buy-in/rake/starting_stack; blinds start identical and are edited
-- per flight later. Floor picks qualifiers later (MD-2). itm_percent is per-flight.
--
-- Auth: actor = auth.uid(), super_admin OR club owner. SECURITY DEFINER (writes
-- across tournament_events/tournaments/tournament_levels under one txn). REVOKE
-- PUBLIC/anon, GRANT authenticated.
--
-- ROLLBACK: DROP FUNCTION public.create_tournament_event_with_flights(...).
-- Controlled apply only. NO db push / deploy_db / schema_migrations.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_tournament_event_with_flights(
  p_club_id              uuid,
  p_name                 text,
  p_itm_percent          numeric,
  p_buy_in               integer,
  p_rake_amount          integer,
  p_starting_stack       integer,
  p_game_type            text,
  p_minutes_per_level    integer,
  p_late_reg_close_level integer,
  p_flight_count         integer,        -- 1..11  → flights A..K
  p_final_start_time     timestamptz,
  p_flight_start_times   jsonb DEFAULT NULL,  -- optional [ts,...] per flight
  p_levels               jsonb DEFAULT NULL   -- shared blind levels (flights + final)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor      uuid := auth.uid();
  v_authorized boolean;
  v_event_id   uuid;
  v_final_id   uuid;
  v_flight_id  uuid;
  v_label      text;
  v_start      timestamptz;
  v_tid        uuid;
  v_level      jsonb;
  v_tids       uuid[];
  i            integer;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT (has_role(v_actor, 'super_admin'::app_role)
          OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id AND c.owner_id = v_actor))
    INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF COALESCE(TRIM(p_name), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'name_required');
  END IF;
  IF p_flight_count IS NULL OR p_flight_count < 1 OR p_flight_count > 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_flight_count');  -- A..K
  END IF;

  -- 1. parent event
  INSERT INTO public.tournament_events (club_id, name, itm_percent, buy_in, rake_amount, starting_stack, status)
  VALUES (p_club_id, p_name, COALESCE(p_itm_percent, 0), p_buy_in, COALESCE(p_rake_amount, 0), p_starting_stack, 'scheduled')
  RETURNING id INTO v_event_id;

  -- 2. final tournament
  -- status omitted → DB default (matches the single-day create dialog; the
  -- tournaments_status_check excludes 'scheduled').
  INSERT INTO public.tournaments
    (club_id, name, start_time, buy_in, rake_amount, starting_stack, game_type, minutes_per_level, late_reg_close_level, event_id, phase)
  VALUES
    (p_club_id, p_name || ' · Final Day', COALESCE(p_final_start_time, now()), p_buy_in, COALESCE(p_rake_amount, 0),
     p_starting_stack, COALESCE(p_game_type, 'nlh'), COALESCE(p_minutes_per_level, 20), COALESCE(p_late_reg_close_level, 6),
     v_event_id, 'final')
  RETURNING id INTO v_final_id;

  UPDATE public.tournament_events SET final_tournament_id = v_final_id, updated_at = now() WHERE id = v_event_id;
  v_tids := ARRAY[v_final_id];

  -- 3. flights A..K
  FOR i IN 1..p_flight_count LOOP
    v_label := chr(64 + i);  -- 65 = 'A'
    v_start := COALESCE((p_flight_start_times ->> (i - 1))::timestamptz, p_final_start_time, now());
    INSERT INTO public.tournaments
      (club_id, name, start_time, buy_in, rake_amount, starting_stack, game_type, minutes_per_level, late_reg_close_level, event_id, phase, flight_label)
    VALUES
      (p_club_id, p_name || ' · Flight ' || v_label, v_start, p_buy_in, COALESCE(p_rake_amount, 0),
       p_starting_stack, COALESCE(p_game_type, 'nlh'), COALESCE(p_minutes_per_level, 20), COALESCE(p_late_reg_close_level, 6),
       v_event_id, 'flight', v_label)
    RETURNING id INTO v_flight_id;
    v_tids := v_tids || v_flight_id;
  END LOOP;

  -- 4. seed the shared blind structure into every flight + final
  IF p_levels IS NOT NULL AND jsonb_typeof(p_levels) = 'array' THEN
    FOREACH v_tid IN ARRAY v_tids LOOP
      FOR v_level IN SELECT * FROM jsonb_array_elements(p_levels) LOOP
        INSERT INTO public.tournament_levels
          (tournament_id, level_number, small_blind, big_blind, ante, duration_minutes, is_break)
        VALUES (
          v_tid,
          (v_level ->> 'level_number')::int,
          COALESCE((v_level ->> 'small_blind')::int, 0),
          COALESCE((v_level ->> 'big_blind')::int, 0),
          COALESCE((v_level ->> 'ante')::int, 0),
          COALESCE((v_level ->> 'duration_minutes')::int, 0),
          COALESCE((v_level ->> 'is_break')::boolean, false)
        );
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', v_event_id,
    'final_tournament_id', v_final_id,
    'flight_count', p_flight_count
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_tournament_event_with_flights(uuid, text, numeric, integer, integer, integer, text, integer, integer, integer, timestamptz, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tournament_event_with_flights(uuid, text, numeric, integer, integer, integer, text, integer, integer, integer, timestamptz, jsonb, jsonb) TO authenticated;
