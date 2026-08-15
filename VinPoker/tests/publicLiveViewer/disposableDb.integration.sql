DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.get_public_tournament_event_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon snapshot execute grant missing';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.get_public_tournament_event_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated snapshot execute grant missing';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.get_public_tournament_event_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role snapshot execute grant missing';
  END IF;
  IF has_table_privilege('anon', 'public.tournament_seats', 'SELECT') THEN
    RAISE EXCEPTION 'fixture must prove RPC works without anonymous base-table SELECT';
  END IF;
END;
$$;

SET ROLE anon;

DO $$
DECLARE
  v_snapshot jsonb;
BEGIN
  v_snapshot := public.get_public_tournament_event_snapshot(
    '10000000-0000-4000-8000-000000000001'::uuid
  );

  IF v_snapshot->>'ok' <> 'true' THEN
    RAISE EXCEPTION 'snapshot failed: %', v_snapshot;
  END IF;
  IF v_snapshot::text LIKE '%player_id%' OR v_snapshot::text LIKE '%playerId%' THEN
    RAISE EXCEPTION 'snapshot exposed private player identity';
  END IF;
  IF v_snapshot #>> '{clock,phase}' <> 'running'
    OR v_snapshot #>> '{clock,isAdvancing}' <> 'true' THEN
    RAISE EXCEPTION 'running clock contract mismatch: %', v_snapshot->'clock';
  END IF;
  IF v_snapshot #>> '{clock,nextSmallBlind}' <> '75000' THEN
    RAISE EXCEPTION 'next blind must skip break level: %', v_snapshot->'clock';
  END IF;
  IF jsonb_array_length(v_snapshot->'tables') <> 2 THEN
    RAISE EXCEPTION 'active and empty table directory mismatch: %', v_snapshot->'tables';
  END IF;
  IF v_snapshot #>> '{tables,0,id}' <> '20000000-0000-4000-8000-000000000055' THEN
    RAISE EXCEPTION 'public table id must be physical game_tables.id: %', v_snapshot->'tables';
  END IF;
  IF jsonb_array_length(v_snapshot #> '{tables,0,seats}') <> 2 THEN
    RAISE EXCEPTION 'link-row seat identity was not normalized: %', v_snapshot->'tables';
  END IF;
  IF jsonb_array_length(v_snapshot #> '{tables,1,seats}') <> 0 THEN
    RAISE EXCEPTION 'running 0/9 table disappeared: %', v_snapshot->'tables';
  END IF;
  IF v_snapshot #>> '{metrics,orphanSeatCount}' <> '1' THEN
    RAISE EXCEPTION 'orphan seat diagnostic mismatch: %', v_snapshot->'metrics';
  END IF;
END;
$$;

RESET ROLE;

UPDATE public.tournaments
SET clock_paused_at = statement_timestamp()
WHERE id = '10000000-0000-4000-8000-000000000001';

SET ROLE anon;
DO $$
DECLARE v_snapshot jsonb;
BEGIN
  v_snapshot := public.get_public_tournament_event_snapshot('10000000-0000-4000-8000-000000000001');
  IF v_snapshot #>> '{clock,phase}' <> 'paused'
    OR v_snapshot #>> '{clock,isAdvancing}' <> 'false' THEN
    RAISE EXCEPTION 'paused clock contract mismatch: %', v_snapshot->'clock';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.tournaments
SET current_level = 15,
    clock_paused_at = NULL,
    clock_started_at = statement_timestamp() - interval '1 minute'
WHERE id = '10000000-0000-4000-8000-000000000001';

SET ROLE anon;
DO $$
DECLARE v_snapshot jsonb;
BEGIN
  v_snapshot := public.get_public_tournament_event_snapshot('10000000-0000-4000-8000-000000000001');
  IF v_snapshot #>> '{clock,phase}' <> 'break'
    OR v_snapshot #>> '{clock,isAdvancing}' <> 'true' THEN
    RAISE EXCEPTION 'break clock contract mismatch: %', v_snapshot->'clock';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.tournaments
SET status = 'upcoming', current_level = NULL, clock_started_at = NULL
WHERE id = '10000000-0000-4000-8000-000000000001';

SET ROLE anon;
DO $$
DECLARE v_snapshot jsonb;
BEGIN
  v_snapshot := public.get_public_tournament_event_snapshot('10000000-0000-4000-8000-000000000001');
  IF v_snapshot #>> '{clock,phase}' <> 'not_started'
    OR v_snapshot #>> '{clock,isAdvancing}' <> 'false' THEN
    RAISE EXCEPTION 'not-started clock contract mismatch: %', v_snapshot->'clock';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.tournaments
SET status = 'completed'
WHERE id = '10000000-0000-4000-8000-000000000001';

SET ROLE anon;
DO $$
DECLARE v_snapshot jsonb;
BEGIN
  v_snapshot := public.get_public_tournament_event_snapshot('10000000-0000-4000-8000-000000000001');
  IF v_snapshot #>> '{clock,phase}' <> 'completed'
    OR v_snapshot #>> '{clock,isAdvancing}' <> 'false' THEN
    RAISE EXCEPTION 'completed clock contract mismatch: %', v_snapshot->'clock';
  END IF;
END;
$$;
RESET ROLE;

SELECT 'public live viewer disposable contract passed' AS result;
