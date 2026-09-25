-- SOURCE ONLY. Forward-only Final Day qualification; no payout or seating writer.
-- Depends on 20270120000000/1 and the live event/qualifier/registration schema.
-- ROLLBACK: revoke the new RPCs in a forward migration. Preserve locked source,
-- participation and pending obligations; never delete or recalculate them.

DO $preflight$ BEGIN
 IF to_regclass('public.tournament_event_qualifiers') IS NULL
    OR to_regclass('public.tournament_registrations') IS NULL
    OR to_regclass('public.multi_day_flight_ends_v1') IS NULL THEN
   RAISE EXCEPTION 'multi_day_qualification_baseline_missing' USING ERRCODE='23514';
 END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.multi_day_qualification_rules_v1 (
 event_id uuid PRIMARY KEY REFERENCES public.tournament_events(id) ON DELETE RESTRICT,
 club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
 final_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
 policy text NOT NULL CHECK(policy IN('SELECT_LARGEST','SUM_STACKS')),
 itm_percent numeric NOT NULL CHECK(itm_percent>0 AND itm_percent<=100),
 min_cash_x numeric NOT NULL CHECK(min_cash_x>=0 AND min_cash_x<=100),
 buy_in_vnd bigint NOT NULL CHECK(buy_in_vnd>=0),
 rake_vnd bigint NOT NULL CHECK(rake_vnd>=0),
 configured_by uuid NOT NULL REFERENCES auth.users(id),
 configured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.multi_day_qualification_rules_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_qualification_rules_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.multi_day_qualification_locks_v1 (
 event_id uuid PRIMARY KEY REFERENCES public.multi_day_qualification_rules_v1(event_id) ON DELETE RESTRICT,
 request_id uuid NOT NULL UNIQUE,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{32}$'),
 selection_hash text NOT NULL CHECK(selection_hash ~ '^[0-9a-f]{32}$'),
 flight_ids uuid[] NOT NULL,
 participation_count integer NOT NULL CHECK(participation_count>0),
 locked_at timestamptz NOT NULL DEFAULT now(),
 receipt jsonb NOT NULL
);
ALTER TABLE public.multi_day_qualification_locks_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_qualification_locks_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.multi_day_final_participations_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.multi_day_qualification_locks_v1(event_id) ON DELETE RESTRICT,
 final_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
 player_id uuid NOT NULL,
 policy text NOT NULL CHECK(policy IN('SELECT_LARGEST','SUM_STACKS')),
 carried_stack bigint NOT NULL CHECK(carried_stack>0),
 participation_floor_vnd numeric NOT NULL CHECK(participation_floor_vnd>=0),
 source_bags jsonb NOT NULL CHECK(jsonb_typeof(source_bags)='array'),
 selected_bag_id uuid REFERENCES public.chip_bag(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,player_id), UNIQUE(final_tournament_id,player_id),
 CHECK((policy='SELECT_LARGEST' AND selected_bag_id IS NOT NULL)
    OR (policy='SUM_STACKS' AND selected_bag_id IS NULL))
);
ALTER TABLE public.multi_day_final_participations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_final_participations_v1 FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.multi_day_nonselected_min_cash_v1 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 participation_id uuid NOT NULL REFERENCES public.multi_day_final_participations_v1(id) ON DELETE RESTRICT,
 bag_id uuid NOT NULL REFERENCES public.chip_bag(id) ON DELETE RESTRICT,
 bag_version integer NOT NULL CHECK(bag_version>0),
 source_entry_id uuid NOT NULL REFERENCES public.tournament_entries(id) ON DELETE RESTRICT,
 amount_vnd numeric NOT NULL CHECK(amount_vnd>=0),
 status text NOT NULL DEFAULT 'PENDING_FUNDING' CHECK(status='PENDING_FUNDING'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bag_id)
);
ALTER TABLE public.multi_day_nonselected_min_cash_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_nonselected_min_cash_v1 FROM PUBLIC,anon,authenticated,service_role;

-- No UPDATE/DELETE on finalised qualification facts, even for service-role SQL.
CREATE FUNCTION private.multi_day_qualification_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'multi_day_qualification_immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION private.multi_day_qualification_immutable_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_rules_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_qualification_rules_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TRIGGER multi_day_lock_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_qualification_locks_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TRIGGER multi_day_participation_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_final_participations_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();
CREATE TRIGGER multi_day_min_cash_immutable_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_nonselected_min_cash_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_qualification_immutable_v1();

-- The existing qualifier RPC can fall back to current chips and overwrite a
-- carried stack. For a package event it and direct RLS/service inserts fail.
-- Gate OFF + no package lock leaves legacy production behaviour unchanged.
CREATE FUNCTION private.multi_day_legacy_qualifier_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid; v_club uuid; v_ref uuid; v_row public.tournament_event_qualifiers%ROWTYPE;
 v_pass integer;
BEGIN
 IF TG_OP='INSERT' THEN v_row:=NEW; ELSE v_row:=OLD; END IF;
 FOR v_pass IN 1..CASE WHEN TG_OP='UPDATE' THEN 2 ELSE 1 END LOOP
   IF v_pass=2 THEN v_row:=NEW; END IF;
   FOR v_ref IN SELECT DISTINCT x FROM pg_catalog.unnest(ARRAY[
       v_row.event_id,
       (SELECT t.event_id FROM public.tournaments t WHERE t.id=v_row.flight_tournament_id),
       (SELECT t.event_id FROM public.tournaments t WHERE t.id=v_row.final_tournament_id)]) AS x
       WHERE x IS NOT NULL ORDER BY x LOOP
     v_event:=v_ref;
     SELECT e.club_id INTO v_club FROM public.tournament_events e
       WHERE e.id=v_event FOR SHARE;
     IF EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=v_event)
        OR EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l WHERE l.event_id=v_event)
        OR EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
          JOIN public.multi_day_package_release_v1 g ON g.id AND g.enabled
           AND r.club_id=ANY(g.allowed_club_ids) WHERE r.event_id=v_event) THEN
       RAISE EXCEPTION 'multi_day_legacy_qualifier_held' USING ERRCODE='42501';
     END IF;
   END LOOP;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_legacy_qualifier_fence_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_legacy_qualifier_fence_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournament_event_qualifiers FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_legacy_qualifier_fence_v1();

-- Final entries/seats are held until a separate server-owned seating writer
-- consumes these exact participation IDs. Legacy seat_day2_qualifiers cannot
-- materialise duplicates or bypass the bag snapshot for package events.
CREATE FUNCTION private.multi_day_legacy_final_entry_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid; v_club uuid; v_old_event uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
   SELECT t.event_id INTO v_old_event FROM public.tournaments t
     WHERE t.id=OLD.tournament_id AND t.phase='final';
   IF v_old_event IS NOT NULL AND (
       EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=v_old_event)
       OR EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
         JOIN public.multi_day_package_release_v1 g ON g.id AND g.enabled
           AND r.club_id=ANY(g.allowed_club_ids) WHERE r.event_id=v_old_event)) THEN
     RAISE EXCEPTION 'multi_day_final_seating_held' USING ERRCODE='42501';
   END IF;
 END IF;
 SELECT t.event_id,t.club_id INTO v_event,v_club FROM public.tournaments t
   WHERE t.id=NEW.tournament_id AND t.phase='final';
 IF v_event IS NOT NULL AND (EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
       WHERE f.event_id=v_event)
    OR EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
       WHERE l.event_id=v_event)
    OR EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
       JOIN public.multi_day_package_release_v1 g ON g.id AND g.enabled
         AND r.club_id=ANY(g.allowed_club_ids) WHERE r.event_id=v_event)) THEN
   RAISE EXCEPTION 'multi_day_final_seating_held' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_legacy_final_entry_fence_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_final_entry_fence_v1 BEFORE INSERT OR UPDATE ON public.tournament_entries
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_legacy_final_entry_fence_v1();
CREATE TRIGGER multi_day_final_seat_fence_v1 BEFORE INSERT OR UPDATE ON public.tournament_seats
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_legacy_final_entry_fence_v1();

-- Tournament membership is stable once qualification is locked. An event-row
-- lock serialises concurrent new flights with the qualification RPC; no
-- tournament-row lock is taken by that RPC, avoiding the inverse lock order.
CREATE FUNCTION private.multi_day_flight_set_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid;
BEGIN
 FOR v_event IN SELECT DISTINCT x FROM unnest(ARRAY[
   CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.event_id END,
   CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.event_id END]) AS x
   WHERE x IS NOT NULL ORDER BY x LOOP
   IF NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r
       WHERE r.event_id=v_event)
      AND NOT EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
       WHERE l.event_id=v_event) THEN CONTINUE; END IF;
   PERFORM 1 FROM public.tournament_events e WHERE e.id=v_event FOR SHARE;
   IF EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l WHERE l.event_id=v_event)
      AND (TG_OP<>'UPDATE' OR (OLD.event_id,OLD.phase,OLD.deleted_at,OLD.club_id)
         IS DISTINCT FROM (NEW.event_id,NEW.phase,NEW.deleted_at,NEW.club_id)) THEN
      RAISE EXCEPTION 'multi_day_flight_set_locked' USING ERRCODE='23514';
   END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_flight_set_fence_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_flight_set_fence_v1 BEFORE INSERT OR UPDATE OR DELETE
 ON public.tournaments FOR EACH ROW EXECUTE FUNCTION private.multi_day_flight_set_fence_v1();

-- An already locked day/roster must not be re-labelled after qualification.
CREATE FUNCTION private.multi_day_flight_end_identity_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'multi_day_flight_end_immutable' USING ERRCODE='23514';
 END IF;
 IF (OLD.status='locked' AND NEW IS DISTINCT FROM OLD)
    OR EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
        WHERE l.event_id=OLD.event_id)
    OR NEW.status='locked' AND NOT EXISTS(SELECT 1 FROM public.day_close d
       WHERE d.tournament_id=NEW.flight_tournament_id
         AND d.day_number=NEW.day_number AND d.status='locked') THEN
   RAISE EXCEPTION 'multi_day_flight_end_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_flight_end_identity_fence_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_flight_end_identity_fence_v1 BEFORE UPDATE OR DELETE
 ON public.multi_day_flight_ends_v1 FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_flight_end_identity_fence_v1();

CREATE FUNCTION private.multi_day_event_frozen_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.multi_day_qualification_rules_v1 r WHERE r.event_id=OLD.id)
    AND (OLD.club_id,OLD.final_tournament_id,OLD.itm_percent,OLD.buy_in,OLD.rake_amount)
      IS DISTINCT FROM
        (NEW.club_id,NEW.final_tournament_id,NEW.itm_percent,NEW.buy_in,NEW.rake_amount) THEN
   RAISE EXCEPTION 'multi_day_event_rules_frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_event_frozen_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_event_frozen_v1 BEFORE UPDATE ON public.tournament_events
 FOR EACH ROW EXECUTE FUNCTION private.multi_day_event_frozen_v1();

-- A registration writer may already hold its own row/tournament. It only
-- takes the event lock in the trigger. Qualification does not row-lock those
-- sources, so this order has no cycle; rules cannot race a first attempt.
CREATE FUNCTION private.multi_day_registration_event_fence_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event uuid;
BEGIN
 SELECT t.event_id INTO v_event FROM public.tournaments t
  WHERE t.id=NEW.tournament_id AND t.phase='flight';
 IF v_event IS NOT NULL AND EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
     JOIN public.tournament_events e ON e.id=v_event AND e.club_id=ANY(g.allowed_club_ids)
     WHERE g.id AND g.enabled) THEN
   PERFORM 1 FROM public.tournament_events e WHERE e.id=v_event FOR SHARE;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_registration_event_fence_v1()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_registration_event_fence_v1 BEFORE INSERT OR UPDATE
 ON public.tournament_registrations FOR EACH ROW
 EXECUTE FUNCTION private.multi_day_registration_event_fence_v1();

CREATE FUNCTION public.multi_day_set_qualification_rules_v1(
 p_event_id uuid,p_policy text,p_min_cash_x numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_event public.tournament_events%ROWTYPE;
 v_prior public.multi_day_qualification_rules_v1%ROWTYPE;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_policy NOT IN('SELECT_LARGEST','SUM_STACKS')
    OR p_min_cash_x IS NULL OR p_min_cash_x<0 OR p_min_cash_x>100 THEN
   RAISE EXCEPTION 'multi_day_rules_invalid' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_event FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND OR v_event.final_tournament_id IS NULL OR v_event.itm_percent<=0
    OR v_event.itm_percent>100 OR v_event.buy_in IS NULL OR v_event.rake_amount IS NULL THEN
   RAISE EXCEPTION 'multi_day_event_invalid' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_event.club_id AND c.owner_id=v_actor)
    OR NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id
        AND g.enabled AND v_event.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_rules_actor_or_gate_denied' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_prior FROM public.multi_day_qualification_rules_v1 WHERE event_id=p_event_id;
 IF FOUND THEN
   IF (v_prior.policy,v_prior.min_cash_x) IS DISTINCT FROM (p_policy,p_min_cash_x) THEN
      RAISE EXCEPTION 'multi_day_rules_immutable' USING ERRCODE='23514';
   END IF;
   RETURN pg_catalog.jsonb_build_object('ok',true,'idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.tournament_entries x JOIN public.tournaments t
       ON t.id=x.tournament_id WHERE t.event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.tournament_registrations x JOIN public.tournaments t
       ON t.id=x.tournament_id WHERE t.event_id=p_event_id)
    OR EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f WHERE f.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_rules_after_source' USING ERRCODE='23514';
 END IF;
 INSERT INTO public.multi_day_qualification_rules_v1
   (event_id,club_id,final_tournament_id,policy,itm_percent,min_cash_x,
    buy_in_vnd,rake_vnd,configured_by)
 VALUES(p_event_id,v_event.club_id,v_event.final_tournament_id,p_policy,
   v_event.itm_percent,p_min_cash_x,v_event.buy_in,v_event.rake_amount,v_actor);
 RETURN pg_catalog.jsonb_build_object('ok',true,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_set_qualification_rules_v1(uuid,text,numeric)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_set_qualification_rules_v1(uuid,text,numeric)
 TO authenticated;

-- Read-only source projection. A bag is eligible only when its exact roster
-- entry, sealed version and locked day match. No live-seat/stack fallback.
CREATE FUNCTION public.multi_day_qualification_preview_v1(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_flight record; v_flights jsonb:='[]'::jsonb; v_bags jsonb;
 v_count integer:=0; v_valid integer; v_target integer; v_eligible integer;
 v_ready boolean:=true; v_hash text; v_state text;
BEGIN
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1
  WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_rules_missing' USING ERRCODE='23514'; END IF;
 IF v_actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.clubs c
     WHERE c.id=v_rules.club_id AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_preview_actor_denied' USING ERRCODE='42501';
 END IF;
 FOR v_flight IN SELECT t.id,t.club_id,f.status,f.day_number,f.roster_count,
      f.roster_hash,d.status AS day_status,d.version AS day_version
   FROM public.tournaments t
   LEFT JOIN public.multi_day_flight_ends_v1 f ON f.flight_tournament_id=t.id
   LEFT JOIN public.day_close d ON d.tournament_id=t.id AND d.day_number=f.day_number
   WHERE t.event_id=p_event_id AND t.phase='flight' AND t.deleted_at IS NULL
   ORDER BY t.id LOOP
   v_count:=v_count+1;
   SELECT count(*) INTO v_valid FROM public.tournament_entries e
     WHERE e.tournament_id=v_flight.id AND e.status<>'cancelled';
   v_target:=pg_catalog.ceil(v_valid::numeric*v_rules.itm_percent/100)::integer;
   SELECT count(*),coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('bagId',b.id,'version',b.multi_day_sealed_version,
        'entryId',r.entry_id,'playerId',r.player_id,'stack',b.total_value)
      ORDER BY b.id),'[]'::jsonb)
     INTO v_eligible,v_bags
     FROM public.multi_day_flight_roster_v1 r
     JOIN public.chip_bag b ON b.tournament_id=r.flight_tournament_id
       AND b.player_id=r.player_id AND b.day_number=v_flight.day_number
       AND b.sealed AND b.multi_day_revision=b.multi_day_sealed_version
       AND b.multi_day_roster_hash=v_flight.roster_hash
     WHERE r.flight_tournament_id=v_flight.id AND b.total_value>0;
   IF v_flight.club_id IS DISTINCT FROM v_rules.club_id
      OR v_flight.status IS DISTINCT FROM 'locked'
      OR v_flight.day_status IS DISTINCT FROM 'locked'
      OR v_flight.roster_count IS NULL OR v_eligible<>v_flight.roster_count
      OR v_target<1 OR v_target>v_eligible THEN v_ready:=false; END IF;
   v_flights:=v_flights || pg_catalog.jsonb_build_array(
     pg_catalog.jsonb_build_object('flightId',v_flight.id,
       'status',v_flight.status,'dayStatus',v_flight.day_status,
       'dayVersion',v_flight.day_version,'rosterHash',v_flight.roster_hash,
       'validEntries',v_valid,'day2Target',v_target,'eligibleBags',v_bags));
 END LOOP;
 IF v_count=0 OR EXISTS(SELECT 1 FROM public.tournament_event_qualifiers q
     WHERE q.event_id=p_event_id OR q.final_tournament_id=v_rules.final_tournament_id)
    OR EXISTS(SELECT 1 FROM public.tournament_entries e
       WHERE e.tournament_id=v_rules.final_tournament_id)
    OR EXISTS(SELECT 1 FROM public.tournament_seats s
       WHERE s.tournament_id=v_rules.final_tournament_id)
    OR EXISTS(SELECT 1 FROM public.tournaments t
     WHERE t.id=v_rules.final_tournament_id AND (t.event_id IS DISTINCT FROM p_event_id
       OR t.phase IS DISTINCT FROM 'final' OR t.club_id IS DISTINCT FROM v_rules.club_id
       OR t.deleted_at IS NOT NULL)) THEN v_ready:=false; END IF;
 v_state:=CASE WHEN EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
     WHERE l.event_id=p_event_id) THEN 'LOCKED'
    WHEN v_ready THEN 'READY' ELSE 'PLANNED' END;
 v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object(
   'eventId',p_event_id,'finalId',v_rules.final_tournament_id,
   'policy',v_rules.policy,'itmPercent',v_rules.itm_percent,
   'minCashX',v_rules.min_cash_x,'buyIn',v_rules.buy_in_vnd,
   'rake',v_rules.rake_vnd,'flights',v_flights)::text);
 RETURN pg_catalog.jsonb_build_object('state',v_state,'sourceHash',v_hash,
   'policy',v_rules.policy,'flights',v_flights,'flightCount',v_count,
   'fundingState','NOT_VERIFIED','payoutFinalization','HELD');
END $$;
REVOKE ALL ON FUNCTION public.multi_day_qualification_preview_v1(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_qualification_preview_v1(uuid)
 TO authenticated;

CREATE FUNCTION public.multi_day_lock_qualification_v1(
 p_event_id uuid,p_bag_ids uuid[],p_expected_source_hash text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_rules public.multi_day_qualification_rules_v1%ROWTYPE;
 v_preview jsonb; v_prior public.multi_day_qualification_locks_v1%ROWTYPE;
 v_selection_hash text; v_flight record; v_selected integer; v_total integer;
 v_player record; v_bags jsonb; v_stack numeric; v_selected_bag uuid;
 v_floor numeric; v_participation_id uuid; v_count integer:=0; v_receipt jsonb;
BEGIN
 IF v_actor IS NULL OR p_event_id IS NULL OR p_request_id IS NULL
    OR p_expected_source_hash !~ '^[0-9a-f]{32}$'
    OR p_bag_ids IS NULL OR pg_catalog.cardinality(p_bag_ids)=0 THEN
   RAISE EXCEPTION 'multi_day_lock_request_invalid' USING ERRCODE='22023';
 END IF;
 -- Event lock is the common fence for concurrent flight-set/registration
 -- changes. It is taken before source reads and held through all inserts.
 PERFORM 1 FROM public.tournament_events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_event_missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO v_rules FROM public.multi_day_qualification_rules_v1
   WHERE event_id=p_event_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'multi_day_rules_missing' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=v_rules.club_id
      AND c.owner_id=v_actor) THEN
   RAISE EXCEPTION 'multi_day_lock_actor_denied' USING ERRCODE='42501';
 END IF;
 SELECT pg_catalog.md5(pg_catalog.array_to_string(
   ARRAY(SELECT x::text FROM pg_catalog.unnest(p_bag_ids) AS x ORDER BY x),','))
   INTO v_selection_hash;
 SELECT * INTO v_prior FROM public.multi_day_qualification_locks_v1
   WHERE request_id=p_request_id;
 IF FOUND THEN
   IF v_prior.event_id IS DISTINCT FROM p_event_id OR v_prior.actor_id IS DISTINCT FROM v_actor
      OR v_prior.source_hash IS DISTINCT FROM p_expected_source_hash
      OR v_prior.selection_hash IS DISTINCT FROM v_selection_hash THEN
     RAISE EXCEPTION 'multi_day_lock_request_conflict' USING ERRCODE='23505';
   END IF;
   RETURN v_prior.receipt || pg_catalog.jsonb_build_object('idempotent',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.multi_day_qualification_locks_v1 l
     WHERE l.event_id=p_event_id) THEN
   RAISE EXCEPTION 'multi_day_qualification_already_locked' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g WHERE g.id
     AND g.enabled AND v_rules.club_id=ANY(g.allowed_club_ids)) THEN
   RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
 END IF;
 v_preview:=public.multi_day_qualification_preview_v1(p_event_id);
 IF v_preview->>'sourceHash' IS DISTINCT FROM p_expected_source_hash THEN
   RAISE EXCEPTION 'multi_day_qualification_stale_source' USING ERRCODE='40001';
 END IF;
 IF v_preview->>'state'<>'READY' THEN
   RAISE EXCEPTION 'multi_day_qualification_not_ready' USING ERRCODE='23514';
 END IF;
 IF pg_catalog.cardinality(p_bag_ids)<>
    (SELECT count(DISTINCT x) FROM pg_catalog.unnest(p_bag_ids) AS x)
    OR EXISTS(SELECT 1 FROM pg_catalog.unnest(p_bag_ids) AS x WHERE x IS NULL) THEN
   RAISE EXCEPTION 'multi_day_qualification_duplicate_bag' USING ERRCODE='22023';
 END IF;
 -- Each flight must nominate exactly its server-derived Day2 quota. Every
 -- selected bag must be an eligible sealed bag in the frozen projection.
 FOR v_flight IN SELECT * FROM pg_catalog.jsonb_array_elements(v_preview->'flights') LOOP
   SELECT count(*) INTO v_selected FROM pg_catalog.jsonb_array_elements(v_flight.value->'eligibleBags') b
     WHERE (b->>'bagId')::uuid=ANY(p_bag_ids);
   IF v_selected<>(v_flight.value->>'day2Target')::integer THEN
     RAISE EXCEPTION 'multi_day_qualification_quota_mismatch' USING ERRCODE='23514';
   END IF;
   v_total:=coalesce(v_total,0)+v_selected;
 END LOOP;
 IF v_total<>pg_catalog.cardinality(p_bag_ids) THEN
   RAISE EXCEPTION 'multi_day_qualification_bag_not_eligible' USING ERRCODE='23514';
 END IF;
 SELECT count(DISTINCT b.player_id) INTO v_count FROM public.chip_bag b
   WHERE b.id=ANY(p_bag_ids);
 v_floor:=(v_rules.buy_in_vnd::numeric+v_rules.rake_vnd::numeric)*v_rules.min_cash_x;
 v_receipt:=pg_catalog.jsonb_build_object('ok',true,'eventId',p_event_id,
   'finalTournamentId',v_rules.final_tournament_id,'sourceHash',p_expected_source_hash,
   'selectionHash',v_selection_hash,'policy',v_rules.policy,
   'participationCount',v_count,'fundingState','NOT_VERIFIED',
   'seatingState','HELD','payoutFinalization','HELD','idempotent',false);
 INSERT INTO public.multi_day_qualification_locks_v1(event_id,request_id,actor_id,
     source_hash,selection_hash,flight_ids,participation_count,receipt)
 VALUES(p_event_id,p_request_id,v_actor,p_expected_source_hash,v_selection_hash,
    ARRAY(SELECT (f->>'flightId')::uuid FROM pg_catalog.jsonb_array_elements(v_preview->'flights') f),
    v_count,v_receipt);
 FOR v_player IN SELECT DISTINCT b.player_id FROM public.chip_bag b
      WHERE b.id=ANY(p_bag_ids) ORDER BY b.player_id LOOP
   SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
       'bagId',b.id,'bagVersion',b.multi_day_sealed_version,
       'flightId',b.tournament_id,'sourceEntryId',r.entry_id,'stack',b.total_value)
       ORDER BY b.tournament_id,b.id),sum(b.total_value)::numeric
     INTO v_bags,v_stack
     FROM public.chip_bag b JOIN public.multi_day_flight_roster_v1 r
      ON r.flight_tournament_id=b.tournament_id AND r.player_id=b.player_id
     WHERE b.id=ANY(p_bag_ids) AND b.player_id=v_player.player_id;
   IF v_rules.policy='SELECT_LARGEST' THEN
     SELECT b.id,b.total_value INTO v_selected_bag,v_stack FROM public.chip_bag b
       WHERE b.id=ANY(p_bag_ids) AND b.player_id=v_player.player_id
       ORDER BY b.total_value DESC,b.id LIMIT 1;
   ELSE v_selected_bag:=NULL; END IF;
   IF v_stack IS NULL OR v_stack<=0 OR v_stack>2147483647 THEN
     RAISE EXCEPTION 'multi_day_qualification_stack_invalid' USING ERRCODE='22003';
   END IF;
   INSERT INTO public.multi_day_final_participations_v1(event_id,final_tournament_id,
      player_id,policy,carried_stack,participation_floor_vnd,source_bags,selected_bag_id)
   VALUES(p_event_id,v_rules.final_tournament_id,v_player.player_id,v_rules.policy,
      v_stack::bigint,v_floor,v_bags,v_selected_bag)
   RETURNING id INTO v_participation_id;
   IF v_rules.policy='SELECT_LARGEST' THEN
     INSERT INTO public.multi_day_nonselected_min_cash_v1(participation_id,bag_id,
       bag_version,source_entry_id,amount_vnd)
     SELECT v_participation_id,b.id,b.multi_day_sealed_version,r.entry_id,v_floor
     FROM public.chip_bag b JOIN public.multi_day_flight_roster_v1 r
       ON r.flight_tournament_id=b.tournament_id AND r.player_id=b.player_id
     WHERE b.id=ANY(p_bag_ids) AND b.player_id=v_player.player_id
       AND b.id<>v_selected_bag;
   END IF;
 END LOOP;
 RETURN v_receipt;
END $$;
REVOKE ALL ON FUNCTION public.multi_day_lock_qualification_v1(uuid,uuid[],text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_lock_qualification_v1(uuid,uuid[],text,uuid)
 TO authenticated;
