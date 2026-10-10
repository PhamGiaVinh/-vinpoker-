-- CLI-created; forward41 absent in source/live catalog at creation.
-- A pending reservation is not an issued seat ticket. Issue only after apply,
-- in the existing per-move subtransaction; any failure rolls back seat/ticket.
-- ROLLBACK: reviewed forward restoration of pinned consumer; keep audit and
-- issued tickets for applied moves. Never delete pending/history rows.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 fn regprocedure:='floor_private.floor_apply_tracker_moves_after_hand_v1()'::regprocedure;
 body text; needle text; replacement text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
   AND md5(replace(p.prosrc,chr(13),''))='73d2c6346bb1eab8b48bd7040c93d7a9'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'deferred_ticket_consumer_definition_drift';
 END IF;
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 needle:='  v_reason text;';
 replacement:='  v_reason text; v_ticket_code text; v_ticket_attempt integer; v_player_name text;';
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'deferred_ticket_declaration_patch_not_unique';
 END IF;
 body:=replace(body,needle,replacement);
 needle:=$text$      UPDATE public.table_sessions SET revision = revision + 1
      WHERE id IN (v_move.source_table_session_id, v_move.destination_table_session_id);$text$;
 replacement:=$text$      v_player_name:=COALESCE(NULLIF(v_seat.player_name,''),
        (SELECT NULLIF(p.display_name,'') FROM public.profiles p WHERE p.user_id=v_entry.player_id),
        v_entry.player_id::text);
      UPDATE public.seat_draw_receipts SET status='superseded',cancelled_at=pg_catalog.now()
      WHERE entry_id=v_entry.id AND status IN ('issued','printed');
      v_ticket_attempt:=0;
      LOOP
        v_ticket_attempt:=v_ticket_attempt+1;
        v_ticket_code:=pg_catalog.format('T%s-S%s-%s',v_destination.table_number,
          v_move.destination_seat_number,pg_catalog.upper(pg_catalog.substr(
            pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,6)));
        BEGIN
          INSERT INTO public.seat_draw_receipts(
            tournament_id,registration_id,entry_id,player_id,display_name,
            table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,
            draw_type,status,issued_by
          ) VALUES (
            NEW.tournament_id,v_entry.registration_id,v_entry.id,v_entry.player_id,v_player_name,
            v_destination.game_table_id,v_destination.table_number,v_new_seat_id,
            v_move.destination_seat_number,v_ticket_code,
            pg_catalog.jsonb_build_object('v',1,'receipt_code',v_ticket_code,
              'entry_id',v_entry.id,'tournament_id',NEW.tournament_id,'player_id',v_entry.player_id,
              'table_number',v_destination.table_number,'seat_number',v_move.destination_seat_number,
              'pending_move_id',v_move.id,'reason','deferred_tracker_move'),
            'manual_move','issued',v_move.requested_by
          );
          EXIT;
        EXCEPTION WHEN unique_violation THEN
          IF v_ticket_attempt>=5 THEN RAISE; END IF;
        END;
      END LOOP;
      INSERT INTO public.seat_assignment_history(
        tournament_id,entry_id,player_id,from_table_id,from_table_number,from_seat_number,
        to_table_id,to_table_number,to_seat_number,reason,draw_type,actor_user_id,metadata
      ) VALUES (
        NEW.tournament_id,v_entry.id,v_entry.player_id,v_source.game_table_id,v_source.table_number,
        v_seat.seat_number,v_destination.game_table_id,v_destination.table_number,
        v_move.destination_seat_number,
        CASE WHEN v_move.break_request_id IS NOT NULL THEN 'table_break_redraw' ELSE 'deferred_tracker_move' END,
        'manual_move',v_move.requested_by,
        pg_catalog.jsonb_build_object('pending_move_id',v_move.id,'request_id',v_move.request_id,
          'break_request_id',v_move.break_request_id,'hand_id',NEW.id,
          'from_tournament_table_id',v_source.id,'to_tournament_table_id',v_destination.id,
          'source_session_id',v_source_session.id,'destination_session_id',v_destination_session.id,
          'chip_count_at_move',v_seat.chip_count,'receipt_code',v_ticket_code)
      );
      UPDATE public.table_sessions SET revision = revision + 1
      WHERE id IN (v_move.source_table_session_id, v_move.destination_table_session_id);$text$;
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN
   RAISE EXCEPTION 'deferred_ticket_apply_patch_not_unique';
 END IF;
 EXECUTE replace(body,needle,replacement);
END $patch$;
COMMIT;
