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
  UPDATE public.tournament_entries SET registration_id='00000000-0000-0000-0000-000000000939'
    WHERE id='00000000-0000-0000-0000-000000000831';
  PERFORM public.floor_table_v3_assert((SELECT current_stack=(SELECT chip_count FROM public.tournament_seats
    WHERE entry_id='00000000-0000-0000-0000-000000000831' AND status='busted' ORDER BY assigned_at DESC NULLS LAST,id DESC LIMIT 1)
    FROM public.get_floor_restorable_entries_v3(s.tournament_id) WHERE entry_id='00000000-0000-0000-0000-000000000831'),
    'confirmation stack comes from the busted seat, not the zeroed entry');
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
  INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count)
    SELECT tournament_id,player_id,entry_no,0 FROM public.tournament_entries WHERE id='00000000-0000-0000-0000-000000000831'
    ON CONFLICT(tournament_id,player_id,entry_number) DO UPDATE SET chip_count=0;
  result:=public.floor_restore_busted_player_to_seat_v5(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,rid,s.id);
  PERFORM public.floor_table_v3_assert(result->>'ok'='true','restore fixture has a valid evidenced busted entry');
  PERFORM public.floor_table_v3_assert((SELECT c.chip_count=e.current_stack FROM public.tournament_chip_counts c
    JOIN public.tournament_entries e ON e.tournament_id=c.tournament_id AND e.player_id=c.player_id AND e.entry_no=c.entry_number
    WHERE e.id='00000000-0000-0000-0000-000000000831'),'restored stack replaces stale zero Tracker canonical count');
  replay:=public.floor_restore_busted_player_to_seat_v5(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',4,s.revision,s.control_epoch,rid,s.id);
  PERFORM public.floor_table_v3_assert(replay->>'error'='IDEMPOTENCY_CONFLICT','restore wrapper rejects same key with another seat');
  replay:=public.floor_restore_busted_player_to_seat_v5(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,rid,s.id);
  PERFORM public.floor_table_v3_assert(replay=result,'lost response returns the identical successful receipt');
  replay:=public.floor_restore_busted_player_to_seat_v5(
    '00000000-0000-0000-0000-000000000831','00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,rid,'00000000-0000-0000-0000-000000000672');
  PERFORM public.floor_table_v3_assert(replay->>'error'='IDEMPOTENCY_CONFLICT','same key cannot claim another session');
  PERFORM public.floor_table_v3_assert(
    NOT has_function_privilege('authenticated','floor_private.restore_busted_player_to_seat(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.floor_restore_busted_player_to_seat_v5(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE'),
    'internal implementation and anonymous v5 access remain closed');
  PERFORM public.floor_table_v3_assert((SELECT players_remaining=(SELECT count(*) FROM public.tournament_seats WHERE tournament_id=s.tournament_id AND is_active) FROM public.tournaments WHERE id=s.tournament_id),'remaining-player count reflects restored seat');
  UPDATE public.tournament_seats SET is_active=false WHERE table_session_id=s.id AND entry_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000831';
  UPDATE public.table_sessions SET control_mode='tracker' WHERE id=s.id;
  replay:=public.start_tracker_hand_v3(s.tournament_id,'00000000-0000-0000-0000-000000000770',s.id,s.control_epoch,777,now(),auth.uid(),3);
  PERFORM public.floor_table_v3_assert(replay->>'status'='success','restored entry can start a Tracker hand');
  PERFORM public.floor_table_v3_assert((SELECT hp.starting_stack=e.current_stack FROM public.hand_players hp
    JOIN public.tournament_entries e ON e.player_id=hp.player_id AND e.entry_no=hp.entry_number AND e.tournament_id=hp.tournament_id
    WHERE hp.hand_id=(replay->>'hand_id')::uuid AND e.id='00000000-0000-0000-0000-000000000831'),
    'Tracker snapshots evidenced restored stack rather than stale count');
END $$;
ROLLBACK;
BEGIN;
ALTER TABLE public.tournament_hands DROP CONSTRAINT tournament_hands_table_session_match_v3_fkey;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
UPDATE public.tournament_seats SET is_active=false,tournament_table_id=NULL,table_session_id=NULL WHERE table_session_id='00000000-0000-0000-0000-000000000670';
UPDATE public.table_sessions SET closed_at=now() WHERE id='00000000-0000-0000-0000-000000000670';
INSERT INTO public.table_sessions(id,club_id,game_table_id,session_type,tournament_id,control_mode,revision,control_epoch,opened_by)
SELECT '00000000-0000-0000-0000-000000000672',club_id,game_table_id,session_type,tournament_id,'manual',revision,control_epoch,opened_by
FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000670';
UPDATE public.tournament_tables SET table_session_id='00000000-0000-0000-0000-000000000672' WHERE id='00000000-0000-0000-0000-000000000770';
DO $$ DECLARE s public.table_sessions%ROWTYPE; result jsonb; BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id='00000000-0000-0000-0000-000000000672';
  result:=public.floor_restore_busted_player_to_seat_v5('00000000-0000-0000-0000-000000000831',
    '00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid(),'00000000-0000-0000-0000-000000000670');
  PERFORM public.floor_table_v3_assert(result->>'error'='table_session_mismatch','delayed restore cannot migrate from old session to reopened session');
  result:=public.floor_restore_busted_player_to_seat_v3('00000000-0000-0000-0000-000000000831',
    '00000000-0000-0000-0000-000000000770',3,s.revision,s.control_epoch,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(result->>'error'='exact_session_required','legacy restore fails closed on reused physical table');
  PERFORM public.floor_table_v3_assert((SELECT status='busted' FROM public.tournament_entries WHERE id='00000000-0000-0000-0000-000000000831'),'stale restore does not mutate entry');
END $$;
ROLLBACK;
