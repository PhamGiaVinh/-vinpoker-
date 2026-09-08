\set ON_ERROR_STOP on

-- Disposable rehearsal of the exact owner-gated production repair artifact.
INSERT INTO public.tournaments (id, club_id, name, status) VALUES (
  '00000000-0000-0000-0000-000000000109',
  '00000000-0000-0000-0000-000000000010',
  'TEST — Felt UAT (compact)',
  'active'
);
INSERT INTO public.game_tables (id, club_id, table_name, table_number, operational_status) VALUES (
  '00000000-0000-0000-0000-000000000530',
  '00000000-0000-0000-0000-000000000010',
  'Bàn 5', 55, 'available'
);
INSERT INTO public.table_sessions (
  id, club_id, game_table_id, session_type, tournament_id,
  control_mode, control_epoch, revision
) VALUES (
  '00000000-0000-0000-0000-000000000630',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000530',
  'tournament', '00000000-0000-0000-0000-000000000109',
  'tracker', 1, 1
);
INSERT INTO public.tournament_tables (
  id, tournament_id, game_table_id, table_session_id,
  table_number, max_seats, status
) VALUES (
  '00000000-0000-0000-0000-000000000730',
  '00000000-0000-0000-0000-000000000109',
  '00000000-0000-0000-0000-000000000530',
  '00000000-0000-0000-0000-000000000630',
  55, 9, 'active'
);

INSERT INTO public.tournament_seats (
  tournament_id, player_id, entry_number, table_id, tournament_table_id,
  table_session_id, seat_number, chip_count, entry_id, is_active, status, player_name
) VALUES
  ('00000000-0000-0000-0000-000000000109','91cf8dab-fac3-4b70-9da9-7f94802f5078',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,1,2000000,NULL,true,'active','Test 1'),
  ('00000000-0000-0000-0000-000000000109','4b15b3b0-cf0c-4a3b-8072-b0d29f3d1ea6',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,2,2000000,NULL,true,'active','Test 2'),
  ('00000000-0000-0000-0000-000000000109','329b37ad-7e71-4239-8c8d-b28c5c858de4',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,3,2000000,NULL,true,'active','Test 3'),
  ('00000000-0000-0000-0000-000000000109','ada51a88-d93c-4648-8f90-e9905d4cedd9',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,4,2000000,NULL,true,'active','Test 4'),
  ('00000000-0000-0000-0000-000000000109','14405531-7688-4acc-b8be-fefc1322bc5d',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,5,2000000,NULL,true,'active','Test 5'),
  ('00000000-0000-0000-0000-000000000109','a209ae6e-4588-4e3b-b5f1-e1aa04454588',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,6,2000000,NULL,true,'active','Test 6'),
  ('00000000-0000-0000-0000-000000000109','0b199ee9-736b-4ed1-ac24-0d60fd3fcf61',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,7,2000000,NULL,true,'active','Test 7'),
  ('00000000-0000-0000-0000-000000000109','dfdea493-0585-4619-974e-20edc13b5ffb',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,8,2000000,NULL,true,'active','Test 8'),
  ('00000000-0000-0000-0000-000000000109','68ff52c6-10de-400d-8a59-35460e052414',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730',NULL,9,2000000,NULL,true,'active','Test 9');

INSERT INTO public.tournament_chip_counts (tournament_id, player_id, entry_number, chip_count)
SELECT '00000000-0000-0000-0000-000000000109', player_id, 1, 2000000
FROM public.tournament_seats
WHERE tournament_id='00000000-0000-0000-0000-000000000109';

\ir ../../scripts/production/repairs/repair_tracker_test_roster_entries_ban5.sql

SELECT public.floor_table_v3_assert(
  (SELECT count(*)=9 FROM public.tournament_entries WHERE tournament_id='00000000-0000-0000-0000-000000000109')
  AND (SELECT count(DISTINCT entry_id)=9 FROM public.tournament_seats WHERE tournament_id='00000000-0000-0000-0000-000000000109' AND is_active)
  AND (SELECT count(*)=9 FROM public.tournament_seats WHERE tournament_id='00000000-0000-0000-0000-000000000109' AND table_session_id='00000000-0000-0000-0000-000000000630' AND is_active)
  AND (SELECT sum(chip_count)=18000000 FROM public.tournament_seats WHERE tournament_id='00000000-0000-0000-0000-000000000109' AND is_active)
  AND (SELECT sum(chip_count)=18000000 FROM public.tournament_chip_counts WHERE tournament_id='00000000-0000-0000-0000-000000000109'),
  'exact Test repair creates nine canonical links without changing chips'
);

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  v_seats jsonb;
BEGIN
  SELECT r.seats INTO v_seats
  FROM public.get_floor_tournament_table_roster_v3('00000000-0000-0000-0000-000000000109') r
  WHERE r.tournament_table_id='00000000-0000-0000-0000-000000000730'
    AND r.table_session_id='00000000-0000-0000-0000-000000000630';

  PERFORM public.floor_table_v3_assert(
    jsonb_array_length(v_seats)=9
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_seats) item
      WHERE item ->> 'entry_id' IS NULL OR item ->> 'player_id' IS NULL
    ),
    'authenticated Floor V3 roster reads all repaired Test entries'
  );
END;
$$;
COMMIT;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
DO $$
DECLARE
  v_context jsonb;
BEGIN
  v_context := public.validate_tracker_table_writer_context_v3(
    '00000000-0000-0000-0000-000000000109',
    '00000000-0000-0000-0000-000000000730',
    '00000000-0000-0000-0000-000000000630',
    1
  );
  PERFORM public.floor_table_v3_assert(
    (v_context ->> 'ok')::boolean,
    'Tracker writer context accepts the repaired active session'
  );
END;
$$;
COMMIT;

SELECT 'TRACKER_TEST_ROSTER_REPAIR_DISPOSABLE_PASS' AS result;
