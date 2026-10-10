-- CLI-created 20261010075742; reserved forward44 after source/live catalog check.
-- Read-only current seat-ticket proof. No table grants, writes or history repair.
-- ROLLBACK: forward revoke authenticated execute on both new readers; retain
-- tickets/history. Frontend must not use a buy-in snapshot as a seat-ticket fallback.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.get_floor_seat_ticket_v1(uuid,uuid,text)') IS NOT NULL THEN
   RAISE EXCEPTION 'floor_seat_ticket_reader_already_exists';
 END IF;
 IF to_regprocedure('public.get_current_floor_seat_ticket_v1(uuid,uuid,uuid)') IS NOT NULL THEN
   RAISE EXCEPTION 'floor_current_ticket_reader_already_exists';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('floor_private.floor_table_v3_actor_is_tournament_operator(uuid,uuid)')
   AND md5(replace(prosrc,chr(13),''))='6da977cdcf751746189b2b46a2a563e5'
   AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'floor_seat_ticket_authority_dependency_drift';
 END IF;
END $$;
CREATE FUNCTION public.get_floor_seat_ticket_v1(p_tournament_id uuid,p_entry_id uuid,p_receipt_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor uuid:=auth.uid(); tour public.tournaments%ROWTYPE;
 ticket public.seat_draw_receipts%ROWTYPE; seat public.tournament_seats%ROWTYPE;
 proof_count bigint; stack_at_issue bigint;
BEGIN
 IF actor IS NULL OR p_tournament_id IS NULL OR p_entry_id IS NULL
   OR p_receipt_code IS NULL OR length(p_receipt_code) NOT BETWEEN 1 AND 200 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');
 END IF;
 SELECT * INTO tour FROM public.tournaments WHERE id=p_tournament_id;
 IF tour.id IS NULL OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,tour.club_id) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 SELECT * INTO ticket FROM public.seat_draw_receipts r
   WHERE r.tournament_id=tour.id AND r.entry_id=p_entry_id AND r.receipt_code=p_receipt_code;
 IF ticket.id IS NULL THEN RETURN pg_catalog.jsonb_build_object('ok',false,'error','ticket_not_found'); END IF;
 IF ticket.status NOT IN ('issued','printed') OR ticket.cancelled_at IS NOT NULL
   OR tour.status IN ('completed','cancelled') THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','ticket_not_current');
 END IF;
 SELECT s.* INTO seat FROM public.tournament_seats s
 JOIN public.tournament_entries e ON e.id=s.entry_id AND e.tournament_id=s.tournament_id
   AND e.player_id=s.player_id AND e.entry_no=s.entry_number
   AND e.seat_id=s.id AND e.seat_number=s.seat_number AND e.status='seated'
 JOIN public.tournament_tables t ON t.id=s.tournament_table_id AND t.tournament_id=s.tournament_id
   AND t.table_session_id=s.table_session_id AND t.game_table_id=ticket.table_id
   AND t.table_number=ticket.table_number AND t.status='active'
 JOIN public.game_tables g ON g.id=t.game_table_id AND g.club_id=tour.club_id
 JOIN public.table_sessions ts ON ts.id=s.table_session_id AND ts.game_table_id=g.id
   AND ts.tournament_id=tour.id AND ts.club_id=tour.club_id AND ts.closed_at IS NULL
 WHERE s.id=ticket.seat_id AND s.entry_id=p_entry_id AND s.tournament_id=tour.id
   AND s.player_id=ticket.player_id AND s.seat_number=ticket.seat_number AND s.is_active
   AND s.status='active';
 IF seat.id IS NULL
   OR (SELECT count(*) FROM public.tournament_seats s WHERE s.entry_id=p_entry_id AND s.tournament_id=tour.id AND s.is_active)<>1
   OR (SELECT count(*) FROM public.seat_draw_receipts r WHERE r.entry_id=p_entry_id AND r.tournament_id=tour.id
       AND r.status IN ('issued','printed') AND r.cancelled_at IS NULL)<>1 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','ticket_not_current');
 END IF;
 -- Canonical immediate-break audit predates receipt_code metadata. Bind that
 -- proof by exact seat incarnation, transaction time and destination tuple;
 -- ambiguity fails closed. Move/deferred audit also binds the server code.
 SELECT count(*),min(proof.stack) INTO proof_count,stack_at_issue FROM (
   SELECT CASE WHEN (a.metadata->>'chip_count_at_move') ~ '^[0-9]{1,10}$'
       AND pg_catalog.jsonb_typeof(a.metadata->'chip_count_at_move')='number'
     THEN (a.metadata->>'chip_count_at_move')::bigint END AS stack
   FROM public.seat_assignment_history a
   WHERE a.tournament_id=tour.id AND a.entry_id=p_entry_id AND a.player_id=ticket.player_id
     AND a.to_table_id=ticket.table_id AND a.to_table_number=ticket.table_number
     AND a.to_seat_number=ticket.seat_number
     AND a.metadata->>'to_tournament_table_id'=seat.tournament_table_id::text
     AND a.metadata->>'destination_session_id'=seat.table_session_id::text
     AND (a.metadata->>'receipt_code'=ticket.receipt_code
       OR (NOT a.metadata ? 'receipt_code' AND a.created_at=ticket.issued_at
         AND seat.created_at=ticket.issued_at))
 ) proof;
 IF proof_count<>1 OR stack_at_issue IS NULL OR stack_at_issue>2147483647 THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','ticket_proof_missing');
 END IF;
 RETURN pg_catalog.jsonb_build_object('ok',true,'tournament_id',tour.id,'entry_id',p_entry_id,
   'receipt_code',ticket.receipt_code,'status',ticket.status,'tournament_table_id',seat.tournament_table_id,
   'table_session_id',seat.table_session_id,'seat_id',seat.id,'table_number',ticket.table_number,
   'seat_number',ticket.seat_number,'player_name',ticket.display_name,'stack_at_issue',stack_at_issue,
   'tournament_name',tour.name,'issued_at',ticket.issued_at);
END $$;
ALTER FUNCTION public.get_floor_seat_ticket_v1(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_floor_seat_ticket_v1(uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_seat_ticket_v1(uuid,uuid,text) TO authenticated;
-- Discover a current code without relying on the legacy broad table SELECT policy.
-- No new table grants. The proof reader owns all ticket/audit/incarnation checks.
CREATE FUNCTION public.get_current_floor_seat_ticket_v1(p_tournament_id uuid,p_entry_id uuid,p_seat_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; ticket_count bigint; code text;
BEGIN
 IF actor IS NULL OR p_tournament_id IS NULL OR p_entry_id IS NULL OR p_seat_id IS NULL THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','invalid_request');
 END IF;
 SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id;
 IF club IS NULL OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(actor,club) THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','actor_not_allowed');
 END IF;
 SELECT count(*),min(r.receipt_code) INTO ticket_count,code FROM public.seat_draw_receipts r
 WHERE r.tournament_id=p_tournament_id AND r.entry_id=p_entry_id AND r.seat_id=p_seat_id
   AND r.status IN ('issued','printed') AND r.cancelled_at IS NULL;
 IF ticket_count<>1 OR code IS NULL THEN
   RETURN pg_catalog.jsonb_build_object('ok',false,'error','ticket_not_current');
 END IF;
 RETURN public.get_floor_seat_ticket_v1(p_tournament_id,p_entry_id,code);
END $$;
ALTER FUNCTION public.get_current_floor_seat_ticket_v1(uuid,uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_current_floor_seat_ticket_v1(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_current_floor_seat_ticket_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
