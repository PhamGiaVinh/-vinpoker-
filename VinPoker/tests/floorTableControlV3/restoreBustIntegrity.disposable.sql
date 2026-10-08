\set ON_ERROR_STOP on
-- Isolated TEST only; run after tableModeRequest.disposable.sql.
-- Never run this fixture against a linked/live database.
CREATE TABLE IF NOT EXISTS public.tournament_close_report(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid);
CREATE TABLE IF NOT EXISTS public.tournament_prize_payments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tournament_id uuid);
\ir ../../supabase/migrations/20270128000015_floor_restore_bust_integrity_v1.sql
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE s public.table_sessions%ROWTYPE; result jsonb; replay jsonb; rid uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
  INSERT INTO public.tournament_close_report(tournament_id) VALUES(s.tournament_id);
  result:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='restore_result_dependency','closed result prevents restore');
  DELETE FROM public.tournament_close_report WHERE tournament_id=s.tournament_id;
  INSERT INTO public.tournament_prize_payments(tournament_id) VALUES(s.tournament_id);
  result:=public.floor_restore_busted_player_to_seat_v3(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='restore_result_dependency','legacy path also prevents restore after payout');
  DELETE FROM public.tournament_prize_payments WHERE tournament_id=s.tournament_id;
  INSERT INTO public.table_session_seat_locks(tournament_id,tournament_table_id,table_session_id,seat_number,reason,locked_by)
  VALUES(s.tournament_id,'00000000-0000-0000-0000-000000000770',s.id,3,'TEST restore locked seat',auth.uid());
  result:=public.floor_restore_busted_player_to_seat_v3(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='seat_locked','legacy restore cannot bypass a locked seat');
  result:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='seat_locked','current restore also respects locked seat');
  DELETE FROM public.table_session_seat_locks WHERE table_session_id=s.id AND reason='TEST restore locked seat';
  UPDATE public.tournament_tables SET max_seats=8 WHERE id='00000000-0000-0000-0000-000000000770';
  result:=public.floor_restore_busted_player_to_seat_v3(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',9,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='invalid_seat_number','eight-seat table rejects seat nine');
  UPDATE public.tournament_tables SET max_seats=9 WHERE id='00000000-0000-0000-0000-000000000770';
  UPDATE public.tournament_seats SET status='moved'
    WHERE entry_id='00000000-0000-0000-0000-000000000831' AND status='busted';
  result:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='restore_stack_evidence_missing','missing busted-seat evidence cannot grant a default stack');
  UPDATE public.tournament_seats SET status='busted'
    WHERE entry_id='00000000-0000-0000-0000-000000000831' AND status='moved';
  INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,current_stack,status)
    SELECT '00000000-0000-0000-0000-000000000839',tournament_id,player_id,entry_no+1,25000,'waiting'
    FROM public.tournament_entries WHERE id='00000000-0000-0000-0000-000000000831';
  result:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='restore_reentry_dependency','later participation prevents mistaken-bust restore');
  DELETE FROM public.tournament_entries WHERE id='00000000-0000-0000-0000-000000000839';
  PERFORM public.floor_table_v3_assert(
    NOT has_function_privilege('anon','public.floor_restore_busted_player_to_seat_v3(uuid,uuid,integer,bigint,bigint,uuid)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.floor_restore_busted_player_to_seat_v4(uuid,uuid,integer,bigint,bigint,uuid)','EXECUTE')
    AND has_function_privilege('authenticated','public.floor_restore_busted_player_to_seat_v4(uuid,uuid,integer,bigint,bigint,uuid)','EXECUTE'),
    'restore is authenticated-only on both public paths');
  result:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(result->>'ok'='true','restore fixture has a valid evidenced busted entry');
  replay:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',4,s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(replay->>'error'='IDEMPOTENCY_CONFLICT','restore wrapper rejects same key with another seat');
  replay:=public.floor_restore_busted_player_to_seat_v4(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,rid);
  PERFORM public.floor_table_v3_assert(replay=result,'lost response returns the identical successful receipt');
  PERFORM public.floor_table_v3_assert((SELECT players_remaining=(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=s.tournament_id AND is_active) FROM public.tournaments WHERE id=s.tournament_id),'remaining-player count reflects restored seat');
END $$;
ROLLBACK;
