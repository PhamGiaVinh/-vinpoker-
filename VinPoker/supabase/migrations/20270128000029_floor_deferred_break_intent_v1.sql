-- P1 F03/F04. Forward-only; legacy moves never acquire break-close authority.
-- Catalog/live ledger checked: 00029 free; requires reviewed 00007/00013/00028.
-- Rollback: stop creating new breaks, resolve outstanding operations, then use
-- a reviewed forward compensation restoring the three pinned definitions.
BEGIN;
ALTER TABLE public.floor_pending_tracker_moves ADD COLUMN IF NOT EXISTS break_request_id uuid;

CREATE FUNCTION floor_private.floor_move_has_break_intent_v1(q public.floor_pending_tracker_moves)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT q.break_request_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.table_operation_receipts r
  WHERE r.actor_id=q.requested_by AND r.operation_type='floor_break_table_v5'
    AND r.request_id=q.break_request_id AND r.result->>'ok'='true'
    AND r.result->>'break_pending'='true'
    AND r.result->>'tournament_table_id'=q.source_tournament_table_id::text
    AND r.result->>'table_session_id'=q.source_table_session_id::text
 );
$$;
REVOKE ALL ON FUNCTION floor_private.floor_move_has_break_intent_v1(public.floor_pending_tracker_moves) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE d text; patched text;
BEGIN
 d:=pg_get_functiondef('public.floor_break_table_v5(uuid,bigint,uuid,text,text)'::regprocedure);
 IF md5(d)<>'9d5e0985af2e9bc3a298436c9df10cd3' THEN RAISE EXCEPTION 'break_producer_definition_drift'; END IF;
 patched:=replace(d,'source_control_epoch, destination_control_epoch, requested_by, request_id',
   'source_control_epoch, destination_control_epoch, requested_by, request_id, break_request_id');
 patched:=replace(patched,'v_session.control_epoch, dst.control_epoch, v_actor, gen_random_uuid()',
   'v_session.control_epoch, dst.control_epoch, v_actor, gen_random_uuid(), p_request_id');
 IF patched=d OR position('gen_random_uuid(), p_request_id' in patched)=0 THEN RAISE EXCEPTION 'break_producer_patch_missing'; END IF;
 EXECUTE patched;

 d:=pg_get_functiondef('floor_private.floor_apply_tracker_moves_after_hand_v1()'::regprocedure);
 IF md5(d)<>'ed7983412e3eca2d7a0554441be78cb2' THEN RAISE EXCEPTION 'move_consumer_definition_drift'; END IF;
 patched:=replace(d,$old$OR v_source_session.control_mode <> 'manual'$old$,
 $new$OR (v_source_session.control_mode <> 'manual' AND NOT (
         v_source_session.control_mode = 'tracker'
         AND floor_private.floor_move_has_break_intent_v1(v_move)))$new$);
 IF patched=d THEN RAISE EXCEPTION 'move_consumer_patch_missing'; END IF;
 EXECUTE patched;

 d:=pg_get_functiondef('floor_private.floor_close_completed_break_source_v1()'::regprocedure);
 IF md5(d)<>'01b16b4b7cb184a9a99f1a34355892a0' THEN RAISE EXCEPTION 'break_close_definition_drift'; END IF;
 patched:=replace(d,$old$IF OLD.status <> 'pending' OR NEW.status NOT IN ('applied', 'stale', 'cancelled') THEN$old$,
 $new$IF OLD.status <> 'pending' OR NEW.status <> 'applied'
     OR NOT floor_private.floor_move_has_break_intent_v1(NEW)
     OR EXISTS (SELECT 1 FROM public.floor_pending_tracker_moves q
       WHERE q.source_table_session_id=NEW.source_table_session_id
         AND q.break_request_id=NEW.break_request_id AND q.status<>'applied')
     OR EXISTS (SELECT 1 FROM public.table_sessions ts
       WHERE ts.id=NEW.source_table_session_id AND ts.control_epoch<>NEW.source_control_epoch)
     OR floor_private.floor_table_v3_has_active_hand(
       NEW.tournament_id,NEW.source_tournament_table_id,NEW.source_table_session_id) THEN$new$);
 IF patched=d THEN RAISE EXCEPTION 'break_close_patch_missing'; END IF;
 EXECUTE patched;
END;
$patch$;

-- Serialize with the producer's tournament lock; direct and legacy hand
-- writers cannot start a new source hand while a break is reserved.
CREATE FUNCTION floor_private.floor_block_hand_during_break_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='in_progress' THEN
  PERFORM 1 FROM public.tournaments WHERE id=NEW.tournament_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.floor_pending_tracker_moves q
    WHERE q.tournament_id=NEW.tournament_id AND q.status='pending'
      AND (q.source_table_session_id=NEW.table_session_id
       OR q.source_tournament_table_id=NEW.tournament_table_id
       OR q.source_tournament_table_id=NEW.table_id)
      AND floor_private.floor_move_has_break_intent_v1(q)) THEN
   RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='source_break_pending';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.floor_block_hand_during_break_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_floor_block_hand_during_break_v1 BEFORE INSERT OR UPDATE OF status ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_block_hand_during_break_v1();
COMMIT;
