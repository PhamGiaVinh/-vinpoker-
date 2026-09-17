-- Runs only against the disposable PostgreSQL fixture, after the existing spectator tests.
SELECT set_config('request.jwt.claim.role','service_role',false);
UPDATE public.tournament_levels SET small_blind=100000,ante=20000
WHERE tournament_id='10000000-0000-4000-8000-000000000001';
UPDATE public.tournament_hands
SET tracker_small_blind=100000,tracker_level_number=1,tracker_bba=20000
WHERE tournament_id='10000000-0000-4000-8000-000000000001';

DO $$
DECLARE v_hand jsonb; v_jobs jsonb; v_job jsonb; v_source jsonb;
BEGIN
  v_hand := public.get_public_tournament_hand_v2(
    '10000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001');
  IF v_hand->>'levelNumber'<>'1' OR v_hand->>'ante'<>'20000'
    OR v_hand->>'smallBlind'<>'100000' THEN
    RAISE EXCEPTION 'hand blind snapshot missing: %',v_hand;
  END IF;
  v_jobs := public.claim_public_spectator_projection_v2(50);
  SELECT job INTO v_job FROM jsonb_array_elements(v_jobs) job
    WHERE job->>'component'='tables' LIMIT 1;
  IF v_job IS NULL THEN RAISE EXCEPTION 'tables projection not queued'; END IF;
  v_source := public.get_public_spectator_projection_source_v2(
    (v_job->>'tournament_id')::uuid,'tables',(v_job->>'fencing_token')::uuid);
  IF v_source #>> '{payload,items,0,levelNumber}' <> '1'
    OR v_source #>> '{payload,items,0,ante}' <> '20000' THEN
    RAISE EXCEPTION 'live table blind snapshot missing: %',v_source;
  END IF;
END;
$$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',false);
INSERT INTO public.tournament_table_appearance(tournament_id,felt_color,rail_color)
VALUES ('10000000-0000-4000-8000-000000000001','#15384c','#a68b4c');
UPDATE public.tournament_table_appearance SET felt_color='#521b23'
WHERE tournament_id='10000000-0000-4000-8000-000000000001';
DO $$ BEGIN
  IF (SELECT felt_color FROM public.tournament_table_appearance
    WHERE tournament_id='10000000-0000-4000-8000-000000000001') <> '#521b23' THEN
    RAISE EXCEPTION 'owner change not visible';
  END IF;
END; $$;

SELECT set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.tournament_table_appearance(tournament_id)
    VALUES ('10000000-0000-4000-8000-000000000001')
    ON CONFLICT (tournament_id) DO UPDATE SET felt_color='#292c32';
    RAISE EXCEPTION 'cross-club write unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.tournament_table_appearance
    WHERE tournament_id='10000000-0000-4000-8000-000000000001' AND felt_color='#292c32') THEN
    RAISE EXCEPTION 'cross-club appearance changed';
  END IF;
END; $$;
RESET ROLE;

SET ROLE anon;
SELECT set_config('request.jwt.claim.role','anon',false);
DO $$ BEGIN
  IF (SELECT felt_color FROM public.tournament_table_appearance
    WHERE tournament_id='10000000-0000-4000-8000-000000000001') <> '#521b23' THEN
    RAISE EXCEPTION 'guest cannot read published table appearance';
  END IF;
  IF has_table_privilege('anon','public.tournament_table_appearance','INSERT') THEN
    RAISE EXCEPTION 'guest may write table appearance';
  END IF;
END; $$;
RESET ROLE;

UPDATE public.tournaments SET deleted_at=clock_timestamp()
WHERE id='10000000-0000-4000-8000-000000000001';
SET ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tournament_table_appearance
    WHERE tournament_id='10000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'deleted tournament appearance leaked';
  END IF;
END; $$;
RESET ROLE;
