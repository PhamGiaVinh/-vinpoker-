-- CLI-created candidate, forward42 selected after source/live catalog checks.
-- Canonical moves must update entry linkage and issue their printable ticket
-- in the same transaction. Existing API/ACL/lock order/chip policy unchanged.
-- User-selected reason/exact-session intent requires the new consumer contract;
-- this compatibility seam records canonical_move, not a fabricated user reason.
-- ROLLBACK: reviewed forward restoration of the pre-apply function definition;
-- retain entries, seats, tickets, history and operation receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $patch$
DECLARE
 fn regprocedure:=to_regprocedure('public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)');
 body text;
 declaration text:='  v_new_seat_id uuid;';
 insertion text:=$needle$    RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN$needle$;
 result_needle text:=$needle$    'destination_revision', v_destination_revision$needle$;
 issue text:=$issue$    RETURNING id INTO v_new_seat_id;
    UPDATE public.tournament_entries
    SET seat_id=v_new_seat_id,seat_number=p_to_seat_number,
        current_stack=v_source_seat.chip_count,updated_at=pg_catalog.now()
    WHERE id=v_entry.id AND tournament_id=v_tournament.id AND status='seated';
    IF NOT FOUND THEN RAISE EXCEPTION 'canonical_move_entry_changed'; END IF;
    UPDATE public.seat_draw_receipts
    SET status='superseded',cancelled_at=pg_catalog.now()
    WHERE entry_id=v_entry.id AND status IN ('issued','printed');
    v_ticket_attempt:=0;
    LOOP
      v_ticket_attempt:=v_ticket_attempt+1;
      v_ticket_code:=pg_catalog.format('T%s-S%s-%s',v_destination_table.table_number,
        p_to_seat_number,pg_catalog.upper(pg_catalog.substr(
          pg_catalog.replace(pg_catalog.gen_random_uuid()::text,'-',''),1,6)));
      BEGIN
        INSERT INTO public.seat_draw_receipts(
          tournament_id,registration_id,entry_id,player_id,display_name,
          table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,
          draw_type,status,issued_by
        ) VALUES(v_tournament.id,v_entry.registration_id,v_entry.id,v_entry.player_id,
          coalesce(nullif(v_source_seat.player_name,''),v_entry.player_id::text),
          v_destination_table.game_table_id,v_destination_table.table_number,
          v_new_seat_id,p_to_seat_number,v_ticket_code,
          pg_catalog.jsonb_build_object('v',1,'receipt_code',v_ticket_code,
            'entry_id',v_entry.id,'tournament_id',v_tournament.id,'player_id',v_entry.player_id,
            'table_number',v_destination_table.table_number,'seat_number',p_to_seat_number,
            'reason','canonical_move'),'manual_move','issued',v_actor);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_ticket_attempt>=5 THEN RAISE; END IF;
      END;
    END LOOP;
    INSERT INTO public.seat_assignment_history(
      tournament_id,entry_id,player_id,from_table_id,from_table_number,from_seat_number,
      to_table_id,to_table_number,to_seat_number,reason,draw_type,actor_user_id,metadata
    ) VALUES(v_tournament.id,v_entry.id,v_entry.player_id,v_source_table.game_table_id,
      v_source_table.table_number,v_source_seat.seat_number,v_destination_table.game_table_id,
      v_destination_table.table_number,p_to_seat_number,'canonical_move','manual_move',v_actor,
      pg_catalog.jsonb_build_object('from_tournament_table_id',v_source_table.id,
        'to_tournament_table_id',v_destination_table.id,'source_session_id',v_source_session.id,
        'destination_session_id',v_destination_session.id,'request_id',p_request_id,
        'receipt_code',v_ticket_code,'chip_count_at_move',v_source_seat.chip_count));
  EXCEPTION WHEN unique_violation THEN$issue$;
BEGIN
 IF fn IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=fn
   AND md5(replace(p.prosrc,chr(13),''))='26357d8ccf73f15d8b9b84c29955ab9f'
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'canonical_move_ticket_definition_drift';
 END IF;
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 IF length(body)-length(replace(body,declaration,''))<>length(declaration)
   OR length(body)-length(replace(body,insertion,''))<>length(insertion)
   OR length(body)-length(replace(body,result_needle,''))<>length(result_needle) THEN
   RAISE EXCEPTION 'canonical_move_ticket_patch_not_unique';
 END IF;
 body:=replace(body,declaration,declaration||E'\n  v_ticket_code text; v_ticket_attempt integer;');
 body:=replace(body,insertion,issue);
 EXECUTE replace(body,result_needle,result_needle||$result$,
    'receipt_code', v_ticket_code,
    'player_name', coalesce(nullif(v_source_seat.player_name,''),v_entry.player_id::text),
    'from_table_number', v_source_table.table_number,
    'to_table_number', v_destination_table.table_number,
    'current_stack', v_source_seat.chip_count$result$);
END $patch$;
COMMIT;
