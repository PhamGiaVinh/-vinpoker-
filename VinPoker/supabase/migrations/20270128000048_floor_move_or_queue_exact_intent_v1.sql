-- CLI-created forward48, reissued in the reserved ordered campaign catalog.
-- Owns one exact move intent and its immediate/deferred outcome, not seat/chip writes.
-- ROLLBACK: revert consumers, revoke the new endpoint in a reviewed forward migration;
-- retain pending reason, receipts, history and tickets. Never reverse applied moves blindly.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.floor_pending_tracker_moves'::regclass
     AND attname='requested_reason' AND NOT attisdropped)
   OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='move_player_seat_v5')
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.move_player_seat_v4(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)'::regprocedure
     AND md5(replace(prosrc,chr(13),''))='737256dbd19cec9d74faadf598b9e328'
     AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[])
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)'::regprocedure
     AND md5(replace(prosrc,chr(13),''))='00efba7f6c95125121233f5bf6dc9f48'
     AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'move_or_queue_definition_drift';
 END IF;
END $$;
ALTER TABLE public.floor_pending_tracker_moves ADD COLUMN IF NOT EXISTS requested_reason text;
CREATE FUNCTION public.move_player_seat_v5(
 p_entry_id uuid,p_from_tournament_table_id uuid,p_from_table_session_id uuid,
 p_to_tournament_table_id uuid,p_to_table_session_id uuid,p_to_seat_number integer,
 p_expected_source_revision bigint,p_expected_destination_revision bigint,
 p_expected_source_epoch bigint,p_expected_destination_epoch bigint,p_reason text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; fingerprint text; receipt record; result jsonb;
 source_seat integer; affected integer;
BEGIN
 IF actor IS NULL OR p_request_id IS NULL OR p_entry_id IS NULL
   OR nullif(pg_catalog.btrim(p_reason),'') IS NULL OR pg_catalog.length(p_reason)>500 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');
 END IF;
 SELECT t.club_id INTO club FROM public.tournaments t JOIN public.tournament_entries e ON e.tournament_id=t.id WHERE e.id=p_entry_id;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','entry_not_found'); END IF;
 IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,club) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 fingerprint:=pg_catalog.jsonb_build_object('entry',p_entry_id,'source',p_from_tournament_table_id,
   'source_session',p_from_table_session_id,'destination',p_to_tournament_table_id,'destination_session',p_to_table_session_id,
   'seat',p_to_seat_number,'source_revision',p_expected_source_revision,'destination_revision',p_expected_destination_revision,
   'source_epoch',p_expected_source_epoch,'destination_epoch',p_expected_destination_epoch,'reason',pg_catalog.btrim(p_reason))::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'move_player_seat_v5',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'move_player_seat_v5',p_request_id);
 IF FOUND THEN
   IF receipt.request_fingerprint<>fingerprint THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
   RETURN receipt.result;
 END IF;
 -- Child receipt locks before tournament/physical/session, matching direct writers.
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'move_player_seat_v4',p_request_id);
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'move_player_seat_v2',p_request_id);
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'floor_queue_tracker_move_v1',p_request_id);
 IF EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(actor,'move_player_seat_v4',p_request_id))
   OR EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(actor,'move_player_seat_v2',p_request_id))
   OR EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(actor,'floor_queue_tracker_move_v1',p_request_id)) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
 END IF;
 -- v4 validates exact incarnation, epoch, revisions and source under retained locks.
 result:=public.move_player_seat_v4(p_entry_id,p_from_tournament_table_id,p_from_table_session_id,
   p_to_tournament_table_id,p_to_table_session_id,p_to_seat_number,p_expected_source_revision,
   p_expected_destination_revision,p_expected_source_epoch,p_expected_destination_epoch,p_reason,p_request_id);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN
   IF result->>'error' NOT IN ('table_has_active_hand','destination_table_has_active_hand') THEN RETURN result; END IF;
   SELECT s.seat_number INTO source_seat FROM public.tournament_seats s WHERE s.entry_id=p_entry_id AND s.is_active
     AND s.tournament_table_id=p_from_tournament_table_id AND s.table_session_id=p_from_table_session_id;
   result:=public.floor_queue_tracker_move_v1(p_entry_id,p_to_tournament_table_id,p_to_seat_number,
     p_expected_source_revision,p_expected_destination_revision,p_request_id);
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
   UPDATE public.floor_pending_tracker_moves SET requested_reason=pg_catalog.btrim(p_reason)
     WHERE id=(result->>'pending_move_id')::uuid AND requested_by=actor AND request_id=p_request_id
       AND entry_id=p_entry_id AND status='pending' AND break_request_id IS NULL
       AND source_tournament_table_id=p_from_tournament_table_id AND source_table_session_id=p_from_table_session_id
       AND destination_tournament_table_id=p_to_tournament_table_id AND destination_table_session_id=p_to_table_session_id
       AND source_control_epoch=p_expected_source_epoch AND destination_control_epoch=p_expected_destination_epoch;
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected<>1 THEN RAISE EXCEPTION 'move_or_queue_pending_intent_mismatch'; END IF;
   result:=result||pg_catalog.jsonb_build_object('reason',pg_catalog.btrim(p_reason),'request_id',p_request_id,
     'from_tournament_table_id',p_from_tournament_table_id,'from_table_session_id',p_from_table_session_id,
     'to_tournament_table_id',p_to_tournament_table_id,'to_table_session_id',p_to_table_session_id,
     'from_seat_number',source_seat,'to_seat_number',p_to_seat_number);
 END IF;
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'move_player_seat_v5',p_request_id,fingerprint,result);
 RETURN result;
END $$;
ALTER FUNCTION public.move_player_seat_v5(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.move_player_seat_v5(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.move_player_seat_v5(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid) TO authenticated;
DO $patch$
DECLARE fn regprocedure:='floor_private.floor_apply_tracker_moves_after_hand_v1()'::regprocedure; body text; needle text; replacement text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND md5(replace(prosrc,chr(13),''))='abe83b6d46e7209f4756c4e5f87f4e27'
   AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'move_or_queue_consumer_definition_drift';
 END IF;
 body:=replace(pg_get_functiondef(fn),chr(13),'');
 needle:=$n$'pending_move_id',v_move.id,'reason','deferred_tracker_move'$n$;
 replacement:=$r$'pending_move_id',v_move.id,'reason',COALESCE(v_move.requested_reason,'deferred_tracker_move')$r$;
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN RAISE EXCEPTION 'move_or_queue_ticket_patch_not_unique'; END IF;
 body:=replace(body,needle,replacement);
 needle:=$n$CASE WHEN v_move.break_request_id IS NOT NULL THEN 'table_break_redraw' ELSE 'deferred_tracker_move' END$n$;
 replacement:=$r$CASE WHEN v_move.break_request_id IS NOT NULL THEN 'table_break_redraw' ELSE COALESCE(v_move.requested_reason,'deferred_tracker_move') END$r$;
 IF length(body)-length(replace(body,needle,''))<>length(needle) THEN RAISE EXCEPTION 'move_or_queue_audit_patch_not_unique'; END IF;
 EXECUTE replace(body,needle,replacement);
END $patch$;
COMMIT;
