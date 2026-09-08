\set ON_ERROR_STOP on
SELECT public.floor_table_v3_assert(
  (SELECT count(*)=9 FROM public.tournament_seats WHERE tournament_id='00000000-0000-0000-0000-000000000109' AND tournament_table_id='00000000-0000-0000-0000-000000000730')
  AND (SELECT count(*)=9 FROM public.tournament_entries WHERE tournament_id='00000000-0000-0000-0000-000000000109')
  AND (SELECT sum(chip_count)=18000000 FROM public.tournament_seats WHERE tournament_id='00000000-0000-0000-0000-000000000109' AND is_active),
  'partial repair changes only exact canonical table links'
);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE v jsonb; BEGIN
  SELECT seats INTO v FROM public.get_floor_tournament_table_roster_v3('00000000-0000-0000-0000-000000000109')
  WHERE tournament_table_id='00000000-0000-0000-0000-000000000730';
  PERFORM public.floor_table_v3_assert(jsonb_array_length(v)=9,'Floor roster reads nine repaired seats');
END $$;
COMMIT;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT public.floor_table_v3_assert(
  (public.validate_tracker_table_writer_context_v3('00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000630',1)->>'ok')::boolean,
  'Tracker writer context remains valid'
);
COMMIT;
SELECT 'TRACKER_TEST_ROSTER_PARTIAL_TABLE_LINK_REPAIR_PASS' AS result;
