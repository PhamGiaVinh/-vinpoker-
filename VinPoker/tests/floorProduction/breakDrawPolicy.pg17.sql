\set ON_ERROR_STOP on
\if :{?require_seat_ticket}
\else
\set require_seat_ticket false
\endif
\if :{?draw_mode}
\else
\set draw_mode fill_lowest_table
\endif
\if :{?balanced_multi}
\else
\set balanced_multi false
\endif
\if :{?require_move_ticket}
\else
\set require_move_ticket false
\endif
\if :{?move_check}
\else
\set move_check entry_link
\endif
\if :{?move_audit_failure}
\else
\set move_audit_failure false
\endif
\if :{?require_ticket_read}
\else
\set require_ticket_read false
\endif
-- Isolated planner regression, not public registration/UAT evidence.
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'vinpoker_ops_%' OR inet_server_addr()<>'127.0.0.1'::inet THEN
   RAISE EXCEPTION 'isolated loopback DB required';
 END IF;
END $$;
INSERT INTO auth.users(id) VALUES
 ('f7470000-0000-4000-8000-000000000001'),('f7470000-0000-4000-8000-000000000004');
INSERT INTO public.clubs(id,owner_id,name,region) VALUES
 ('f7470000-0000-4000-8000-000000000002','f7470000-0000-4000-8000-000000000001','Break policy TEST','TEST');
INSERT INTO public.tournaments(id,club_id,name,status,live_status,current_level) VALUES
 ('f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000002','Break policy TEST','live','playing',1);
INSERT INTO public.game_tables(id,club_id,table_name,table_number,table_type,status,operational_status) VALUES
 ('f7470000-0000-4000-8000-000000000011','f7470000-0000-4000-8000-000000000002','Source TEST',91,'tournament','inactive','available'),
 ('f7470000-0000-4000-8000-000000000012','f7470000-0000-4000-8000-000000000002','Lowest TEST',92,'tournament','inactive','available'),
 ('f7470000-0000-4000-8000-000000000013','f7470000-0000-4000-8000-000000000002','Empty higher TEST',93,'tournament','inactive','available');
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,current_stack,status,source) VALUES
 ('f7470000-0000-4000-8000-000000000031','f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000001',1,20000,'registered','manual'),
 ('f7470000-0000-4000-8000-000000000032','f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000004',1,20000,'registered','manual');
INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count) VALUES
 ('f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000001',1,20000),
 ('f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000004',1,20000);
SELECT set_config('request.jwt.claim.sub','f7470000-0000-4000-8000-000000000001',true);
SELECT set_config('test.break_require_seat_ticket', :'require_seat_ticket', true);
SELECT set_config('test.break_draw_mode', :'draw_mode', true);
SELECT set_config('test.break_balanced_multi', :'balanced_multi', true);
SELECT set_config('test.require_move_ticket', :'require_move_ticket', true);
SELECT set_config('test.move_check', :'move_check', true);
SELECT set_config('test.move_audit_failure', :'move_audit_failure', true);
SELECT set_config('test.require_ticket_read', :'require_ticket_read', true);
\if :balanced_multi
INSERT INTO auth.users(id) VALUES ('f7470000-0000-4000-8000-000000000005'),('f7470000-0000-4000-8000-000000000006');
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,current_stack,status,source) VALUES
 ('f7470000-0000-4000-8000-000000000033','f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000005',1,20000,'registered','manual'),
 ('f7470000-0000-4000-8000-000000000034','f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000006',1,20000,'registered','manual');
INSERT INTO public.tournament_chip_counts(tournament_id,player_id,entry_number,chip_count) VALUES
 ('f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000005',1,20000),
 ('f7470000-0000-4000-8000-000000000003','f7470000-0000-4000-8000-000000000006',1,20000);
\endif
\if :move_audit_failure
CREATE FUNCTION public.test_f747_move_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tournament_id='f7470000-0000-4000-8000-000000000003'::uuid THEN
   IF current_setting('test.move_check')='exact_intent' AND TG_OP='INSERT' THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'forced_f747_move_audit_failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_f747_move_audit_failure BEFORE INSERT OR UPDATE ON public.seat_assignment_history
FOR EACH ROW EXECUTE FUNCTION public.test_f747_move_audit_failure();
\endif
DO $$ DECLARE opened jsonb; assigned jsonb; plan jsonb; original_plan jsonb;
 source_table uuid; lowest_table uuid; higher_table uuid; source_session uuid;
 revision bigint; target_revision bigint; physical uuid; seat integer;
 draw_mode text:=current_setting('test.break_draw_mode');
 multi boolean:=current_setting('test.break_balanced_multi')::boolean;
 extra_entry uuid;
 destination_session uuid; source_epoch bigint; destination_epoch bigint; failure_case record;
 audit_failed boolean:=false;
 ticket_request uuid:=gen_random_uuid(); replay jsonb; BEGIN
 PERFORM set_config('role','authenticated',true);
 FOREACH physical IN ARRAY ARRAY['f7470000-0000-4000-8000-000000000011'::uuid,
   'f7470000-0000-4000-8000-000000000012'::uuid,'f7470000-0000-4000-8000-000000000013'::uuid] LOOP
   opened:=public.floor_open_tournament_table_v3('f7470000-0000-4000-8000-000000000003',physical,'manual',gen_random_uuid());
   IF opened->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture open failed: %',opened; END IF;
   IF physical='f7470000-0000-4000-8000-000000000011'::uuid THEN
     source_table:=(opened->>'tournament_table_id')::uuid; source_session:=(opened->>'table_session_id')::uuid;
   ELSIF physical='f7470000-0000-4000-8000-000000000012'::uuid THEN
     lowest_table:=(opened->>'tournament_table_id')::uuid;
   ELSE
     higher_table:=(opened->>'tournament_table_id')::uuid;
   END IF;
 END LOOP;
 assigned:=public.floor_assign_entry_to_seat_v4('f7470000-0000-4000-8000-000000000031',source_table,1,1,gen_random_uuid());
 IF assigned->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture source assign failed: %',assigned; END IF;
 assigned:=public.floor_assign_entry_to_seat_v4('f7470000-0000-4000-8000-000000000032',lowest_table,1,1,gen_random_uuid());
 IF assigned->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture destination assign failed: %',assigned; END IF;
 IF multi THEN
   seat:=2;
   FOREACH extra_entry IN ARRAY ARRAY['f7470000-0000-4000-8000-000000000033'::uuid,'f7470000-0000-4000-8000-000000000034'::uuid] LOOP
     PERFORM set_config('role','none',true);
     SELECT s.revision INTO revision FROM public.table_sessions s WHERE s.id=source_session;
     PERFORM set_config('role','authenticated',true);
     assigned:=public.floor_assign_entry_to_seat_v4(extra_entry,source_table,seat,revision,gen_random_uuid());
     IF assigned->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture multi assign failed: %',assigned; END IF;
     seat:=seat+1;
   END LOOP;
 END IF;
 PERFORM set_config('role','none',true);
 -- MOVE_CLOSE_CONCURRENCY_FIXTURE_READY
 SELECT s.revision INTO revision FROM public.table_sessions s WHERE s.id=source_session;
 IF current_setting('test.require_move_ticket')='true' THEN
   SELECT s.revision INTO target_revision FROM public.table_sessions s
     JOIN public.tournament_tables t ON t.table_session_id=s.id WHERE t.id=lowest_table;
   IF current_setting('test.move_check')='exact_intent' THEN
     SELECT s.id,s.control_epoch INTO destination_session,destination_epoch
       FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id WHERE t.id=lowest_table;
     SELECT s.control_epoch INTO source_epoch FROM public.table_sessions s WHERE s.id=source_session;
     PERFORM set_config('role','authenticated',true);
     FOR failure_case IN SELECT * FROM (VALUES
       (source_session,destination_session,source_epoch+1,destination_epoch,'STALE_CONTROL_EPOCH'),
       (source_session,destination_session,source_epoch,destination_epoch+1,'STALE_CONTROL_EPOCH'),
       (gen_random_uuid(),destination_session,source_epoch,destination_epoch,'table_session_mismatch'),
       (source_session,gen_random_uuid(),source_epoch,destination_epoch,'table_session_mismatch')
     ) cases(source_id,destination_id,source_epoch,destination_epoch,expected_error) LOOP
       assigned:=public.move_player_seat_v4('f7470000-0000-4000-8000-000000000031',source_table,
         failure_case.source_id,lowest_table,failure_case.destination_id,2,revision,target_revision,
         failure_case.source_epoch,failure_case.destination_epoch,'Cân bàn',gen_random_uuid());
       IF assigned->>'error' IS DISTINCT FROM failure_case.expected_error THEN
         RAISE EXCEPTION 'wrong exact-intent denial: % expected=%',assigned,failure_case.expected_error;
       END IF;
     END LOOP;
     assigned:=public.move_player_seat_v4('f7470000-0000-4000-8000-000000000031',source_table,source_session,
       lowest_table,destination_session,2,revision,target_revision,source_epoch,destination_epoch,'  ',gen_random_uuid());
     IF assigned->>'error' IS DISTINCT FROM 'invalid_request' THEN RAISE EXCEPTION 'empty reason accepted: %',assigned; END IF;
     PERFORM set_config('request.jwt.claim.sub','f7470000-0000-4000-8000-000000000004',true);
     assigned:=public.move_player_seat_v4('f7470000-0000-4000-8000-000000000031',source_table,source_session,
       lowest_table,destination_session,2,revision,target_revision,source_epoch,destination_epoch,'Cân bàn',gen_random_uuid());
     IF assigned->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'foreign actor accepted: %',assigned; END IF;
     PERFORM set_config('request.jwt.claim.sub','f7470000-0000-4000-8000-000000000001',true);
     BEGIN
       assigned:=public.move_player_seat_v4('f7470000-0000-4000-8000-000000000031',source_table,source_session,
         lowest_table,destination_session,2,revision,target_revision,source_epoch,destination_epoch,'Cân bàn',ticket_request);
     EXCEPTION WHEN raise_exception THEN
       IF current_setting('test.move_audit_failure')<>'true' OR SQLERRM<>'forced_f747_move_audit_failure' THEN RAISE; END IF;
       audit_failed:=true;
     END;
     IF current_setting('test.move_audit_failure')='true' THEN
       PERFORM set_config('role','none',true);
       IF NOT audit_failed OR NOT EXISTS(SELECT 1 FROM public.tournament_seats s
           WHERE s.entry_id='f7470000-0000-4000-8000-000000000031' AND s.is_active
             AND s.tournament_table_id=source_table AND s.seat_number=1 AND s.chip_count=20000)
         OR (SELECT s.revision FROM public.table_sessions s WHERE s.id=source_session)<>revision
         OR (SELECT s.revision FROM public.table_sessions s WHERE s.id=destination_session)<>target_revision
         OR EXISTS(SELECT 1 FROM public.seat_draw_receipts WHERE entry_id='f7470000-0000-4000-8000-000000000031')
         OR EXISTS(SELECT 1 FROM public.seat_assignment_history WHERE tournament_id='f7470000-0000-4000-8000-000000000003')
         OR EXISTS(SELECT 1 FROM public.table_operation_receipts WHERE request_id=ticket_request)
         OR EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='f7470000-0000-4000-8000-000000000031' AND seat_id IS NOT NULL)
         OR (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='f7470000-0000-4000-8000-000000000003' AND is_active)<>40000 THEN
         RAISE EXCEPTION 'reason audit failure did not roll back nested move/ticket/both receipts';
       END IF;
       RAISE NOTICE 'CANONICAL_MOVE_EXACT_INTENT_AUDIT_ROLLBACK_PASS';
       RETURN;
     END IF;
     IF assigned->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'exact intent failed: %',assigned; END IF;
     replay:=public.move_player_seat_v4('f7470000-0000-4000-8000-000000000031',source_table,source_session,
       lowest_table,destination_session,2,revision,target_revision,source_epoch,destination_epoch,'Cân bàn',ticket_request);
     IF replay IS DISTINCT FROM assigned THEN RAISE EXCEPTION 'exact move replay changed'; END IF;
     replay:=public.move_player_seat_v4('f7470000-0000-4000-8000-000000000031',source_table,source_session,
       lowest_table,destination_session,2,revision,target_revision,source_epoch,destination_epoch,'Bàn đóng',ticket_request);
     IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
       RAISE EXCEPTION 'same key changed reason did not conflict: %',replay;
     END IF;
     PERFORM set_config('role','none',true);
     IF (SELECT count(*) FROM public.seat_assignment_history h
         WHERE h.entry_id='f7470000-0000-4000-8000-000000000031' AND h.reason='Cân bàn'
         AND h.metadata->>'request_id'=ticket_request::text)<>1
       OR (SELECT receipt_code FROM public.seat_draw_receipts r
         WHERE r.entry_id='f7470000-0000-4000-8000-000000000031' AND r.status='issued') IS DISTINCT FROM assigned->>'receipt_code'
       OR (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='f7470000-0000-4000-8000-000000000003' AND is_active)<>40000 THEN
       RAISE EXCEPTION 'exact intent lost reason/ticket/conservation';
     END IF;
     SELECT s.revision INTO target_revision FROM public.table_sessions s WHERE s.id=destination_session;
     PERFORM set_config('role','authenticated',true);
     replay:=public.move_player_seat_v4('f7470000-0000-4000-8000-000000000031',lowest_table,destination_session,
       lowest_table,destination_session,2,target_revision,target_revision,destination_epoch,destination_epoch,'Cân bàn',gen_random_uuid());
     IF replay->>'ok' IS DISTINCT FROM 'true' OR replay->>'already_there' IS DISTINCT FROM 'true' THEN
       RAISE EXCEPTION 'exact own-seat move is not unchanged: %',replay;
     END IF;
     PERFORM set_config('role','none',true);
     IF (SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='f7470000-0000-4000-8000-000000000031')<>1
       OR (SELECT count(*) FROM public.seat_assignment_history WHERE entry_id='f7470000-0000-4000-8000-000000000031')<>1
       OR (SELECT s.revision FROM public.table_sessions s WHERE s.id=destination_session)<>target_revision THEN
       RAISE EXCEPTION 'unchanged move issued another ticket, audit or revision';
     END IF;
     RAISE NOTICE 'CANONICAL_MOVE_EXACT_INTENT_REASON_REPLAY_PASS';
     RETURN;
   END IF;
   INSERT INTO public.seat_draw_receipts(tournament_id,entry_id,player_id,display_name,
     table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,draw_type,status,issued_by)
   SELECT s.tournament_id,s.entry_id,s.player_id,'TEST previous printed ticket',
     t.game_table_id,t.table_number,s.id,s.seat_number,'TEST-MOVE-OLD','{}'::jsonb,
     'manual_move','printed','f7470000-0000-4000-8000-000000000001'
   FROM public.tournament_seats s JOIN public.tournament_tables t ON t.id=s.tournament_table_id
   WHERE s.entry_id='f7470000-0000-4000-8000-000000000031' AND s.is_active;
   PERFORM set_config('role','authenticated',true);
   BEGIN
     assigned:=public.move_player_seat_v3('f7470000-0000-4000-8000-000000000031',lowest_table,2,
       revision,target_revision,ticket_request);
   EXCEPTION WHEN raise_exception THEN
     IF current_setting('test.move_audit_failure')<>'true' OR SQLERRM<>'forced_f747_move_audit_failure' THEN RAISE; END IF;
     audit_failed:=true;
   END;
   IF current_setting('test.move_audit_failure')='true' THEN
     PERFORM set_config('role','none',true);
     IF NOT audit_failed OR NOT EXISTS(SELECT 1 FROM public.tournament_seats s
         WHERE s.entry_id='f7470000-0000-4000-8000-000000000031' AND s.is_active
           AND s.tournament_table_id=source_table AND s.seat_number=1 AND s.chip_count=20000)
       OR (SELECT s.revision FROM public.table_sessions s WHERE s.id=source_session)<>revision
       OR (SELECT s.revision FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id
         WHERE t.id=lowest_table)<>target_revision
       OR (SELECT status FROM public.seat_draw_receipts WHERE receipt_code='TEST-MOVE-OLD')<>'printed'
       OR (SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='f7470000-0000-4000-8000-000000000031')<>1
       OR EXISTS(SELECT 1 FROM public.seat_assignment_history WHERE tournament_id='f7470000-0000-4000-8000-000000000003')
       OR EXISTS(SELECT 1 FROM public.tournament_entries WHERE id='f7470000-0000-4000-8000-000000000031' AND seat_id IS NOT NULL)
       OR (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='f7470000-0000-4000-8000-000000000003' AND is_active)<>40000 THEN
       RAISE EXCEPTION 'failed audit did not atomically roll back canonical move';
     END IF;
     RAISE NOTICE 'CANONICAL_MOVE_AUDIT_FAILURE_ATOMIC_ROLLBACK_PASS';
     RETURN;
   END IF;
   IF assigned->>'ok' IS DISTINCT FROM 'true' THEN
     RAISE EXCEPTION 'canonical move failed before ticket assertion: %',assigned;
   END IF;
   replay:=public.move_player_seat_v3('f7470000-0000-4000-8000-000000000031',lowest_table,2,
     revision,target_revision,ticket_request);
   IF replay IS DISTINCT FROM assigned THEN RAISE EXCEPTION 'move replay changed result'; END IF;
   replay:=public.move_player_seat_v3('f7470000-0000-4000-8000-000000000031',lowest_table,3,
     revision,target_revision,ticket_request);
   IF replay->>'error' IS DISTINCT FROM 'IDEMPOTENCY_CONFLICT' THEN
     RAISE EXCEPTION 'same move key changed destination did not conflict: %',replay;
   END IF;
   PERFORM set_config('request.jwt.claim.sub','f7470000-0000-4000-8000-000000000004',true);
   replay:=public.move_player_seat_v3('f7470000-0000-4000-8000-000000000031',lowest_table,3,
     revision,target_revision,gen_random_uuid());
   IF replay->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN
     RAISE EXCEPTION 'unrelated actor moved another entry: %',replay;
   END IF;
   PERFORM set_config('request.jwt.claim.sub','f7470000-0000-4000-8000-000000000001',true);
   PERFORM set_config('role','none',true);
   RAISE NOTICE 'canonical move entry projection=% seats=%',
     (SELECT jsonb_build_object('entry_seat_id',e.seat_id,'entry_seat_number',e.seat_number,
       'entry_stack',e.current_stack,'active_chip_total',(SELECT sum(chip_count) FROM public.tournament_seats
         WHERE tournament_id=e.tournament_id AND is_active)) FROM public.tournament_entries e
       WHERE e.id='f7470000-0000-4000-8000-000000000031'),
     (SELECT jsonb_agg(jsonb_build_object('seat_id',s.id,'table_id',s.tournament_table_id,
       'seat_number',s.seat_number,'chip_count',s.chip_count,'active',s.is_active)) FROM public.tournament_seats s
       WHERE s.entry_id='f7470000-0000-4000-8000-000000000031');
   IF (SELECT sum(chip_count) FROM public.tournament_seats
       WHERE tournament_id='f7470000-0000-4000-8000-000000000003' AND is_active)<>40000
      OR NOT EXISTS(SELECT 1 FROM public.tournament_seats s
       WHERE s.id=(assigned->>'seat_id')::uuid AND s.entry_id='f7470000-0000-4000-8000-000000000031' AND s.is_active
       AND s.tournament_table_id=lowest_table AND s.seat_number=2 AND s.chip_count=20000) THEN
     RAISE EXCEPTION 'canonical move lost entry/seat/chip consistency: %',assigned;
   END IF;
   RAISE NOTICE 'CANONICAL_MOVE_COMMIT_REPLAY_CONSERVATION_PASS result=%',assigned;
   IF current_setting('test.move_check')='entry_link' THEN
     IF NOT EXISTS(SELECT 1 FROM public.tournament_entries e
       WHERE e.id='f7470000-0000-4000-8000-000000000031' AND e.seat_id=(assigned->>'seat_id')::uuid
         AND e.seat_number=2) THEN RAISE EXCEPTION 'canonical move did not update current entry seat linkage'; END IF;
     RETURN;
   ELSIF current_setting('test.move_check')<>'ticket' THEN
     RAISE EXCEPTION 'unknown move check';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.seat_draw_receipts r
     WHERE r.entry_id='f7470000-0000-4000-8000-000000000031' AND r.seat_id=(assigned->>'seat_id')::uuid
       AND r.seat_number=2 AND r.status IN ('issued','printed') AND r.receipt_code IS NOT NULL) THEN
     RAISE EXCEPTION 'canonical move completed without current server-issued seat ticket';
   END IF;
   IF (SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='f7470000-0000-4000-8000-000000000031'
       AND status IN ('issued','printed'))<>1
     OR (SELECT status FROM public.seat_draw_receipts WHERE receipt_code='TEST-MOVE-OLD')<>'superseded'
     OR (SELECT count(*) FROM public.seat_assignment_history
       WHERE entry_id='f7470000-0000-4000-8000-000000000031' AND metadata->>'request_id'=ticket_request::text)<>1
     OR (SELECT receipt_code FROM public.seat_draw_receipts WHERE entry_id='f7470000-0000-4000-8000-000000000031'
       AND status='issued') IS DISTINCT FROM assigned->>'receipt_code' THEN
     RAISE EXCEPTION 'move replay duplicated ticket/audit, failed supersession, or returned wrong code';
   END IF;
   IF current_setting('test.require_ticket_read')='true' THEN
     UPDATE public.tournaments SET starting_stack=10000 WHERE id='f7470000-0000-4000-8000-000000000003';
     PERFORM set_config('role','authenticated',true);
     replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
       'f7470000-0000-4000-8000-000000000031',assigned->>'receipt_code');
     IF replay->>'ok' IS DISTINCT FROM 'true' OR replay->>'stack_at_issue' IS DISTINCT FROM '20000'
       OR replay->>'receipt_code' IS DISTINCT FROM assigned->>'receipt_code'
       OR replay->>'tournament_table_id' IS DISTINCT FROM lowest_table::text THEN
       RAISE EXCEPTION 'current move ticket reader returned wrong proof/stack: %',replay;
     END IF;
     RAISE NOTICE 'CANONICAL_MOVE_TICKET_READ_CURRENT_PASS';
     replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
       'f7470000-0000-4000-8000-000000000031','TEST-MOVE-OLD');
     IF replay->>'error' IS DISTINCT FROM 'ticket_not_current' THEN RAISE EXCEPTION 'superseded ticket accepted: %',replay; END IF;
     replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
       'f7470000-0000-4000-8000-000000000032',assigned->>'receipt_code');
     IF replay->>'error' IS DISTINCT FROM 'ticket_not_found' THEN RAISE EXCEPTION 'wrong entry ticket accepted: %',replay; END IF;
     PERFORM set_config('request.jwt.claim.sub','f7470000-0000-4000-8000-000000000004',true);
     replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
       'f7470000-0000-4000-8000-000000000031',assigned->>'receipt_code');
     IF replay->>'error' IS DISTINCT FROM 'actor_not_allowed' THEN RAISE EXCEPTION 'foreign actor ticket read allowed: %',replay; END IF;
     PERFORM set_config('request.jwt.claim.sub','f7470000-0000-4000-8000-000000000001',true);
     PERFORM set_config('role','none',true);
     BEGIN
       UPDATE public.table_sessions SET closed_at=now()
       WHERE id=(assigned->>'to_table_session_id')::uuid;
       PERFORM set_config('role','authenticated',true);
       replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
         'f7470000-0000-4000-8000-000000000031',assigned->>'receipt_code');
       IF replay->>'error' IS DISTINCT FROM 'ticket_not_current' THEN RAISE EXCEPTION 'closed session ticket accepted: %',replay; END IF;
       RAISE EXCEPTION 'rollback_ticket_closed_session_case';
     EXCEPTION WHEN raise_exception THEN
       IF SQLERRM<>'rollback_ticket_closed_session_case' THEN RAISE; END IF;
     END;
     BEGIN
       UPDATE public.tournament_seats SET table_session_id=source_session,
         tournament_table_id=source_table,table_id=source_table
       WHERE id=(assigned->>'seat_id')::uuid;
       PERFORM set_config('role','authenticated',true);
       replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
         'f7470000-0000-4000-8000-000000000031',assigned->>'receipt_code');
       IF replay->>'error' IS DISTINCT FROM 'ticket_not_current' THEN RAISE EXCEPTION 'stale incarnation ticket accepted: %',replay; END IF;
       RAISE EXCEPTION 'rollback_ticket_stale_session_case';
     EXCEPTION WHEN raise_exception THEN
       IF SQLERRM<>'rollback_ticket_stale_session_case' THEN RAISE; END IF;
     END;
     BEGIN
       INSERT INTO public.seat_assignment_history(tournament_id,entry_id,player_id,
         to_table_id,to_table_number,to_seat_number,reason,draw_type,actor_user_id,metadata)
       SELECT tournament_id,entry_id,player_id,to_table_id,to_table_number,to_seat_number,
         reason,draw_type,actor_user_id,metadata FROM public.seat_assignment_history
       WHERE metadata->>'receipt_code'=assigned->>'receipt_code';
       PERFORM set_config('role','authenticated',true);
       replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
         'f7470000-0000-4000-8000-000000000031',assigned->>'receipt_code');
       IF replay->>'error' IS DISTINCT FROM 'ticket_proof_missing' THEN RAISE EXCEPTION 'ambiguous ticket audit accepted: %',replay; END IF;
       RAISE EXCEPTION 'rollback_ticket_ambiguous_audit_case';
     EXCEPTION WHEN raise_exception THEN
       IF SQLERRM<>'rollback_ticket_ambiguous_audit_case' THEN RAISE; END IF;
     END;
     PERFORM set_config('role','authenticated',true);
     replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
       'f7470000-0000-4000-8000-000000000031',assigned->>'receipt_code');
     IF replay->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'negative cases leaked fixture mutation: %',replay; END IF;
     RAISE NOTICE 'CANONICAL_MOVE_TICKET_READ_DENIALS_PASS';
   END IF;
   RETURN;
 END IF;
 PERFORM set_config('role','authenticated',true);
 plan:=public.floor_plan_break_table_v1(source_table,revision,draw_mode);
 IF plan->>'ok' IS DISTINCT FROM 'true' OR plan->>'complete' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'planner failed before policy assertion: %',plan;
 END IF;
 RAISE NOTICE 'break policy observed=%',plan;
 IF draw_mode='redraw_balanced' THEN
   IF plan->'moves'->0->>'destination_table_number' IS DISTINCT FROM '93' THEN
     RAISE EXCEPTION 'balanced policy must choose the less occupied eligible table: %',plan;
   END IF;
   replay:=public.floor_plan_break_table_v1(source_table,revision,draw_mode);
   IF replay IS DISTINCT FROM plan THEN
     RAISE EXCEPTION 'unchanged balanced preview must remain stable for hash and commit';
   END IF;
   assigned:=public.floor_break_table_v5(source_table,revision,ticket_request,draw_mode,plan->>'plan_hash');
   IF assigned->>'ok' IS DISTINCT FROM 'true' OR assigned->>'closed' IS DISTINCT FROM 'true' THEN
     RAISE EXCEPTION 'balanced plan did not commit: %',assigned;
   END IF;
   replay:=public.floor_break_table_v5(source_table,revision,ticket_request,draw_mode,plan->>'plan_hash');
   IF replay IS DISTINCT FROM assigned THEN RAISE EXCEPTION 'balanced receipt replay differs'; END IF;
   PERFORM set_config('role','none',true);
   IF (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='f7470000-0000-4000-8000-000000000003' AND is_active)<>(CASE WHEN multi THEN 80000 ELSE 40000 END)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(plan->'moves') m
        WHERE NOT EXISTS(SELECT 1 FROM public.tournament_entries e JOIN public.tournament_seats s ON s.id=e.seat_id
          WHERE e.id=(m->>'entry_id')::uuid AND s.tournament_table_id=(m->>'destination_tournament_table_id')::uuid
            AND s.seat_number=(m->>'destination_seat_number')::integer AND s.is_active)) THEN
     RAISE EXCEPTION 'balanced commit changed chips or did not use preview destination';
   END IF;
   IF multi AND ((SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id=lowest_table AND is_active)<>2
      OR (SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id=higher_table AND is_active)<>2
      OR jsonb_array_length(assigned->'issued_tickets')<>3) THEN
     RAISE EXCEPTION 'multi-mover balanced policy must progressively rebalance occupancy and issue each applied ticket: %',assigned;
   END IF;
   RETURN;
 END IF;
 IF plan->'moves'->0->>'destination_table_number' IS DISTINCT FROM '92' THEN
   RAISE EXCEPTION 'fill_lowest_table must use lowest-number eligible destination before empty higher table';
 END IF;
 original_plan:=plan;
 IF current_setting('test.break_require_seat_ticket')='true' THEN
   assigned:=public.floor_break_table_v5(source_table,revision,ticket_request,'fill_lowest_table',plan->>'plan_hash');
   IF assigned->>'ok' IS DISTINCT FROM 'true' OR assigned->>'closed' IS DISTINCT FROM 'true' THEN
     RAISE EXCEPTION 'canonical break failed before ticket assertion: %',assigned;
   END IF;
   PERFORM set_config('role','none',true);
   IF NOT EXISTS (
     SELECT 1 FROM public.seat_draw_receipts r JOIN public.tournament_entries e ON e.id=r.entry_id
     WHERE e.id='f7470000-0000-4000-8000-000000000031'
       AND r.seat_id=e.seat_id AND r.seat_number=e.seat_number
       AND r.status IN ('issued','printed') AND r.receipt_code IS NOT NULL
   ) THEN RAISE EXCEPTION 'canonical break completed without current server-issued seat ticket'; END IF;
   PERFORM set_config('role','authenticated',true);
   replay:=public.floor_break_table_v5(source_table,revision,ticket_request,'fill_lowest_table',plan->>'plan_hash');
   IF replay IS DISTINCT FROM assigned THEN RAISE EXCEPTION 'ticket receipt changed on replay'; END IF;
   PERFORM set_config('role','none',true);
   IF (SELECT count(*) FROM public.seat_draw_receipts WHERE entry_id='f7470000-0000-4000-8000-000000000031' AND status IN ('issued','printed'))<>1
      OR (SELECT count(*) FROM public.seat_assignment_history WHERE entry_id='f7470000-0000-4000-8000-000000000031' AND metadata->>'request_id'=ticket_request::text)<>1 THEN
     RAISE EXCEPTION 'replay duplicated ticket or move audit';
   END IF;
   IF assigned->'issued_tickets'->0->>'receipt_code' IS DISTINCT FROM (
      SELECT receipt_code FROM public.seat_draw_receipts WHERE entry_id='f7470000-0000-4000-8000-000000000031' AND status='issued') THEN
     RAISE EXCEPTION 'returned printable ticket does not match stored ticket';
   END IF;
   IF (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='f7470000-0000-4000-8000-000000000003' AND is_active)<>40000
      OR (SELECT closed_at IS NULL FROM public.table_sessions WHERE id=source_session) THEN
     RAISE EXCEPTION 'ticket issuance changed conservation/close postcondition';
   END IF;
   IF current_setting('test.require_ticket_read')='true' THEN
     PERFORM set_config('role','authenticated',true);
     replay:=public.get_floor_seat_ticket_v1('f7470000-0000-4000-8000-000000000003',
       'f7470000-0000-4000-8000-000000000031',assigned->'issued_tickets'->0->>'receipt_code');
     IF replay->>'ok' IS DISTINCT FROM 'true' OR replay->>'stack_at_issue' IS DISTINCT FROM '20000' THEN
       RAISE EXCEPTION 'current break ticket reader returned wrong proof/stack: %',replay;
     END IF;
     RAISE NOTICE 'CANONICAL_BREAK_TICKET_READ_CURRENT_PASS';
   END IF;
   RETURN;
 END IF;
 assigned:=public.floor_set_table_seat_lock_v1(lowest_table,2,true,'policy TEST',2,gen_random_uuid());
 IF assigned->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'fixture lock failed: %',assigned; END IF;
 plan:=public.floor_plan_break_table_v1(source_table,revision,'fill_lowest_table');
 IF plan->'moves'->0->>'destination_table_number' IS DISTINCT FROM '92'
    OR plan->'moves'->0->>'destination_seat_number' IS DISTINCT FROM '3' THEN
   RAISE EXCEPTION 'lowest-number policy must still exclude locked seat: %',plan;
 END IF;
 assigned:=public.floor_break_table_v5(source_table,revision,gen_random_uuid(),'fill_lowest_table',original_plan->>'plan_hash');
 IF assigned->>'error' IS DISTINCT FROM 'STALE_BREAK_PLAN' THEN
   RAISE EXCEPTION 'old destination plan must not commit after lock change: %',assigned;
 END IF;
 PERFORM set_config('role','none',true);
 IF (SELECT sum(chip_count) FROM public.tournament_seats WHERE tournament_id='f7470000-0000-4000-8000-000000000003' AND is_active)<>40000 THEN
   RAISE EXCEPTION 'rejected plan changed active chip total';
 END IF;
 FOR seat IN 3..9 LOOP
   SELECT s.revision INTO target_revision FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id WHERE t.id=lowest_table;
   PERFORM set_config('role','authenticated',true);
   assigned:=public.floor_set_table_seat_lock_v1(lowest_table,seat,true,'policy TEST',target_revision,gen_random_uuid());
   IF assigned->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'lowest lock failed: %',assigned; END IF;
   PERFORM set_config('role','none',true);
 END LOOP;
 PERFORM set_config('role','authenticated',true);
 plan:=public.floor_plan_break_table_v1(source_table,revision,'fill_lowest_table');
 IF plan->'moves'->0->>'destination_table_number' IS DISTINCT FROM '93' THEN
   RAISE EXCEPTION 'full/locked lowest table must fall through to eligible higher table: %',plan;
 END IF;
 PERFORM set_config('role','none',true);
 FOR seat IN 1..9 LOOP
   SELECT s.revision INTO target_revision FROM public.table_sessions s JOIN public.tournament_tables t ON t.table_session_id=s.id WHERE t.id=higher_table;
   PERFORM set_config('role','authenticated',true);
   assigned:=public.floor_set_table_seat_lock_v1(higher_table,seat,true,'policy TEST',target_revision,gen_random_uuid());
   IF assigned->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'higher lock failed: %',assigned; END IF;
   PERFORM set_config('role','none',true);
 END LOOP;
 PERFORM set_config('role','authenticated',true);
 plan:=public.floor_plan_break_table_v1(source_table,revision,'fill_lowest_table');
 IF plan->>'ok' IS DISTINCT FROM 'true' OR plan->>'complete' IS DISTINCT FROM 'false' THEN
   RAISE EXCEPTION 'no capacity must produce incomplete plan: %',plan;
 END IF;
 assigned:=public.floor_break_table_v5(source_table,revision,gen_random_uuid(),'fill_lowest_table',plan->>'plan_hash');
 IF assigned->>'error' IS DISTINCT FROM 'insufficient_capacity' THEN
   RAISE EXCEPTION 'incomplete plan must not commit: %',assigned;
 END IF;
END $$;
ROLLBACK;
\echo BREAK_DRAW_POLICY_PASS
