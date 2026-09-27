-- SOURCE ONLY. Forward-only Final Day materialisation and audited correction.
-- Depends on 20270120000002 and the live Floor seat/receipt/history schema.
-- No registration, Cashier movement, denomination issuance, or payout write.
-- ROLLBACK: revoke new RPCs in a forward migration. Preserve seat, receipt,
-- revision and adjustment records; do not remove or rewrite historical facts.
DO $preflight$ BEGIN
 IF to_regclass('public.seat_draw_receipts') IS NULL
    OR to_regclass('public.seat_assignment_history') IS NULL
    OR to_regclass('public.tournament_tables') IS NULL
    OR to_regclass('public.table_sessions') IS NULL
    OR to_regclass('public.multi_day_final_participations_v1') IS NULL THEN
   RAISE EXCEPTION 'multi_day_final_seating_baseline_missing' USING ERRCODE='23514';
 END IF;
END $preflight$;

-- The fence exists before a participation or seat is looked up. A missing row
-- cannot permit two concurrent initial seats for the same Final Day player.
CREATE TABLE IF NOT EXISTS public.multi_day_final_player_fences_v1 (
 final_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
 player_id uuid NOT NULL,
 PRIMARY KEY(final_tournament_id,player_id)
);
ALTER TABLE public.multi_day_final_player_fences_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_final_player_fences_v1
 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.multi_day_final_seatings_v1 (
 participation_id uuid PRIMARY KEY REFERENCES public.multi_day_final_participations_v1(id) ON DELETE RESTRICT,
 final_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
 player_id uuid NOT NULL,
 entry_id uuid NOT NULL UNIQUE REFERENCES public.tournament_entries(id) ON DELETE RESTRICT,
 seat_id uuid NOT NULL UNIQUE REFERENCES public.tournament_seats(id) ON DELETE RESTRICT,
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.seat_draw_receipts(id) ON DELETE RESTRICT,
 seed_stack bigint NOT NULL CHECK(seed_stack>0 AND seed_stack<=2147483647),
 seed_revision integer NOT NULL CHECK(seed_revision>=0),
 source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{32}$'),
 source_bags jsonb NOT NULL CHECK(jsonb_typeof(source_bags)='array'),
 seated_by uuid NOT NULL REFERENCES auth.users(id),
 seated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(final_tournament_id,player_id)
);
ALTER TABLE public.multi_day_final_seatings_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_final_seatings_v1
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_final_seating_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_final_seatings_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE TABLE IF NOT EXISTS public.multi_day_final_stack_revisions_v1 (
 participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id) ON DELETE RESTRICT,
 revision integer NOT NULL CHECK(revision>0),
 prior_stack bigint NOT NULL CHECK(prior_stack>0),
 revised_stack bigint NOT NULL CHECK(revised_stack>0 AND revised_stack<=2147483647),
 request_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 3 AND 200),
 source_bags jsonb NOT NULL CHECK(jsonb_typeof(source_bags)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(participation_id,revision)
);
ALTER TABLE public.multi_day_final_stack_revisions_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_final_stack_revisions_v1
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_final_revision_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_final_stack_revisions_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

-- Once a seat exists, even a pre-hand discrepancy is NOT an in-place chip
-- overwrite. This linked owner-approved request is held for a later physical
-- and gameplay-safe adjustment writer; it cannot act as a second issuance.
CREATE TABLE IF NOT EXISTS public.multi_day_final_adjustments_v1 (
 request_id uuid PRIMARY KEY,
 participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id) ON DELETE RESTRICT,
 seating_participation_id uuid NOT NULL REFERENCES public.multi_day_final_seatings_v1(participation_id) ON DELETE RESTRICT,
 prior_seed_stack bigint NOT NULL CHECK(prior_seed_stack>0),
 proposed_seed_stack bigint NOT NULL CHECK(proposed_seed_stack>0),
 delta_chips bigint NOT NULL,
 seed_revision integer NOT NULL CHECK(seed_revision>=0),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref)) BETWEEN 3 AND 200),
 status text NOT NULL DEFAULT 'OWNER_APPROVED_HELD' CHECK(status='OWNER_APPROVED_HELD'),
 source_bags jsonb NOT NULL CHECK(jsonb_typeof(source_bags)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(participation_id=seating_participation_id),
 CHECK(delta_chips=proposed_seed_stack-prior_seed_stack)
);
ALTER TABLE public.multi_day_final_adjustments_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_final_adjustments_v1
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_final_adjustment_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_final_adjustments_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE TABLE IF NOT EXISTS public.multi_day_final_requests_v1 (
 request_id uuid PRIMARY KEY,
 participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 kind text NOT NULL CHECK(kind IN('seat','correct')),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.multi_day_final_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_final_requests_v1
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_final_request_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_final_requests_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

CREATE TABLE IF NOT EXISTS private.multi_day_final_write_intents_v1 (
 transaction_id bigint NOT NULL,
 backend_pid integer NOT NULL,
 kind text NOT NULL CHECK(kind IN('entry','seat')),
 row_id uuid NOT NULL,
 participation_id uuid NOT NULL,
 row_hash text NOT NULL CHECK(row_hash ~ '^[0-9a-f]{32}$'),
 consumed boolean NOT NULL DEFAULT false,
 PRIMARY KEY(transaction_id,backend_pid,kind,row_id)
);
REVOKE ALL ON private.multi_day_final_write_intents_v1
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.multi_day_final_row_hash_v1(
 p_kind text,p_id uuid,p_final uuid,p_player uuid,p_entry_id uuid,
 p_seat_id uuid,p_table_id uuid,p_session_id uuid,p_seat_number integer,p_stack bigint
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT pg_catalog.md5(pg_catalog.jsonb_build_object('kind',p_kind,'id',p_id,
   'final',p_final,'player',p_player,'entry',p_entry_id,'seat',p_seat_id,
   'table',p_table_id,'session',p_session_id,'number',p_seat_number,
   'stack',p_stack)::text)
$$;
REVOKE ALL ON FUNCTION private.multi_day_final_row_hash_v1(
 text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,bigint)
 FROM PUBLIC,anon,authenticated,service_role;

-- Replace only the package guard from migration 02. Legacy/non-package rows
-- retain their old behaviour. New package entry/seat INSERT requires a one-use
-- private intent; normal post-seat Floor state updates keep working while
-- player/entry identity remains pinned. A second seat INSERT stays held.
CREATE OR REPLACE FUNCTION private.multi_day_legacy_final_entry_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_old_event uuid; v_new_event uuid; v_event uuid; v_kind text;
 v_hash text; v_participation_id uuid; v_package boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN
   SELECT t.event_id INTO v_old_event FROM public.tournaments t
     WHERE t.id=OLD.tournament_id AND t.phase='final';
 END IF;
 IF TG_OP<>'DELETE' THEN
   SELECT t.event_id INTO v_new_event FROM public.tournaments t
     WHERE t.id=NEW.tournament_id AND t.phase='final';
 END IF;
 FOR v_event IN SELECT DISTINCT x FROM pg_catalog.unnest(ARRAY[v_old_event,v_new_event]) x
      WHERE x IS NOT NULL LOOP
   IF EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=v_event)
      OR EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l WHERE l.event_id=v_event)
      OR EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
         JOIN public.multi_day_package_release_v1 g ON g.id AND g.enabled
           AND r.club_id=ANY(g.allowed_club_ids) WHERE r.event_id=v_event) THEN
     v_package:=true;
   END IF;
 END LOOP;
 IF NOT coalesce(v_package,false) THEN
   RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'multi_day_final_source_delete_held' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' THEN
   IF TG_TABLE_NAME='tournament_entries' THEN
     IF (OLD.id,OLD.tournament_id,OLD.player_id,OLD.registration_id,
         OLD.entry_no,OLD.source) IS DISTINCT FROM
        (NEW.id,NEW.tournament_id,NEW.player_id,NEW.registration_id,
         NEW.entry_no,NEW.source)
        OR NOT EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s
           WHERE s.entry_id=OLD.id AND s.final_tournament_id=OLD.tournament_id
             AND s.player_id=OLD.player_id)
           AND NOT EXISTS(SELECT 1 FROM private.multi_day_final_write_intents_v1 i
             WHERE i.transaction_id=pg_catalog.txid_current()
               AND i.backend_pid=pg_catalog.pg_backend_pid() AND i.kind='entry'
               AND i.row_id=OLD.id AND i.consumed) THEN
       RAISE EXCEPTION 'multi_day_final_identity_immutable' USING ERRCODE='23514';
     END IF;
   ELSE
     IF (OLD.id,OLD.tournament_id,OLD.player_id,OLD.entry_id,OLD.entry_number)
          IS DISTINCT FROM
        (NEW.id,NEW.tournament_id,NEW.player_id,NEW.entry_id,NEW.entry_number)
        OR NOT EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s
           WHERE s.seat_id=OLD.id AND s.final_tournament_id=OLD.tournament_id
             AND s.player_id=OLD.player_id) THEN
       RAISE EXCEPTION 'multi_day_final_identity_immutable' USING ERRCODE='23514';
     END IF;
   END IF;
   RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
      WHERE l.event_id=v_new_event) THEN
   RAISE EXCEPTION 'multi_day_final_seating_held' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='tournament_entries' THEN
   v_kind:='entry';
   IF NEW.registration_id IS NOT NULL OR NEW.entry_no<>1 OR NEW.source<>'staff'
      OR NEW.status<>'seated' OR NEW.current_stack<=0 THEN
     RAISE EXCEPTION 'multi_day_final_entry_shape_invalid' USING ERRCODE='23514';
   END IF;
   v_hash:=private.multi_day_final_row_hash_v1('entry',NEW.id,NEW.tournament_id,
     NEW.player_id,NEW.id,NEW.seat_id,NEW.table_id,NULL,NEW.seat_number,
     NEW.current_stack);
 ELSE
   v_kind:='seat';
   IF NEW.entry_id IS NULL OR NEW.entry_number<>1 OR NOT NEW.is_active
      OR NEW.status<>'active' OR NEW.chip_count<=0 THEN
     RAISE EXCEPTION 'multi_day_final_seat_shape_invalid' USING ERRCODE='23514';
   END IF;
   v_hash:=private.multi_day_final_row_hash_v1('seat',NEW.id,NEW.tournament_id,
     NEW.player_id,NEW.entry_id,NEW.id,NEW.table_id,NEW.table_session_id,
     NEW.seat_number,NEW.chip_count);
 END IF;
 UPDATE private.multi_day_final_write_intents_v1 i SET consumed=true
   WHERE i.transaction_id=pg_catalog.txid_current()
     AND i.backend_pid=pg_catalog.pg_backend_pid()
     AND i.kind=v_kind AND i.row_id=NEW.id AND i.row_hash=v_hash
     AND NOT i.consumed
   RETURNING i.participation_id INTO v_participation_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.multi_day_final_participations_v1 p
       WHERE p.id=v_participation_id AND p.final_tournament_id=NEW.tournament_id
         AND p.player_id=NEW.player_id) THEN
   RAISE EXCEPTION 'multi_day_final_write_not_authorized' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER multi_day_final_entry_fence_v1 ON public.tournament_entries;
DROP TRIGGER multi_day_final_seat_fence_v1 ON public.tournament_seats;
CREATE TRIGGER multi_day_final_entry_fence_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_entries FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_legacy_final_entry_fence_v1();
CREATE TRIGGER multi_day_final_seat_fence_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_seats FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_legacy_final_entry_fence_v1();

CREATE FUNCTION private.multi_day_final_lock_player_v1(p_final uuid,p_player uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.multi_day_final_player_fences_v1(final_tournament_id,player_id)
 VALUES(p_final,p_player) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.multi_day_final_player_fences_v1
   WHERE final_tournament_id=p_final AND player_id=p_player FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_final_lock_player_v1(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Lock order: Final tournament, then player mutex, then table. The mutex is
-- inserted even when no participation/entry/seat exists yet. No Cashier row is
-- created: a qualified bag is carried to the final, not sold again.
CREATE FUNCTION public.multi_day_seat_final_v1(
 p_event_id uuid,p_player_id uuid,p_tournament_table_id uuid,
 p_seat_number integer,p_expected_seed_revision integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_final public.tournaments%ROWTYPE; v_part public.multi_day_final_participations_v1%ROWTYPE;
 v_table public.tournament_tables%ROWTYPE; v_session public.table_sessions%ROWTYPE;
 v_prior public.multi_day_final_requests_v1%ROWTYPE;
 v_stack bigint; v_revision integer; v_entry uuid:=gen_random_uuid();
 v_seat uuid:=gen_random_uuid(); v_receipt_id uuid:=gen_random_uuid();
 v_hash text; v_receipt jsonb; v_name text; v_invalid integer; v_consumed integer;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_player_id IS NULL OR
    p_tournament_table_id IS NULL OR p_request_id IS NULL OR
    p_seat_number IS NULL OR p_seat_number<1 OR p_expected_seed_revision IS NULL OR
    p_expected_seed_revision<0 THEN
   RAISE EXCEPTION 'multi_day_final_seat_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_rules_missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_final FROM public.tournaments WHERE id=v_rules.final_tournament_id FOR UPDATE;
 IF NOT FOUND OR v_final.event_id IS DISTINCT FROM p_event_id OR
    v_final.club_id IS DISTINCT FROM v_rules.club_id OR v_final.phase<>'final' THEN
   RAISE EXCEPTION 'multi_day_final_tournament_mismatch' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_rules.club_id AND
       (c.owner_id=v_actor OR public.is_club_floor(v_actor,v_rules.club_id))) THEN
   RAISE EXCEPTION 'multi_day_final_seat_actor_denied' USING ERRCODE='42501';
 END IF;
 PERFORM private.multi_day_final_lock_player_v1(v_final.id,p_player_id);
 SELECT * INTO v_part FROM public.multi_day_final_participations_v1
   WHERE event_id=p_event_id AND final_tournament_id=v_final.id AND player_id=p_player_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1
     WHERE event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_final_not_qualified' USING ERRCODE='23514';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('kind','seat','event',p_event_id,
   'player',p_player_id,'table',p_tournament_table_id,'number',p_seat_number,
   'revision',p_expected_seed_revision)::text);
 SELECT * INTO v_prior FROM public.multi_day_final_requests_v1 WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.actor_id IS DISTINCT FROM v_actor OR v_prior.kind<>'seat' OR
      v_prior.participation_id IS DISTINCT FROM v_part.id OR v_prior.payload_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_final_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt || pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_rules.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_final_seatings_v1 s
     WHERE s.final_tournament_id=v_final.id AND s.player_id=p_player_id) OR
    EXISTS(SELECT 1 FROM public.tournament_entries e
     WHERE e.tournament_id=v_final.id AND e.player_id=p_player_id) OR
    EXISTS(SELECT 1 FROM public.tournament_seats s
     WHERE s.tournament_id=v_final.id AND s.player_id=p_player_id) THEN
   RAISE EXCEPTION 'multi_day_final_player_already_seated' USING ERRCODE='23514';
 END IF;
 IF v_final.registration_closed_at IS NOT NULL OR
    v_final.status IN('completed','cancelled') THEN
   RAISE EXCEPTION 'multi_day_final_seating_closed' USING ERRCODE='23514';
 END IF;
 SELECT r.revision,r.revised_stack INTO v_revision,v_stack
   FROM public.multi_day_final_stack_revisions_v1 r WHERE r.participation_id=v_part.id
   ORDER BY r.revision DESC LIMIT 1;
 IF NOT FOUND THEN v_revision:=0; v_stack:=v_part.carried_stack; END IF;
 IF v_revision<>p_expected_seed_revision OR v_stack<=0 OR v_stack>2147483647 THEN
   RAISE EXCEPTION 'multi_day_final_seed_stale' USING ERRCODE='40001';
 END IF;
 SELECT count(*) INTO v_invalid FROM pg_catalog.jsonb_array_elements(v_part.source_bags) x
   LEFT JOIN public.chip_bag b ON b.id=(x->>'bagId')::uuid
   LEFT JOIN public.multi_day_flight_roster_v1 r ON r.flight_tournament_id=(x->>'flightId')::uuid
     AND r.player_id=p_player_id
   WHERE b.id IS NULL OR NOT b.sealed OR
     b.multi_day_sealed_version IS DISTINCT FROM (x->>'bagVersion')::integer OR
     b.total_value IS DISTINCT FROM (x->>'stack')::bigint OR
     b.tournament_id IS DISTINCT FROM (x->>'flightId')::uuid OR
     r.entry_id IS DISTINCT FROM (x->>'sourceEntryId')::uuid;
 IF v_invalid>0 OR pg_catalog.jsonb_array_length(v_part.source_bags)=0 THEN
   RAISE EXCEPTION 'multi_day_final_source_bag_stale' USING ERRCODE='40001';
 END IF;
 SELECT * INTO v_table FROM public.tournament_tables WHERE id=p_tournament_table_id
   AND tournament_id=v_final.id FOR UPDATE;
 IF NOT FOUND OR v_table.status<>'active' OR v_table.table_id IS NULL OR
    v_table.table_session_id IS NULL OR p_seat_number>v_table.max_seats THEN
   RAISE EXCEPTION 'multi_day_final_table_unavailable' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_session FROM public.table_sessions WHERE id=v_table.table_session_id;
 IF NOT FOUND OR v_session.tournament_id IS DISTINCT FROM v_final.id OR
    v_session.game_table_id IS DISTINCT FROM v_table.table_id THEN
   RAISE EXCEPTION 'multi_day_final_session_mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_seats s
     WHERE s.tournament_table_id=v_table.id AND s.seat_number=p_seat_number AND s.is_active) THEN
   RAISE EXCEPTION 'multi_day_final_seat_occupied' USING ERRCODE='23505';
 END IF;
 SELECT b.player_name INTO v_name FROM pg_catalog.jsonb_array_elements(v_part.source_bags) x
   JOIN public.chip_bag b ON b.id=(x->>'bagId')::uuid LIMIT 1;
 INSERT INTO private.multi_day_final_write_intents_v1
   (transaction_id,backend_pid,kind,row_id,participation_id,row_hash)
 VALUES
   (pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),'entry',v_entry,v_part.id,
    private.multi_day_final_row_hash_v1('entry',v_entry,v_final.id,p_player_id,
      v_entry,v_seat,v_table.table_id,NULL,p_seat_number,v_stack)),
   (pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),'seat',v_seat,v_part.id,
    private.multi_day_final_row_hash_v1('seat',v_seat,v_final.id,p_player_id,
      v_entry,v_seat,v_table.id,v_session.id,p_seat_number,v_stack));
 INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,source,
    status,current_stack,table_id,seat_id,seat_number,seated_at)
 VALUES(v_entry,v_final.id,p_player_id,1,'staff','seated',v_stack::integer,
    v_table.table_id,v_seat,p_seat_number,now());
 INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_id,entry_number,
    table_id,tournament_table_id,table_session_id,seat_number,chip_count,is_active,
    status,player_name,assigned_by,assigned_at)
 VALUES(v_seat,v_final.id,p_player_id,v_entry,1,v_table.id,v_table.id,v_session.id,
    p_seat_number,v_stack::integer,true,'active',v_name,v_actor,now());
 DELETE FROM private.multi_day_final_write_intents_v1 WHERE
   transaction_id=pg_catalog.txid_current() AND backend_pid=pg_catalog.pg_backend_pid()
   AND row_id IN(v_entry,v_seat) AND consumed;
 GET DIAGNOSTICS v_consumed=ROW_COUNT;
 IF v_consumed<>2 THEN
   RAISE EXCEPTION 'multi_day_final_intent_not_consumed' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.seat_draw_receipts(id,tournament_id,entry_id,player_id,display_name,
    table_id,table_number,seat_id,seat_number,receipt_code,qr_payload,draw_type,status,issued_by)
 VALUES(v_receipt_id,v_final.id,v_entry,p_player_id,coalesce(v_name,'Final Day player'),
    v_table.table_id,v_table.table_number,v_seat,p_seat_number,
    'FD-'||pg_catalog.replace(v_receipt_id::text,'-',''),
    pg_catalog.jsonb_build_object('v',1,'receipt_id',v_receipt_id,'entry_id',v_entry),
    'initial','issued',v_actor);
 INSERT INTO public.seat_assignment_history(tournament_id,entry_id,player_id,to_table_id,
    to_table_number,to_seat_number,reason,draw_type,actor_user_id,metadata)
 VALUES(v_final.id,v_entry,p_player_id,v_table.table_id,v_table.table_number,
    p_seat_number,'day2_seat','initial',v_actor,
    pg_catalog.jsonb_build_object('eventId',p_event_id,'sourceBags',v_part.source_bags,
      'seedRevision',v_revision));
 INSERT INTO public.multi_day_final_seatings_v1(participation_id,final_tournament_id,
    player_id,entry_id,seat_id,receipt_id,seed_stack,seed_revision,source_hash,
    source_bags,seated_by)
 SELECT v_part.id,v_final.id,p_player_id,v_entry,v_seat,v_receipt_id,v_stack,v_revision,
    l.source_hash,v_part.source_bags,v_actor
 FROM public.multi_day_qualification_locks_v1 l WHERE l.event_id=p_event_id;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'state','SEATED','eventId',p_event_id,
   'finalTournamentId',v_final.id,'playerId',p_player_id,'participationId',v_part.id,
   'entryId',v_entry,'seatId',v_seat,'receiptId',v_receipt_id,'seedStack',v_stack,
   'seedRevision',v_revision,'sourceBags',v_part.source_bags,'newBuyInVnd',0,
   'denominationIssuance','NONE','payoutFinalization','HELD','idempotent',false);
 INSERT INTO public.multi_day_final_requests_v1(request_id,participation_id,actor_id,
   kind,payload_hash,receipt)
 VALUES(p_request_id,v_part.id,v_actor,'seat',v_hash,v_receipt);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_seat_final_v1(uuid,uuid,uuid,integer,integer,uuid)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_seat_final_v1(uuid,uuid,uuid,integer,integer,uuid)
 TO authenticated,service_role;

-- Before seating, an owner can record a new seed revision with evidence. Once
-- seated, this only records an approved-but-HELD adjustment: gameplay/chip
-- movements and physical denomination reconciliation need their own writer.
CREATE FUNCTION public.multi_day_correct_final_seed_v1(
 p_event_id uuid,p_player_id uuid,p_corrected_stack bigint,
 p_expected_revision integer,p_reason text,p_evidence_ref text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_final public.tournaments%ROWTYPE; v_part public.multi_day_final_participations_v1%ROWTYPE;
 v_prior public.multi_day_final_requests_v1%ROWTYPE;
 v_seating public.multi_day_final_seatings_v1%ROWTYPE;
 v_revision integer; v_stack bigint; v_hash text; v_receipt jsonb;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_player_id IS NULL OR
    p_corrected_stack IS NULL OR p_corrected_stack<1 OR p_corrected_stack>2147483647 OR
    p_expected_revision IS NULL OR p_expected_revision<0 OR p_request_id IS NULL OR
    length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 500 OR
    length(btrim(coalesce(p_evidence_ref,''))) NOT BETWEEN 3 AND 200 THEN
   RAISE EXCEPTION 'multi_day_final_correction_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_rules_missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_final FROM public.tournaments WHERE id=v_rules.final_tournament_id FOR UPDATE;
 IF NOT FOUND OR v_final.event_id IS DISTINCT FROM p_event_id OR
    v_final.club_id IS DISTINCT FROM v_rules.club_id OR v_final.phase<>'final' THEN
   RAISE EXCEPTION 'multi_day_final_tournament_mismatch' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_rules.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_final_correction_owner_required' USING ERRCODE='42501';
 END IF;
 PERFORM private.multi_day_final_lock_player_v1(v_final.id,p_player_id);
 SELECT * INTO v_part FROM public.multi_day_final_participations_v1
   WHERE event_id=p_event_id AND final_tournament_id=v_final.id AND player_id=p_player_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_final_not_qualified' USING ERRCODE='23514'; END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('kind','correct','event',p_event_id,
   'player',p_player_id,'stack',p_corrected_stack,'revision',p_expected_revision,
   'reason',btrim(p_reason),'evidence',btrim(p_evidence_ref))::text);
 SELECT * INTO v_prior FROM public.multi_day_final_requests_v1 WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.actor_id IS DISTINCT FROM v_actor OR v_prior.kind<>'correct' OR
      v_prior.participation_id IS DISTINCT FROM v_part.id OR v_prior.payload_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_final_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt || pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id AND
     g.enabled AND v_rules.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 SELECT r.revision,r.revised_stack INTO v_revision,v_stack
 FROM public.multi_day_final_stack_revisions_v1 r WHERE r.participation_id=v_part.id
 ORDER BY r.revision DESC LIMIT 1;
 IF NOT FOUND THEN v_revision:=0; v_stack:=v_part.carried_stack; END IF;
 IF v_revision<>p_expected_revision THEN
   RAISE EXCEPTION 'multi_day_final_seed_stale' USING ERRCODE='40001';
 END IF;
 IF v_stack=p_corrected_stack THEN
   RAISE EXCEPTION 'multi_day_final_correction_no_change' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_seating FROM public.multi_day_final_seatings_v1
   WHERE participation_id=v_part.id;
 IF FOUND OR EXISTS(SELECT 1 FROM public.tournament_entries e
    WHERE e.tournament_id=v_final.id AND e.player_id=p_player_id) OR
    EXISTS(SELECT 1 FROM public.tournament_seats s
    WHERE s.tournament_id=v_final.id AND s.player_id=p_player_id) THEN
   IF NOT FOUND THEN
     RAISE EXCEPTION 'multi_day_final_legacy_usage_correction_held' USING ERRCODE='23514';
   END IF;
   INSERT INTO public.multi_day_final_adjustments_v1(request_id,participation_id,
     seating_participation_id,prior_seed_stack,proposed_seed_stack,delta_chips,
     seed_revision,actor_id,payload_hash,reason,evidence_ref,source_bags)
   VALUES(p_request_id,v_part.id,v_seating.participation_id,v_seating.seed_stack,
     p_corrected_stack,p_corrected_stack-v_seating.seed_stack,v_seating.seed_revision,
     v_actor,v_hash,btrim(p_reason),btrim(p_evidence_ref),v_part.source_bags);
   v_receipt:=pg_catalog.jsonb_build_object('ok',true,'state','OWNER_APPROVED_HELD',
     'participationId',v_part.id,'entryId',v_seating.entry_id,'seatId',v_seating.seat_id,
     'priorSeedStack',v_seating.seed_stack,'proposedSeedStack',p_corrected_stack,
     'deltaChips',p_corrected_stack-v_seating.seed_stack,'liveStackChanged',false,
     'payoutFinalization','HELD','idempotent',false);
 ELSE
   INSERT INTO public.multi_day_final_stack_revisions_v1(participation_id,revision,
     prior_stack,revised_stack,request_id,actor_id,payload_hash,reason,evidence_ref,source_bags)
   VALUES(v_part.id,v_revision+1,v_stack,p_corrected_stack,p_request_id,v_actor,
     v_hash,btrim(p_reason),btrim(p_evidence_ref),v_part.source_bags);
   v_receipt:=pg_catalog.jsonb_build_object('ok',true,'state','REVISED_PRE_SEAT',
     'participationId',v_part.id,'priorStack',v_stack,'seedStack',p_corrected_stack,
     'seedRevision',v_revision+1,'payoutFinalization','HELD','idempotent',false);
 END IF;
 INSERT INTO public.multi_day_final_requests_v1(request_id,participation_id,actor_id,
   kind,payload_hash,receipt)
 VALUES(p_request_id,v_part.id,v_actor,'correct',v_hash,v_receipt);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_correct_final_seed_v1(
 uuid,uuid,bigint,integer,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.multi_day_correct_final_seed_v1(
 uuid,uuid,bigint,integer,text,text,uuid) TO authenticated,service_role;
