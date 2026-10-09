\set ON_ERROR_STOP on
-- Current-schema TEST only. Public producers and actual terminal-hand trigger.
-- Direct void transition below tests the DB consumer, not the full finish RPC.
BEGIN;
\if :{?TRACKER_BREAK_CASE}
SELECT set_config('test.tracker_break_case','true',true);
\else
SELECT set_config('test.tracker_break_case','false',true);
\endif
\if :{?REAL_FINISH_CASE}
SELECT set_config('test.real_finish_case','true',true);
\else
SELECT set_config('test.real_finish_case','false',true);
\endif
\if :{?CANCEL_CASE}
SELECT set_config('test.cancel_case','true',true);
\else
SELECT set_config('test.cancel_case','false',true);
\endif
\if :{?STALE_EPOCH_CASE}
SELECT set_config('test.stale_epoch_case','true',true);
\else
SELECT set_config('test.stale_epoch_case','false',true);
\endif
\if :{?BAD_RECEIPT_CASE}
SELECT set_config('test.bad_receipt_case','true',true);
\else
SELECT set_config('test.bad_receipt_case','false',true);
\endif
CREATE FUNCTION pg_temp.assert_true(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'deferred_move_intent: %',message; END IF; END $$;
INSERT INTO auth.users(id) VALUES('f7290000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7290000-0000-4000-8000-000000000002','f7290000-0000-4000-8000-000000000001','Deferred intent TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000002','Deferred intent TEST','live','playing',1);
INSERT INTO public.tournament_levels(tournament_id,level_number,small_blind,big_blind,ante,is_break) VALUES
 ('f7290000-0000-4000-8000-000000000003',1,100,100,0,false);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7290000-0000-4000-8000-000000000011','f7290000-0000-4000-8000-000000000002','Source TEST',81,'tournament','inactive','available'),
 ('f7290000-0000-4000-8000-000000000012','f7290000-0000-4000-8000-000000000002','Destination TEST',82,'tournament','inactive','available');
SELECT set_config('request.jwt.claim.sub','f7290000-0000-4000-8000-000000000001',true);
DO $$ DECLARE s jsonb; d jsonb; r jsonb; st uuid; dt uuid; ss uuid; ds uuid; e uuid; h uuid; ep bigint; sr bigint; dr bigint; BEGIN
 s:=public.floor_open_tournament_table_v3('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000011','manual',gen_random_uuid());
 d:=public.floor_open_tournament_table_v3('f7290000-0000-4000-8000-000000000003','f7290000-0000-4000-8000-000000000012','manual',gen_random_uuid());
 PERFORM pg_temp.assert_true((s->>'ok')::boolean AND (d->>'ok')::boolean,'both sessions open');
 st:=(s->>'tournament_table_id')::uuid; ss:=(s->>'table_session_id')::uuid;
 dt:=(d->>'tournament_table_id')::uuid; ds:=(d->>'table_session_id')::uuid;
 INSERT INTO public.dealer_shifts(id,club_id,tour_name,start_time,end_time)
 VALUES('f7290000-0000-4000-8000-000000000030','f7290000-0000-4000-8000-000000000002','TEST','08:00','23:00');
 INSERT INTO public.dealers(id,club_id,full_name,status)
 VALUES('f7290000-0000-4000-8000-000000000031','f7290000-0000-4000-8000-000000000002','Source dealer TEST','active');
 INSERT INTO public.dealer_attendance(id,dealer_id,shift_id,shift_date,status,check_in_time,current_state)
 VALUES('f7290000-0000-4000-8000-000000000041','f7290000-0000-4000-8000-000000000031','f7290000-0000-4000-8000-000000000030',current_date,'checked_in',now(),'available');
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.headers','{"x-vinpoker-dealer-intent":"manual","x-vinpoker-dealer-actor":"f7290000-0000-4000-8000-000000000001"}',true);
 INSERT INTO public.dealer_assignments(table_id,table_session_id,attendance_id,dealer_id,club_id,status,assigned_at)
 VALUES('f7290000-0000-4000-8000-000000000011',ss,'f7290000-0000-4000-8000-000000000041','f7290000-0000-4000-8000-000000000031','f7290000-0000-4000-8000-000000000002','assigned',now());
 r:=public.set_tracker_table_roster_seat('f7290000-0000-4000-8000-000000000003',st,1,'Source TEST',20000,NULL,false,NULL,'f7290000-0000-4000-8000-000000000001');
 PERFORM pg_temp.assert_true((r->>'ok')::boolean,'source roster');
 SELECT entry_id INTO e FROM public.tournament_seats WHERE tournament_table_id=st AND is_active;
 FOR i IN 1..2 LOOP
  r:=public.set_tracker_table_roster_seat('f7290000-0000-4000-8000-000000000003',dt,i,'Destination TEST '||i,20000,NULL,false,NULL,'f7290000-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'destination roster');
 END LOOP;
 UPDATE public.table_sessions SET control_mode='tracker' WHERE id=ds RETURNING control_epoch INTO ep;
 r:=public.start_tracker_hand_v3('f7290000-0000-4000-8000-000000000003',dt,ds,ep,1,now(),'f7290000-0000-4000-8000-000000000001',1);
 PERFORM pg_temp.assert_true(r->>'status'='success','destination hand starts'); h:=(r->>'hand_id')::uuid;
 SELECT revision INTO sr FROM public.table_sessions WHERE id=ss;
 SELECT revision INTO dr FROM public.table_sessions WHERE id=ds;
 IF current_setting('test.tracker_break_case')='true' THEN
  UPDATE public.table_sessions SET control_mode='tracker' WHERE id=ss;
  SELECT revision INTO sr FROM public.table_sessions WHERE id=ss;
  s:=public.floor_plan_break_table_v1(st,sr,'fill_lowest_table');
  PERFORM pg_temp.assert_true((s->>'ok')::boolean AND (s->>'complete')::boolean,'idle Tracker break plan is complete');
  r:=public.floor_break_table_v5(st,sr,gen_random_uuid(),'fill_lowest_table',s->>'plan_hash');
  PERFORM pg_temp.assert_true((r->>'ok')::boolean AND (r->>'break_pending')::boolean,'Tracker break queues');
  -- Attempt a legacy/direct writer, exercising the common DB trust boundary.
  BEGIN
   INSERT INTO public.tournament_hands
   SELECT (jsonb_populate_record(NULL::public.tournament_hands,
     to_jsonb(hh)||jsonb_build_object('id',gen_random_uuid(),'table_id',st,
       'tournament_table_id',st,'table_session_id',ss))).*
   FROM public.tournament_hands hh WHERE hh.id=h;
   RAISE EXCEPTION 'source hand unexpectedly started';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'source_break_pending' THEN RAISE; END IF;
  END;
 ELSE
  r:=public.floor_queue_tracker_move_v1(e,dt,3,sr,dr,gen_random_uuid());
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'ordinary last-player move queues');
 END IF;
 IF current_setting('test.cancel_case')='true' THEN
  SELECT id INTO e FROM public.floor_pending_tracker_moves WHERE entry_id=e;
  r:=public.floor_cancel_pending_tracker_move_v1(e);
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'queued move cancels through public RPC');
 ELSIF current_setting('test.stale_epoch_case')='true' THEN
  UPDATE public.table_sessions SET control_epoch=control_epoch+1 WHERE id=ss;
 ELSIF current_setting('test.bad_receipt_case')='true' THEN
  UPDATE public.table_operation_receipts SET result=jsonb_set(result,'{table_session_id}',to_jsonb(gen_random_uuid()::text))
  WHERE actor_id='f7290000-0000-4000-8000-000000000001' AND operation_type='floor_break_table_v5';
 END IF;
 IF current_setting('test.real_finish_case')='true' THEN
  r:=public.record_hand('f7290000-0000-4000-8000-000000000003',dt,1,now(),
    (SELECT jsonb_agg(jsonb_build_object('player_id',hp.player_id,
      'entry_number',hp.entry_number,'seat_number',hp.seat_number,
      'starting_stack',hp.starting_stack,'ending_stack',hp.starting_stack,
      'is_eliminated',false)) FROM public.hand_players hp WHERE hp.hand_id=h),
    '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,0,'f7290000-0000-4000-8000-000000000001');
  PERFORM pg_temp.assert_true((r->>'ok')::boolean,'public record_hand finishes: '||r::text);
 ELSE
  UPDATE public.tournament_hands SET status='voided' WHERE id=h;
 END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF current_setting('test.cancel_case')='true' THEN
  PERFORM pg_temp.assert_true((SELECT status='cancelled' FROM public.floor_pending_tracker_moves WHERE id=e),'cancel remains terminal');
  PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=ss),'cancel does not close source');
 ELSIF current_setting('test.stale_epoch_case')='true' OR current_setting('test.bad_receipt_case')='true' THEN
  PERFORM pg_temp.assert_true((SELECT status='stale' AND resolution_reason='control_mode_changed' FROM public.floor_pending_tracker_moves WHERE entry_id=e),'stale epoch rejects move');
  PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=ss),'stale epoch does not close source');
 ELSE
 RAISE NOTICE 'queue result: %', (SELECT jsonb_build_object('status',status,'reason',resolution_reason) FROM public.floor_pending_tracker_moves WHERE entry_id=e);
 PERFORM pg_temp.assert_true((SELECT status='applied' FROM public.floor_pending_tracker_moves WHERE entry_id=e),'queued move applies');
 IF current_setting('test.tracker_break_case')='true' THEN
  PERFORM pg_temp.assert_true((SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id=ss),'explicit Tracker break closes its source after move');
 ELSE
 PERFORM pg_temp.assert_true((SELECT closed_at IS NULL FROM public.table_sessions WHERE id=ss),'ordinary last-player move must not close its source');
 PERFORM pg_temp.assert_true((SELECT status='active' FROM public.tournament_tables WHERE id=st),'ordinary source logical table remains active');
 END IF;
 END IF;
 PERFORM pg_temp.assert_true((SELECT (released_at IS NOT NULL)=
   (current_setting('test.tracker_break_case')='true' AND current_setting('test.cancel_case')='false' AND current_setting('test.stale_epoch_case')='false' AND current_setting('test.bad_receipt_case')='false')
   FROM public.dealer_assignments WHERE table_session_id=ss),'dealer released only by completed explicit break');
 PERFORM pg_temp.assert_true((SELECT sum(chip_count)=60000 FROM public.tournament_seats WHERE tournament_id='f7290000-0000-4000-8000-000000000003' AND is_active),'moves preserve all active chips');
END $$;
ROLLBACK;
