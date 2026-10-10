-- CLI-created forward candidate43; depends on reviewed candidate42.
-- Owns exact incarnation/epoch intent, mandatory user reason and payload receipt.
-- Reuses canonical v3/v2 seat/chip/ticket transaction rather than a second writer.
-- ROLLBACK: forward revoke/drop ONLY this new endpoint after reverting its consumers;
-- retain all seats, chips, tickets, audit and receipts. No historical rewrite.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='move_player_seat_v4')
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.move_player_seat_v2(uuid,uuid,integer,bigint,bigint,uuid)'::regprocedure
     AND md5(replace(prosrc,chr(13),''))='6e0ef7706c00e2e619519564e6f51f6a'
     AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[])
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.move_player_seat_v3(uuid,uuid,integer,bigint,bigint,uuid)'::regprocedure
     AND md5(replace(prosrc,chr(13),''))='57c67989cf157f1e5245a2c8fc366396'
     AND pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'move_exact_intent_definition_drift';
 END IF;
END $$;
CREATE FUNCTION public.move_player_seat_v4(
 p_entry_id uuid,p_from_tournament_table_id uuid,p_from_table_session_id uuid,
 p_to_tournament_table_id uuid,p_to_table_session_id uuid,p_to_seat_number integer,
 p_expected_source_revision bigint,p_expected_destination_revision bigint,
 p_expected_source_epoch bigint,p_expected_destination_epoch bigint,p_reason text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid:=auth.uid(); tour public.tournaments%ROWTYPE;
 source public.tournament_tables%ROWTYPE; destination public.tournament_tables%ROWTYPE;
 source_session public.table_sessions%ROWTYPE; destination_session public.table_sessions%ROWTYPE;
 fingerprint text; receipt record; result jsonb; affected integer;
BEGIN
 IF actor IS NULL OR p_entry_id IS NULL OR p_from_tournament_table_id IS NULL
   OR p_from_table_session_id IS NULL OR p_to_tournament_table_id IS NULL OR p_to_table_session_id IS NULL
   OR p_to_seat_number IS NULL OR p_expected_source_revision IS NULL OR p_expected_destination_revision IS NULL
   OR p_expected_source_epoch IS NULL OR p_expected_destination_epoch IS NULL OR p_request_id IS NULL
   OR nullif(pg_catalog.btrim(p_reason),'') IS NULL OR pg_catalog.length(p_reason)>500 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');
 END IF;
 SELECT t.* INTO tour FROM public.tournaments t JOIN public.tournament_entries e ON e.tournament_id=t.id
   WHERE e.id=p_entry_id;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','entry_not_found'); END IF;
 IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 fingerprint:=pg_catalog.jsonb_build_object('entry',p_entry_id,'source',p_from_tournament_table_id,
   'source_session',p_from_table_session_id,'destination',p_to_tournament_table_id,
   'destination_session',p_to_table_session_id,'seat',p_to_seat_number,
   'source_revision',p_expected_source_revision,'destination_revision',p_expected_destination_revision,
   'source_epoch',p_expected_source_epoch,'destination_epoch',p_expected_destination_epoch,
   'reason',pg_catalog.btrim(p_reason))::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'move_player_seat_v4',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(actor,'move_player_seat_v4',p_request_id);
 IF FOUND THEN
   IF receipt.request_fingerprint<>fingerprint THEN
     RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
   END IF;
   RETURN receipt.result;
 END IF;
 -- Acquire the underlying receipt lock BEFORE tournament, matching direct v2
 -- writers. Never adopt a prior generic v2 operation as this new reasoned intent.
 PERFORM floor_private.floor_table_v3_lock_receipt(actor,'move_player_seat_v2',p_request_id);
 IF EXISTS(SELECT 1 FROM floor_private.floor_table_v3_existing_receipt(actor,'move_player_seat_v2',p_request_id)) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
 END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=tour.id FOR UPDATE;
 IF tour.status IN ('completed','cancelled') THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','tournament_not_open');
 END IF;
 SELECT t.* INTO source FROM public.tournament_tables t JOIN public.game_tables g ON g.id=t.game_table_id
   WHERE t.id=p_from_tournament_table_id AND t.tournament_id=tour.id AND g.club_id=tour.club_id;
 SELECT t.* INTO destination FROM public.tournament_tables t JOIN public.game_tables g ON g.id=t.game_table_id
   WHERE t.id=p_to_tournament_table_id AND t.tournament_id=tour.id AND g.club_id=tour.club_id;
 IF source.id IS NULL OR destination.id IS NULL THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','table_session_mismatch');
 END IF;
 IF source.table_session_id IS DISTINCT FROM p_from_table_session_id
   OR destination.table_session_id IS DISTINCT FROM p_to_table_session_id THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','table_session_mismatch');
 END IF;
 PERFORM 1 FROM public.game_tables g WHERE g.id IN(source.game_table_id,destination.game_table_id)
   ORDER BY g.id FOR UPDATE;
 PERFORM 1 FROM public.table_sessions s JOIN public.game_tables g ON g.id=s.game_table_id
   WHERE s.id IN(p_from_table_session_id,p_to_table_session_id) ORDER BY g.id,s.id FOR UPDATE;
 PERFORM 1 FROM public.tournament_tables t WHERE t.id IN(source.id,destination.id) ORDER BY t.id FOR UPDATE;
 SELECT * INTO source FROM public.tournament_tables WHERE id=source.id;
 SELECT * INTO destination FROM public.tournament_tables WHERE id=destination.id;
 SELECT * INTO source_session FROM public.table_sessions s WHERE s.id=p_from_table_session_id;
 SELECT * INTO destination_session FROM public.table_sessions s WHERE s.id=p_to_table_session_id;
 IF source.table_session_id IS DISTINCT FROM p_from_table_session_id
   OR destination.table_session_id IS DISTINCT FROM p_to_table_session_id
   OR source_session.id IS NULL OR destination_session.id IS NULL
   OR source_session.game_table_id IS DISTINCT FROM source.game_table_id
   OR destination_session.game_table_id IS DISTINCT FROM destination.game_table_id
   OR source_session.tournament_id IS DISTINCT FROM tour.id OR destination_session.tournament_id IS DISTINCT FROM tour.id THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','table_session_mismatch');
 END IF;
 IF source.status<>'active' OR destination.status<>'active'
   OR source_session.closed_at IS NOT NULL OR destination_session.closed_at IS NOT NULL THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','table_session_not_active');
 END IF;
 IF source_session.control_epoch IS DISTINCT FROM p_expected_source_epoch
   OR destination_session.control_epoch IS DISTINCT FROM p_expected_destination_epoch THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','STALE_CONTROL_EPOCH');
 END IF;
 IF source_session.revision IS DISTINCT FROM p_expected_source_revision
   OR destination_session.revision IS DISTINCT FROM p_expected_destination_revision THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','STALE_STATE');
 END IF;
 IF (SELECT count(*) FROM public.tournament_seats s WHERE s.entry_id=p_entry_id AND s.is_active
   AND s.tournament_id=tour.id AND s.tournament_table_id=source.id AND s.table_session_id=source_session.id)<>1 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','no_active_v3_seat');
 END IF;
 result:=public.move_player_seat_v3(p_entry_id,p_to_tournament_table_id,p_to_seat_number,
   p_expected_source_revision,p_expected_destination_revision,p_request_id);
 IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
 IF result->>'already_there' IS DISTINCT FROM 'true' THEN
   -- These rows were created by the nested writer in THIS transaction; this is
   -- not an edit to pre-existing history/ledger. Failure rolls the whole move back.
   UPDATE public.seat_assignment_history h SET reason=pg_catalog.btrim(p_reason),
     metadata=h.metadata||pg_catalog.jsonb_build_object('operation','move_player_seat_v4',
       'source_epoch',p_expected_source_epoch,'destination_epoch',p_expected_destination_epoch)
     WHERE h.entry_id=p_entry_id AND h.tournament_id=tour.id
       AND h.metadata->>'request_id'=p_request_id::text AND h.reason='canonical_move';
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected<>1 THEN RAISE EXCEPTION 'move_exact_intent_audit_missing'; END IF;
   UPDATE public.seat_draw_receipts r SET qr_payload=r.qr_payload||pg_catalog.jsonb_build_object('reason',pg_catalog.btrim(p_reason))
     WHERE r.entry_id=p_entry_id AND r.seat_id=(result->>'seat_id')::uuid AND r.status='issued'
       AND r.receipt_code=result->>'receipt_code';
   GET DIAGNOSTICS affected=ROW_COUNT;
   IF affected<>1 THEN RAISE EXCEPTION 'move_exact_intent_ticket_missing'; END IF;
 END IF;
 result:=result||pg_catalog.jsonb_build_object('reason',pg_catalog.btrim(p_reason),'request_id',p_request_id);
 PERFORM floor_private.floor_table_v3_save_receipt(actor,'move_player_seat_v4',p_request_id,fingerprint,result);
 RETURN result;
END $$;
ALTER FUNCTION public.move_player_seat_v4(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.move_player_seat_v4(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.move_player_seat_v4(uuid,uuid,uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,text,uuid) TO authenticated;
COMMIT;
