\set ON_ERROR_STOP on
-- Isolated TEST only; run after tableModeRequest.disposable.sql.
-- Never run this fixture against a linked/live database.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE s public.table_sessions%ROWTYPE; result jsonb; replay jsonb; rid uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  result:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(result->>'ok'='true','restore fixture has a valid evidenced busted entry');
  replay:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',4,s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(replay->>'error'='IDEMPOTENCY_CONFLICT','restore wrapper rejects same key with another seat');
END $$;
ROLLBACK;
