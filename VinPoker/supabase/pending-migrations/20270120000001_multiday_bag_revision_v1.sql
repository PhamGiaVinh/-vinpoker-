-- SOURCE ONLY. Forward-only flight bag write fence over the live chip_bag.
-- Existing non-flight Chip Ops RPCs remain unchanged. The historical bag RPC
-- cannot write a flight bag: it has no one-use private intent or revision.
-- ROLLBACK: keep bag records, disable new RPC grants in a forward migration.
ALTER TABLE public.chip_bag
  ADD COLUMN IF NOT EXISTS multi_day_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multi_day_sealed_version integer,
  ADD COLUMN IF NOT EXISTS multi_day_roster_hash text;
ALTER TABLE public.chip_bag ADD CONSTRAINT chip_bag_multi_day_revision_shape_v1
  CHECK(multi_day_revision >= 0 AND
    (multi_day_sealed_version IS NULL OR multi_day_sealed_version=multi_day_revision));

CREATE TABLE IF NOT EXISTS public.multi_day_bag_requests_v1 (
  request_id uuid PRIMARY KEY,
  flight_tournament_id uuid NOT NULL REFERENCES public.multi_day_flight_ends_v1(flight_tournament_id),
  player_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL CHECK(action IN('edit','seal')),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{32}$'),
  bag_id uuid NOT NULL REFERENCES public.chip_bag(id) ON DELETE RESTRICT,
  result_revision integer NOT NULL CHECK(result_revision > 0),
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.multi_day_bag_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_bag_requests_v1
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS private.multi_day_bag_write_intents_v1 (
  transaction_id bigint NOT NULL,
  backend_pid integer NOT NULL,
  bag_id uuid NOT NULL,
  row_hash text NOT NULL,
  PRIMARY KEY(transaction_id,backend_pid,bag_id)
);
REVOKE ALL ON private.multi_day_bag_write_intents_v1
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.multi_day_bag_write_hash_v1(p_bag public.chip_bag)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT pg_catalog.md5(pg_catalog.jsonb_build_object(
   'id',p_bag.id,'flight',p_bag.tournament_id,'club',p_bag.club_id,
   'day',p_bag.day_number,'player',p_bag.player_id,'code',p_bag.bag_code,
   'stack',p_bag.stack_value,'total',p_bag.total_value,
   'revision',p_bag.multi_day_revision,'sealed',p_bag.sealed,
   'sealedVersion',p_bag.multi_day_sealed_version,
   'rosterHash',p_bag.multi_day_roster_hash)::text)
$$;
REVOKE ALL ON FUNCTION private.multi_day_bag_write_hash_v1(public.chip_bag)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.multi_day_bag_write_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_flight public.multi_day_flight_ends_v1%ROWTYPE; v_expected text;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
        WHERE f.flight_tournament_id=OLD.tournament_id) THEN
      RAISE EXCEPTION 'multi_day_bag_delete_forbidden' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO v_flight FROM public.multi_day_flight_ends_v1 f
    WHERE f.flight_tournament_id=NEW.tournament_id;
  IF NOT FOUND AND TG_OP='UPDATE' THEN
    SELECT * INTO v_flight FROM public.multi_day_flight_ends_v1 f
      WHERE f.flight_tournament_id=OLD.tournament_id;
  END IF;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (OLD.id,OLD.tournament_id,OLD.player_id,OLD.day_number,
      OLD.club_id,OLD.stack_value,OLD.multi_day_roster_hash)
      IS DISTINCT FROM
      (NEW.id,NEW.tournament_id,NEW.player_id,NEW.day_number,
      NEW.club_id,NEW.stack_value,NEW.multi_day_roster_hash) THEN
    RAISE EXCEPTION 'multi_day_bag_identity_immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.tournament_id IS DISTINCT FROM v_flight.flight_tournament_id
     OR NEW.club_id IS DISTINCT FROM v_flight.club_id
     OR NEW.day_number IS DISTINCT FROM v_flight.day_number
     OR NEW.multi_day_roster_hash IS DISTINCT FROM v_flight.roster_hash
     OR NOT EXISTS(SELECT 1 FROM public.multi_day_flight_roster_v1 r
          WHERE r.flight_tournament_id=NEW.tournament_id
            AND r.player_id=NEW.player_id AND r.tracked_stack=NEW.stack_value)
     OR NEW.total_value<0 OR NEW.bag_code IS NULL
     OR pg_catalog.btrim(NEW.bag_code)='' THEN
    RAISE EXCEPTION 'multi_day_bag_source_mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND (NEW.multi_day_revision<>1 OR NEW.sealed
      OR NEW.multi_day_sealed_version IS NOT NULL)
     OR TG_OP='UPDATE' AND (OLD.sealed OR NEW.multi_day_revision<>OLD.multi_day_revision+1
      OR (NEW.sealed AND NEW.multi_day_sealed_version<>NEW.multi_day_revision)
      OR (NOT NEW.sealed AND NEW.multi_day_sealed_version IS NOT NULL)) THEN
    RAISE EXCEPTION 'multi_day_bag_revision_or_seal_invalid' USING ERRCODE='23514';
  END IF;
  v_expected:=private.multi_day_bag_write_hash_v1(NEW);
  DELETE FROM private.multi_day_bag_write_intents_v1 i
    WHERE i.transaction_id=pg_catalog.txid_current()
      AND i.backend_pid=pg_catalog.pg_backend_pid()
      AND i.bag_id=NEW.id AND i.row_hash=v_expected;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'multi_day_bag_write_not_authorized' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_bag_write_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_bag_write_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.chip_bag FOR EACH ROW EXECUTE FUNCTION private.multi_day_bag_write_guard_v1();

CREATE OR REPLACE FUNCTION public.multi_day_record_bag_v1(
 p_flight_tournament_id uuid,p_player_id uuid,p_bag_code text,
 p_total_value bigint,p_expected_revision integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_flight public.multi_day_flight_ends_v1%ROWTYPE;
        v_roster public.multi_day_flight_roster_v1%ROWTYPE;
        v_day public.day_close%ROWTYPE; v_bag public.chip_bag%ROWTYPE;
        v_prior public.multi_day_bag_requests_v1%ROWTYPE;
        v_hash text; v_receipt jsonb;
BEGIN
 IF v_actor IS NULL OR p_flight_tournament_id IS NULL OR p_player_id IS NULL
   OR p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<0
   OR p_total_value IS NULL OR p_total_value<0 OR p_bag_code IS NULL
   OR pg_catalog.btrim(p_bag_code)='' THEN
   RAISE EXCEPTION 'multi_day_bag_request_invalid' USING ERRCODE='22023';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('flight',p_flight_tournament_id,
   'player',p_player_id,'code',p_bag_code,'total',p_total_value,
   'expectedRevision',p_expected_revision)::text);
 SELECT * INTO v_flight FROM public.multi_day_flight_ends_v1
   WHERE flight_tournament_id=p_flight_tournament_id;
 IF NOT FOUND OR v_flight.status<>'bagging' THEN
   RAISE EXCEPTION 'multi_day_bagging_not_open' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_roster FROM public.multi_day_flight_roster_v1
   WHERE flight_tournament_id=p_flight_tournament_id AND player_id=p_player_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_bag_player_not_in_roster' USING ERRCODE='23514'; END IF;
 IF v_actor IS DISTINCT FROM v_roster.dealer_user_id
    AND NOT EXISTS(SELECT 1 FROM public.clubs c
      WHERE c.id=v_flight.club_id AND c.owner_id=v_actor)
    AND NOT public.is_club_chip_master(v_actor,v_flight.club_id) THEN
   RAISE EXCEPTION 'multi_day_bag_actor_not_allowed' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_day FROM public.day_close
   WHERE tournament_id=p_flight_tournament_id AND day_number=v_flight.day_number
   FOR UPDATE;
 IF NOT FOUND OR v_day.status<>'open' THEN
   RAISE EXCEPTION 'multi_day_bagging_day_closed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_prior FROM public.multi_day_bag_requests_v1 WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.actor_id IS DISTINCT FROM v_actor OR v_prior.action<>'edit'
      OR v_prior.payload_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_bag_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt || pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
      WHERE g.id AND g.enabled AND v_flight.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_bag FROM public.chip_bag b
   WHERE b.tournament_id=p_flight_tournament_id AND b.day_number=v_flight.day_number
     AND b.player_id=p_player_id FOR UPDATE;
 IF FOUND THEN
   IF v_bag.sealed OR v_bag.multi_day_revision<>p_expected_revision THEN
     RAISE EXCEPTION 'multi_day_bag_stale_or_sealed' USING ERRCODE='40001';
   END IF;
   v_bag.bag_code:=pg_catalog.btrim(p_bag_code);
   v_bag.total_value:=p_total_value;
   v_bag.multi_day_revision:=v_bag.multi_day_revision+1;
   v_bag.updated_at:=now();
 ELSE
   IF p_expected_revision<>0 THEN
     RAISE EXCEPTION 'multi_day_bag_stale_or_sealed' USING ERRCODE='40001';
   END IF;
   v_bag.id:=gen_random_uuid();
   v_bag.tournament_id:=p_flight_tournament_id;
   v_bag.club_id:=v_flight.club_id;
   v_bag.day_number:=v_flight.day_number;
   v_bag.player_id:=p_player_id;
   v_bag.table_id:=NULL;
   v_bag.seat_number:=v_roster.seat_number;
   v_bag.bag_code:=pg_catalog.btrim(p_bag_code);
   v_bag.stack_value:=v_roster.tracked_stack;
   v_bag.total_value:=p_total_value;
   v_bag.sealed:=false;
   v_bag.created_by:=v_actor;
   v_bag.multi_day_revision:=1;
   v_bag.multi_day_sealed_version:=NULL;
   v_bag.multi_day_roster_hash:=v_flight.roster_hash;
 END IF;
 INSERT INTO private.multi_day_bag_write_intents_v1
   VALUES(pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),v_bag.id,
      private.multi_day_bag_write_hash_v1(v_bag));
 IF p_expected_revision=0 THEN
   INSERT INTO public.chip_bag(id,tournament_id,club_id,day_number,player_id,
     table_id,seat_number,bag_code,stack_value,total_value,sealed,created_by,
     multi_day_revision,multi_day_sealed_version,multi_day_roster_hash)
   VALUES(v_bag.id,v_bag.tournament_id,v_bag.club_id,v_bag.day_number,v_bag.player_id,
     v_bag.table_id,v_bag.seat_number,v_bag.bag_code,v_bag.stack_value,
     v_bag.total_value,false,v_actor,v_bag.multi_day_revision,NULL,
     v_bag.multi_day_roster_hash);
 ELSE
   UPDATE public.chip_bag SET bag_code=v_bag.bag_code,total_value=v_bag.total_value,
     multi_day_revision=v_bag.multi_day_revision,updated_at=v_bag.updated_at
   WHERE id=v_bag.id;
 END IF;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'bagId',v_bag.id,
   'revision',v_bag.multi_day_revision,'trackedStack',v_bag.stack_value,
   'bagTotal',v_bag.total_value,'variance',v_bag.total_value-v_bag.stack_value,
   'sealed',false,'idempotent',false);
 INSERT INTO public.multi_day_bag_requests_v1(request_id,flight_tournament_id,
   player_id,actor_id,action,payload_hash,bag_id,result_revision,receipt)
 VALUES(p_request_id,p_flight_tournament_id,p_player_id,v_actor,'edit',v_hash,
   v_bag.id,v_bag.multi_day_revision,v_receipt);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_record_bag_v1(uuid,uuid,text,bigint,integer,uuid)
 TO authenticated;

CREATE OR REPLACE FUNCTION public.multi_day_seal_bag_v1(
 p_flight_tournament_id uuid,p_player_id uuid,
 p_expected_revision integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_flight public.multi_day_flight_ends_v1%ROWTYPE;
        v_day public.day_close%ROWTYPE; v_bag public.chip_bag%ROWTYPE;
        v_prior public.multi_day_bag_requests_v1%ROWTYPE;
        v_hash text; v_receipt jsonb;
BEGIN
 IF v_actor IS NULL OR p_flight_tournament_id IS NULL OR p_player_id IS NULL
    OR p_request_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1 THEN
   RAISE EXCEPTION 'multi_day_bag_request_invalid' USING ERRCODE='22023';
 END IF;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('flight',p_flight_tournament_id,
   'player',p_player_id,'expectedRevision',p_expected_revision,'action','seal')::text);
 SELECT * INTO v_flight FROM public.multi_day_flight_ends_v1
   WHERE flight_tournament_id=p_flight_tournament_id;
 IF NOT FOUND OR v_flight.status<>'bagging' THEN
   RAISE EXCEPTION 'multi_day_bagging_not_open' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c
      WHERE c.id=v_flight.club_id AND c.owner_id=v_actor)
    AND NOT public.is_club_chip_master(v_actor,v_flight.club_id) THEN
   RAISE EXCEPTION 'multi_day_bag_seal_actor_not_allowed' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_day FROM public.day_close
   WHERE tournament_id=p_flight_tournament_id AND day_number=v_flight.day_number
   FOR UPDATE;
 IF NOT FOUND OR v_day.status<>'open' THEN
   RAISE EXCEPTION 'multi_day_bagging_day_closed' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v_prior FROM public.multi_day_bag_requests_v1 WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.actor_id IS DISTINCT FROM v_actor OR v_prior.action<>'seal'
      OR v_prior.payload_hash<>v_hash THEN
     RAISE EXCEPTION 'multi_day_bag_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt || pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
      WHERE g.id AND g.enabled AND v_flight.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_bag FROM public.chip_bag b
   WHERE b.tournament_id=p_flight_tournament_id AND b.day_number=v_flight.day_number
     AND b.player_id=p_player_id FOR UPDATE;
 IF NOT FOUND OR v_bag.sealed OR v_bag.multi_day_revision<>p_expected_revision THEN
   RAISE EXCEPTION 'multi_day_bag_stale_or_sealed' USING ERRCODE='40001';
 END IF;
 IF v_bag.total_value IS DISTINCT FROM v_bag.stack_value OR v_bag.total_value<=0 THEN
   RAISE EXCEPTION 'multi_day_bag_variance_unresolved' USING ERRCODE='23514';
 END IF;
 v_bag.sealed:=true;
 v_bag.multi_day_revision:=v_bag.multi_day_revision+1;
 v_bag.multi_day_sealed_version:=v_bag.multi_day_revision;
 INSERT INTO private.multi_day_bag_write_intents_v1
   VALUES(pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),v_bag.id,
      private.multi_day_bag_write_hash_v1(v_bag));
 UPDATE public.chip_bag SET sealed=true,
   multi_day_revision=v_bag.multi_day_revision,
   multi_day_sealed_version=v_bag.multi_day_sealed_version,
   updated_at=now() WHERE id=v_bag.id;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'bagId',v_bag.id,
   'revision',v_bag.multi_day_revision,'sealedVersion',v_bag.multi_day_sealed_version,
   'bagCode',v_bag.bag_code,'trackedStack',v_bag.stack_value,
   'bagTotal',v_bag.total_value,'sealed',true,'idempotent',false);
 INSERT INTO public.multi_day_bag_requests_v1(request_id,flight_tournament_id,
   player_id,actor_id,action,payload_hash,bag_id,result_revision,receipt)
 VALUES(p_request_id,p_flight_tournament_id,p_player_id,v_actor,'seal',v_hash,
   v_bag.id,v_bag.multi_day_revision,v_receipt);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_seal_bag_v1(uuid,uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_seal_bag_v1(uuid,uuid,integer,uuid)
 TO authenticated;

-- Legacy chip_ops_close_day and direct day_close updates must not lock a
-- flight with missing/unsealed bags or with seat-derived totals.
CREATE OR REPLACE FUNCTION private.multi_day_day_close_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_flight public.multi_day_flight_ends_v1%ROWTYPE;
        v_count integer; v_expected bigint; v_counted bigint;
BEGIN
 IF TG_OP='DELETE' THEN
   IF EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
       WHERE f.flight_tournament_id=OLD.tournament_id) THEN
     RAISE EXCEPTION 'multi_day_day_close_delete_forbidden' USING ERRCODE='23514';
   END IF;
   RETURN OLD;
 END IF;
 SELECT * INTO v_flight FROM public.multi_day_flight_ends_v1 f
   WHERE f.flight_tournament_id=NEW.tournament_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.status='locked' THEN
   RAISE EXCEPTION 'multi_day_day_close_locked_immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.club_id IS DISTINCT FROM v_flight.club_id
    OR NEW.day_number IS DISTINCT FROM v_flight.day_number THEN
   RAISE EXCEPTION 'multi_day_day_close_identity_mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.status='locked' THEN
   IF v_flight.status<>'bagging' OR NOT EXISTS(
      SELECT 1 FROM public.multi_day_package_release_v1 g
      WHERE g.id AND g.enabled AND v_flight.club_id=ANY(g.allowed_club_ids))
      OR auth.uid() IS NULL OR
      (NOT EXISTS(SELECT 1 FROM public.clubs c
         WHERE c.id=v_flight.club_id AND c.owner_id=auth.uid())
       AND NOT public.is_club_chip_master(auth.uid(),v_flight.club_id)) THEN
     RAISE EXCEPTION 'multi_day_day_close_actor_or_gate_denied' USING ERRCODE='42501';
   END IF;
   SELECT count(*),sum(r.tracked_stack),sum(b.total_value)
   INTO v_count,v_expected,v_counted
   FROM public.multi_day_flight_roster_v1 r
   JOIN public.chip_bag b ON b.tournament_id=r.flight_tournament_id
     AND b.player_id=r.player_id AND b.day_number=v_flight.day_number
     AND b.sealed AND b.multi_day_sealed_version=b.multi_day_revision
     AND b.multi_day_roster_hash=v_flight.roster_hash
   WHERE r.flight_tournament_id=v_flight.flight_tournament_id;
   IF v_count<>v_flight.roster_count OR v_expected IS DISTINCT FROM v_counted
      OR NEW.expected_total_value IS DISTINCT FROM v_expected
      OR NEW.counted_total_value IS DISTINCT FROM v_counted
      OR NEW.all_zero IS DISTINCT FROM true THEN
     RAISE EXCEPTION 'multi_day_day_close_bags_unreconciled' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_day_close_guard_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_day_close_guard_v1 BEFORE UPDATE OR DELETE
 ON public.day_close FOR EACH ROW EXECUTE FUNCTION private.multi_day_day_close_guard_v1();

CREATE OR REPLACE FUNCTION private.multi_day_day_close_mark_locked_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status='open' AND NEW.status='locked' THEN
   UPDATE public.multi_day_flight_ends_v1 SET status='locked',locked_at=NEW.locked_at
   WHERE flight_tournament_id=NEW.tournament_id AND day_number=NEW.day_number;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_day_close_mark_locked_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_day_close_mark_locked_v1 AFTER UPDATE OF status
 ON public.day_close FOR EACH ROW EXECUTE FUNCTION private.multi_day_day_close_mark_locked_v1();

CREATE TABLE IF NOT EXISTS public.multi_day_close_requests_v1 (
 request_id uuid PRIMARY KEY,
 flight_tournament_id uuid NOT NULL REFERENCES public.multi_day_flight_ends_v1(flight_tournament_id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 expected_day_version integer NOT NULL,
 receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.multi_day_close_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_close_requests_v1
 FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.multi_day_close_bagging_v1(
 p_flight_tournament_id uuid,p_expected_day_version integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_flight public.multi_day_flight_ends_v1%ROWTYPE;
        v_day public.day_close%ROWTYPE; v_count integer;
        v_expected bigint; v_counted bigint; v_receipt jsonb;
        v_prior public.multi_day_close_requests_v1%ROWTYPE;
BEGIN
 IF v_actor IS NULL OR p_flight_tournament_id IS NULL OR p_request_id IS NULL
    OR p_expected_day_version IS NULL OR p_expected_day_version<0 THEN
   RAISE EXCEPTION 'multi_day_close_request_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_flight FROM public.multi_day_flight_ends_v1
   WHERE flight_tournament_id=p_flight_tournament_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_flight_not_found' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c
      WHERE c.id=v_flight.club_id AND c.owner_id=v_actor)
    AND NOT public.is_club_chip_master(v_actor,v_flight.club_id) THEN
   RAISE EXCEPTION 'multi_day_close_actor_not_allowed' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_day FROM public.day_close
   WHERE tournament_id=p_flight_tournament_id AND day_number=v_flight.day_number
   FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_bagging_day_missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_prior FROM public.multi_day_close_requests_v1
   WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.flight_tournament_id IS DISTINCT FROM p_flight_tournament_id
      OR v_prior.actor_id IS DISTINCT FROM v_actor
      OR v_prior.expected_day_version IS DISTINCT FROM p_expected_day_version THEN
     RAISE EXCEPTION 'multi_day_close_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt || pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF v_day.status='locked' THEN
   RAISE EXCEPTION 'multi_day_close_already_locked' USING ERRCODE='23514';
 END IF;
 IF v_day.version<>p_expected_day_version THEN
   RAISE EXCEPTION 'multi_day_close_stale_day' USING ERRCODE='40001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
      WHERE g.id AND g.enabled AND v_flight.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 SELECT count(*),sum(r.tracked_stack),sum(b.total_value)
 INTO v_count,v_expected,v_counted
 FROM public.multi_day_flight_roster_v1 r
 JOIN public.chip_bag b ON b.tournament_id=r.flight_tournament_id
   AND b.player_id=r.player_id AND b.day_number=v_flight.day_number
   AND b.sealed AND b.multi_day_sealed_version=b.multi_day_revision
   AND b.multi_day_roster_hash=v_flight.roster_hash
 WHERE r.flight_tournament_id=v_flight.flight_tournament_id;
 IF v_count<>v_flight.roster_count OR v_expected IS DISTINCT FROM v_counted THEN
   RAISE EXCEPTION 'multi_day_day_close_bags_unreconciled' USING ERRCODE='23514';
 END IF;
 UPDATE public.day_close SET expected_total_value=v_expected,
   counted_total_value=v_counted,variance_by_player='[]'::jsonb,
   all_zero=true,status='locked',locked_by=v_actor,locked_at=now(),
   signed_off=false,version=v_day.version+1
 WHERE id=v_day.id;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'status','locked',
   'rosterHash',v_flight.roster_hash,'bagCount',v_count,
   'expectedTotal',v_expected,'countedTotal',v_counted,'dayVersion',v_day.version+1,
   'idempotent',false);
 INSERT INTO public.multi_day_close_requests_v1(request_id,flight_tournament_id,
   actor_id,expected_day_version,receipt)
 VALUES(p_request_id,p_flight_tournament_id,v_actor,p_expected_day_version,v_receipt);
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_close_bagging_v1(uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_close_bagging_v1(uuid,integer,uuid)
 TO authenticated;
