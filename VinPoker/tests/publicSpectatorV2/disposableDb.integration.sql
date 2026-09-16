-- All IDs/data here belong to the disposable PostgreSQL service, never live.
SELECT set_config('request.jwt.claim.role','service_role',false);

DO $$
DECLARE
  v_jobs jsonb;
  v_job jsonb;
  v_source jsonb;
  v_hand_a jsonb;
  v_hand_b jsonb;
BEGIN
  v_hand_a := public.get_public_tournament_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001');
  v_hand_b := public.get_public_tournament_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002');
  IF (v_hand_a->>'bigBlind')::numeric <> 200000 THEN
    RAISE EXCEPTION 'immutable hand blind is missing';
  END IF;
  IF v_hand_a #>> '{players,0,holeCards,0}' <> 'QS'
    OR v_hand_b #>> '{players,0,holeCards,0}' <> '8D'
    OR v_hand_a::text LIKE '%8D%' OR v_hand_b::text LIKE '%QS%' THEN
    RAISE EXCEPTION 'cross-table hand cards: % / %',v_hand_a,v_hand_b;
  END IF;
  IF public.get_public_tournament_hand_v2(
    '90000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'cross-tournament hand read';
  END IF;

  v_jobs := public.claim_public_spectator_projection_v2(50);
  FOR v_job IN SELECT job FROM jsonb_array_elements(v_jobs) job LOOP
    v_source := public.get_public_spectator_projection_source_v2(
      (v_job->>'tournament_id')::uuid,v_job->>'component',(v_job->>'fencing_token')::uuid);
    IF v_job->>'component'='tables' AND jsonb_array_length(v_source #> '{payload,items}') <> 2 THEN
      RAISE EXCEPTION 'expected two independent live tables: %',v_source;
    END IF;
    IF v_job->>'component'='tables' AND (
      v_source #> '{payload,items,0,actions}' IS NULL OR
      (v_source #>> '{payload,items,0,players,0,startingStack}')::numeric <> 2000000
    ) THEN RAISE EXCEPTION 'canonical live reducer input missing'; END IF;
    IF NOT public.publish_public_spectator_projection_v2(
      (v_job->>'tournament_id')::uuid,v_job->>'component',v_job->>'group_key',
      (v_job->>'fencing_token')::uuid,v_source->'sourceVector',v_source->'payload') THEN
      RAISE EXCEPTION 'first publication failed: %',v_job;
    END IF;
  END LOOP;
END;
$$;

SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false);
DO $$
DECLARE v_snapshot jsonb;
BEGIN
  IF has_table_privilege('anon','public.hand_players','SELECT') THEN
    RAISE EXCEPTION 'fixture must not rely on direct guest hand-player access';
  END IF;
  v_snapshot := public.get_public_tournament_viewer_snapshot_v2(
    '10000000-0000-4000-8000-000000000001',
    ARRAY['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002']::uuid[],
    ARRAY['tables']::text[],'{}'::jsonb);
  IF v_snapshot #>> '{sections,tables,freshness,state}' <> 'current'
    OR jsonb_array_length(v_snapshot #> '{sections,tables,items}') <> 2 THEN
    RAISE EXCEPTION 'anonymous two-table snapshot invalid: %',v_snapshot;
  END IF;
  IF v_snapshot #>> '{sections,tables,items,0,players,0,holeCards,0}' <> 'QS'
    OR v_snapshot #>> '{sections,tables,items,1,players,0,holeCards,0}' <> '8D' THEN
    RAISE EXCEPTION 'anonymous table cards mixed or absent: %',v_snapshot;
  END IF;
  IF public.get_public_tournament_viewer_snapshot_v2(
    '10000000-0000-4000-8000-000000000001',ARRAY[]::uuid[],ARRAY['tables']::text[],'{}'::jsonb)
    #> '{sections,tables,items}' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'empty table IDs must not fetch all details';
  END IF;
END;
$$;
RESET ROLE;

SELECT set_config('request.jwt.claim.role','service_role',false);
DO $$
DECLARE v_jobs jsonb; v_job jsonb; v_source jsonb;
BEGIN
  UPDATE public.tournament_chip_counts SET chip_count=2200000
    WHERE player_id='50000000-0000-4000-8000-000000000001';
  v_jobs := public.claim_public_spectator_projection_v2(50);
  SELECT job INTO v_job FROM jsonb_array_elements(v_jobs) job
    WHERE job->>'component'='ranking' LIMIT 1;
  IF v_job IS NULL THEN RAISE EXCEPTION 'ranking work not claimed'; END IF;
  v_source := public.get_public_spectator_projection_source_v2(
    (v_job->>'tournament_id')::uuid,'ranking',(v_job->>'fencing_token')::uuid);
  UPDATE public.tournament_chip_counts SET chip_count=2400000
    WHERE player_id='50000000-0000-4000-8000-000000000001';
  IF public.publish_public_spectator_projection_v2(
    (v_job->>'tournament_id')::uuid,'ranking',v_job->>'group_key',
    (v_job->>'fencing_token')::uuid,v_source->'sourceVector',v_source->'payload') THEN
    RAISE EXCEPTION 'stale source published after new chip revision';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM spectator_projection_v2.work_groups
    WHERE component='ranking') THEN
    RAISE EXCEPTION 'new chip revision lost its pending work';
  END IF;
END;
$$;
