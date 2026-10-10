-- CLI-created forward candidate39. Immediate break transfers issue real tickets
-- and history atomically; deferred transfers are not falsely marked issued.
-- ROLLBACK: reviewed forward restoration of previous function body; retain all
-- tickets/history/operation receipts. No changes to chip amounts or draw policy.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 fn regprocedure:=to_regprocedure('public.floor_break_table_v5(uuid,bigint,uuid,text,text)');
 body text;
 declaration text:='v_fingerprint text; v_receipt record; v_new_seat_id uuid;';
 move_needle text:='      v_moved := v_moved + 1;';
 result_needle text:='''moved_count'', v_moved, ''pending_count'', v_pending,';
 issue text:=$issue$      UPDATE public.seat_draw_receipts
      SET status='superseded',cancelled_at=pg_catalog.now()
      WHERE entry_id=v_row.entry_id AND status IN ('issued','printed');
      v_ticket_attempt:=0;
      LOOP
        v_ticket_attempt:=v_ticket_attempt+1;
        v_ticket_code:=pg_catalog.format('T%s-S%s-%s',v_row.destination_table_number,
          v_row.destination_seat_number,pg_catalog.upper(pg_catalog.substr(
            pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,6)));
        BEGIN
          INSERT INTO public.seat_draw_receipts(
            tournament_id,registration_id,entry_id,player_id,display_name,
            table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,
            draw_type,status,issued_by
          ) SELECT v_tournament.id,e.registration_id,e.id,e.player_id,v_row.player_name,
            dst.game_table_id,v_row.destination_table_number,v_new_seat_id,
            v_row.destination_seat_number,v_ticket_code,
            pg_catalog.jsonb_build_object('v',1,'receipt_code',v_ticket_code,
              'entry_id',e.id,'tournament_id',v_tournament.id,'player_id',e.player_id,
              'table_number',v_row.destination_table_number,
              'seat_number',v_row.destination_seat_number,'reason','table_break'),
            'manual_move','issued',v_actor
          FROM public.tournament_entries e JOIN public.tournament_tables dst
            ON dst.id=v_row.destination_tournament_table_id
          WHERE e.id=v_row.entry_id AND e.tournament_id=v_tournament.id
            AND e.seat_id=v_new_seat_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'break_ticket_entry_changed'; END IF;
          EXIT;
        EXCEPTION WHEN unique_violation THEN
          IF v_ticket_attempt>=5 THEN RAISE; END IF;
        END;
      END LOOP;
      INSERT INTO public.seat_assignment_history(
        tournament_id,entry_id,player_id,from_table_id,from_table_number,
        from_seat_number,to_table_id,to_table_number,to_seat_number,
        reason,draw_type,actor_user_id,metadata
      ) SELECT v_tournament.id,v_row.entry_id,v_row.player_id,v_tt.game_table_id,
        v_tt.table_number,v_row.source_seat_number,dst.game_table_id,
        v_row.destination_table_number,v_row.destination_seat_number,
        'table_break_redraw','manual_move',v_actor,
        pg_catalog.jsonb_build_object('from_tournament_table_id',v_tt.id,
          'to_tournament_table_id',dst.id,'source_session_id',v_session.id,
          'destination_session_id',v_row.destination_table_session_id,
          'request_id',p_request_id,'draw_mode',p_draw_mode,
          'chip_count_at_move',v_row.chip_count)
      FROM public.tournament_tables dst WHERE dst.id=v_row.destination_tournament_table_id;
      v_issued_tickets:=v_issued_tickets||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('entry_id',v_row.entry_id,
          'player_name',v_row.player_name,'from_seat',v_row.source_seat_number,
          'to_table_number',v_row.destination_table_number,
          'to_seat_number',v_row.destination_seat_number,'receipt_code',v_ticket_code));
$issue$;
BEGIN
 IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
   AND md5(replace(p.prosrc,chr(13),''))='b20e5a9190a5e27a43689adecbc70083'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'break_ticket_definition_drift';
 END IF;
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 IF length(body)-length(replace(body,declaration,''))<>length(declaration)
    OR length(body)-length(replace(body,move_needle,''))<>length(move_needle)
    OR length(body)-length(replace(body,result_needle,''))<>length(result_needle) THEN
   RAISE EXCEPTION 'break_ticket_patch_not_unique';
 END IF;
 body:=replace(body,declaration,declaration||E'\n  v_ticket_code text; v_ticket_attempt integer; v_issued_tickets jsonb := ''[]''::jsonb;');
 body:=replace(body,move_needle,issue||move_needle);
 EXECUTE replace(body,result_needle,result_needle||E'\n    ''issued_tickets'', v_issued_tickets,');
END $patch$;
COMMIT;
