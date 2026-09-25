-- SOURCE ONLY. Forward-only End Flight fence and immutable bagging roster.
-- Depends on live Multi-day, Floor V3 and Tracker schemas; deliberately does
-- not replay historical Chip Ops migrations or enable the package.
-- ROLLBACK: disable execution of multi_day_end_flight_v1 in a forward migration.
-- Preserve all end-flight/roster records; never delete a captured stack.

DO $preflight$ BEGIN
  IF to_regclass('public.chip_bag') IS NULL
     OR to_regclass('public.day_close') IS NULL
     OR to_regclass('public.tournament_events') IS NULL
     OR to_regclass('public.table_sessions') IS NULL
     OR to_regclass('public.tournament_chip_counts') IS NULL
     OR to_regclass('public.dealer_assignments') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='tournament_hands'
         AND column_name='source_revision')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='tournament_seats'
         AND column_name='table_session_id') THEN
    RAISE EXCEPTION 'multiday_end_flight_baseline_missing' USING ERRCODE='23514';
  END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS public.multi_day_package_release_v1 (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  allowed_club_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.multi_day_package_release_v1(id,enabled)
VALUES(true,false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.multi_day_package_release_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_package_release_v1
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.multi_day_flight_ends_v1 (
  flight_tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.tournament_events(id) ON DELETE RESTRICT,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  day_number integer NOT NULL CHECK(day_number > 0),
  status text NOT NULL DEFAULT 'bagging' CHECK(status IN ('bagging','locked')),
  end_request_id uuid NOT NULL UNIQUE,
  ended_by uuid NOT NULL REFERENCES auth.users(id),
  ended_at timestamptz NOT NULL DEFAULT now(),
  roster_count integer NOT NULL CHECK(roster_count > 0),
  roster_hash text NOT NULL CHECK(roster_hash ~ '^[0-9a-f]{32}$'),
  locked_at timestamptz,
  CONSTRAINT multi_day_flight_end_lock_shape_v1 CHECK (
    (status='bagging' AND locked_at IS NULL)
    OR (status='locked' AND locked_at IS NOT NULL)
  )
);
ALTER TABLE public.multi_day_flight_ends_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_flight_ends_v1
  FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE IF NOT EXISTS public.multi_day_flight_roster_v1 (
  flight_tournament_id uuid NOT NULL REFERENCES public.multi_day_flight_ends_v1(flight_tournament_id)
    ON DELETE RESTRICT,
  player_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES public.tournament_entries(id) ON DELETE RESTRICT,
  seat_id uuid NOT NULL REFERENCES public.tournament_seats(id) ON DELETE RESTRICT,
  tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id) ON DELETE RESTRICT,
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  table_session_revision bigint NOT NULL CHECK(table_session_revision >= 0),
  dealer_assignment_id uuid NOT NULL REFERENCES public.dealer_assignments(id) ON DELETE RESTRICT,
  dealer_assignment_version integer NOT NULL CHECK(dealer_assignment_version >= 0),
  seat_number integer NOT NULL CHECK(seat_number > 0),
  tracked_stack bigint NOT NULL CHECK(tracked_stack > 0),
  tracker_count_updated_at timestamptz NOT NULL,
  latest_hand_id uuid REFERENCES public.tournament_hands(id) ON DELETE RESTRICT,
  latest_hand_source_revision bigint,
  snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[0-9a-f]{32}$'),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(flight_tournament_id,player_id),
  UNIQUE(flight_tournament_id,entry_id),
  UNIQUE(flight_tournament_id,seat_id),
  CONSTRAINT multi_day_roster_hand_revision_shape_v1 CHECK (
    (latest_hand_id IS NULL AND latest_hand_source_revision IS NULL)
    OR (latest_hand_id IS NOT NULL AND latest_hand_source_revision IS NOT NULL)
  )
);
ALTER TABLE public.multi_day_flight_roster_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.multi_day_flight_roster_v1
  FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.multi_day_roster_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'multi_day_roster_immutable' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION private.multi_day_roster_immutable_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_roster_immutable_v1 BEFORE UPDATE OR DELETE
  ON public.multi_day_flight_roster_v1 FOR EACH ROW
  EXECUTE FUNCTION private.multi_day_roster_immutable_v1();

-- All hand creation paths (Tracker RPC, Edge/service role and direct insert)
-- pass this trigger. SHARE conflicts with End Flight's NO KEY UPDATE, while
-- child-table FK KEY SHARE does not: this avoids the insert/parent deadlock.
CREATE OR REPLACE FUNCTION private.multi_day_after_end_play_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tournament_id uuid; v_phase text;
BEGIN
  IF TG_TABLE_NAME='tournament_hands' THEN
    v_tournament_id:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
  ELSIF TG_TABLE_NAME='tournament_chip_counts' THEN
    v_tournament_id:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END;
  ELSE
    SELECT h.tournament_id INTO v_tournament_id FROM public.tournament_hands h
      WHERE h.id=CASE WHEN TG_OP='DELETE' THEN OLD.hand_id ELSE NEW.hand_id END;
  END IF;
  SELECT t.phase INTO v_phase FROM public.tournaments t
    WHERE t.id=v_tournament_id FOR SHARE;
  IF v_phase='flight' AND EXISTS (SELECT 1 FROM public.multi_day_flight_ends_v1 f
      WHERE f.flight_tournament_id=v_tournament_id) THEN
    RAISE EXCEPTION 'multi_day_end_play_source_frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.tournament_id IS DISTINCT FROM NEW.tournament_id THEN
    SELECT t.phase INTO v_phase FROM public.tournaments t
      WHERE t.id=OLD.tournament_id FOR SHARE;
    IF v_phase='flight' AND EXISTS (SELECT 1 FROM public.multi_day_flight_ends_v1 f
        WHERE f.flight_tournament_id=OLD.tournament_id) THEN
      RAISE EXCEPTION 'multi_day_end_play_source_frozen' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_after_end_play_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_end_play_hands_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.tournament_hands FOR EACH ROW
  EXECUTE FUNCTION private.multi_day_after_end_play_guard_v1();
CREATE TRIGGER multi_day_end_play_players_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.hand_players FOR EACH ROW
  EXECUTE FUNCTION private.multi_day_after_end_play_guard_v1();
CREATE TRIGGER multi_day_end_play_actions_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.hand_actions FOR EACH ROW
  EXECUTE FUNCTION private.multi_day_after_end_play_guard_v1();
CREATE TRIGGER multi_day_end_play_counts_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.tournament_chip_counts FOR EACH ROW
  EXECUTE FUNCTION private.multi_day_after_end_play_guard_v1();

-- Seat/entry writers may lock their own row before this trigger. Taking the
-- tournament SHARE lock here makes End Flight wait for them, and makes a later
-- writer recheck the closed state. This is flight-only; other Floor paths stay
-- untouched. No bag is allowed to derive a new entry after the snapshot.
CREATE OR REPLACE FUNCTION private.multi_day_after_end_roster_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tournament_id uuid; v_phase text;
BEGIN
  v_tournament_id:=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id
                         ELSE NEW.tournament_id END;
  SELECT t.phase INTO v_phase FROM public.tournaments t
    WHERE t.id=v_tournament_id FOR SHARE;
  IF v_phase='flight' AND EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
      WHERE f.flight_tournament_id=v_tournament_id) THEN
    RAISE EXCEPTION 'multi_day_end_play_roster_frozen' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND OLD.tournament_id IS DISTINCT FROM NEW.tournament_id THEN
    SELECT t.phase INTO v_phase FROM public.tournaments t
      WHERE t.id=OLD.tournament_id FOR SHARE;
    IF v_phase='flight' AND EXISTS(SELECT 1 FROM public.multi_day_flight_ends_v1 f
        WHERE f.flight_tournament_id=OLD.tournament_id) THEN
      RAISE EXCEPTION 'multi_day_end_play_roster_frozen' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.multi_day_after_end_roster_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER multi_day_end_play_seats_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.tournament_seats FOR EACH ROW
  EXECUTE FUNCTION private.multi_day_after_end_roster_guard_v1();
CREATE TRIGGER multi_day_end_play_entries_guard_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.tournament_entries FOR EACH ROW
  EXECUTE FUNCTION private.multi_day_after_end_roster_guard_v1();

CREATE OR REPLACE FUNCTION public.multi_day_end_flight_v1(
  p_flight_tournament_id uuid,p_day_number integer,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tour public.tournaments%ROWTYPE;
        v_prior public.multi_day_flight_ends_v1%ROWTYPE;
        v_final uuid; v_count integer; v_hash text;
BEGIN
  IF v_actor IS NULL OR p_flight_tournament_id IS NULL OR p_request_id IS NULL
     OR p_day_number IS NULL OR p_day_number < 1 THEN
    RAISE EXCEPTION 'multi_day_end_flight_request_invalid' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_tour FROM public.tournaments
    WHERE id=p_flight_tournament_id FOR NO KEY UPDATE;
  IF NOT FOUND OR v_tour.phase IS DISTINCT FROM 'flight' OR v_tour.event_id IS NULL
     OR v_tour.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'multi_day_flight_not_found' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clubs c
      WHERE c.id=v_tour.club_id AND c.owner_id=v_actor)
     AND NOT public.is_club_floor(v_actor,v_tour.club_id) THEN
    RAISE EXCEPTION 'multi_day_end_flight_actor_not_allowed' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_prior FROM public.multi_day_flight_ends_v1
    WHERE flight_tournament_id=p_flight_tournament_id;
  IF FOUND THEN
    IF v_prior.end_request_id IS DISTINCT FROM p_request_id
       OR v_prior.ended_by IS DISTINCT FROM v_actor
       OR v_prior.day_number IS DISTINCT FROM p_day_number THEN
      RAISE EXCEPTION 'multi_day_end_flight_request_conflict' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok',true,'status',v_prior.status,
      'rosterCount',v_prior.roster_count,'rosterHash',v_prior.roster_hash,
      'idempotent',true);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.multi_day_package_release_v1 g
      WHERE g.id AND g.enabled AND v_tour.club_id=ANY(g.allowed_club_ids)) THEN
    RAISE EXCEPTION 'multi_day_package_release_off' USING ERRCODE='42501';
  END IF;
  SELECT e.final_tournament_id INTO v_final FROM public.tournament_events e
    WHERE e.id=v_tour.event_id AND e.club_id=v_tour.club_id;
  IF v_final IS NULL OR EXISTS(SELECT 1 FROM public.tournament_hands h
      WHERE h.tournament_id=v_tour.id AND h.status='in_progress')
     OR EXISTS(SELECT 1 FROM public.chip_bag b WHERE b.tournament_id=v_tour.id)
     OR EXISTS(SELECT 1 FROM public.day_close d WHERE d.tournament_id=v_tour.id) THEN
    RAISE EXCEPTION 'multi_day_end_flight_not_ready' USING ERRCODE='23514';
  END IF;
  -- Reject missing/ambiguous active seat, entry, table session, dealer, or
  -- Tracker count. No fallback from seat chips or hand seed to a paid stack.
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats s
    LEFT JOIN public.tournament_entries e ON e.id=s.entry_id
      AND e.tournament_id=s.tournament_id AND e.player_id=s.player_id
      AND e.entry_no=s.entry_number
    LEFT JOIN public.tournament_tables tt ON tt.id=s.tournament_table_id
      AND tt.tournament_id=s.tournament_id AND tt.table_session_id=s.table_session_id
    LEFT JOIN public.table_sessions sess ON sess.id=s.table_session_id
      AND sess.tournament_id=s.tournament_id
    LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id=s.tournament_id
      AND cc.player_id=s.player_id AND cc.entry_number=s.entry_number
    WHERE s.tournament_id=v_tour.id AND s.is_active
      AND (e.id IS NULL OR tt.id IS NULL OR sess.id IS NULL
        OR cc.id IS NULL OR cc.chip_count<=0 OR cc.updated_at IS NULL
        OR (SELECT count(*) FROM public.dealer_assignments da
            WHERE da.table_session_id=s.table_session_id
              AND da.released_at IS NULL AND da.status='assigned')<>1)
  ) THEN
    RAISE EXCEPTION 'multi_day_end_flight_roster_inconsistent' USING ERRCODE='23514';
  END IF;
  SELECT count(DISTINCT s.player_id),pg_catalog.md5(coalesce(pg_catalog.string_agg(
      s.player_id::text||':'||s.entry_id::text||':'||cc.chip_count::text,
      '|' ORDER BY s.player_id::text),'')) INTO v_count,v_hash
  FROM public.tournament_seats s
  JOIN public.tournament_chip_counts cc ON cc.tournament_id=s.tournament_id
    AND cc.player_id=s.player_id AND cc.entry_number=s.entry_number
  WHERE s.tournament_id=v_tour.id AND s.is_active;
  IF v_count<1 OR v_count<>(SELECT count(*) FROM public.tournament_seats s
      WHERE s.tournament_id=v_tour.id AND s.is_active) THEN
    RAISE EXCEPTION 'multi_day_end_flight_roster_inconsistent' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.multi_day_flight_ends_v1(
    flight_tournament_id,event_id,club_id,day_number,end_request_id,
    ended_by,roster_count,roster_hash)
  VALUES(v_tour.id,v_tour.event_id,v_tour.club_id,p_day_number,p_request_id,
    v_actor,v_count,v_hash);
  INSERT INTO public.multi_day_flight_roster_v1(
    flight_tournament_id,player_id,entry_id,seat_id,tournament_table_id,
    table_session_id,table_session_revision,dealer_assignment_id,
    dealer_assignment_version,seat_number,tracked_stack,
    tracker_count_updated_at,latest_hand_id,latest_hand_source_revision,snapshot_hash)
  SELECT v_tour.id,s.player_id,s.entry_id,s.id,s.tournament_table_id,
    s.table_session_id,sess.revision,da.id,da.version,s.seat_number,
    cc.chip_count,cc.updated_at,h.id,h.source_revision,
    pg_catalog.md5(pg_catalog.jsonb_build_object('entry',s.entry_id,'seat',s.id,
      'table',s.tournament_table_id,'session',s.table_session_id,
      'sessionRevision',sess.revision,'dealer',da.id,
      'dealerVersion',da.version,'seatNumber',s.seat_number,
      'stack',cc.chip_count,'updated',cc.updated_at,
      'hand',h.id,'revision',h.source_revision)::text)
  FROM public.tournament_seats s
  JOIN public.tournament_chip_counts cc ON cc.tournament_id=s.tournament_id
    AND cc.player_id=s.player_id AND cc.entry_number=s.entry_number
  JOIN public.table_sessions sess ON sess.id=s.table_session_id
    AND sess.tournament_id=s.tournament_id
  JOIN LATERAL (SELECT da.id,da.version FROM public.dealer_assignments da
    WHERE da.table_session_id=s.table_session_id AND da.released_at IS NULL
      AND da.status='assigned' ORDER BY da.id LIMIT 1) da ON true
  LEFT JOIN LATERAL (SELECT hand.id,hand.source_revision
    FROM public.tournament_hands hand WHERE hand.tournament_id=s.tournament_id
      AND hand.table_session_id=s.table_session_id
    ORDER BY hand.hand_number DESC,hand.id DESC LIMIT 1) h ON true
  WHERE s.tournament_id=v_tour.id AND s.is_active;
  IF (SELECT count(*) FROM public.multi_day_flight_roster_v1 r
      WHERE r.flight_tournament_id=v_tour.id)<>v_count THEN
    RAISE EXCEPTION 'multi_day_end_flight_roster_inconsistent' USING ERRCODE='23514';
  END IF;
  SELECT pg_catalog.md5(pg_catalog.string_agg(r.snapshot_hash,'|'
      ORDER BY r.player_id::text)) INTO v_hash
    FROM public.multi_day_flight_roster_v1 r
    WHERE r.flight_tournament_id=v_tour.id;
  UPDATE public.multi_day_flight_ends_v1 SET roster_hash=v_hash
    WHERE flight_tournament_id=v_tour.id;
  INSERT INTO public.day_close(tournament_id,day_number,club_id,status)
    VALUES(v_tour.id,p_day_number,v_tour.club_id,'open');
  RETURN pg_catalog.jsonb_build_object('ok',true,'status','bagging',
    'rosterCount',v_count,'rosterHash',v_hash,'idempotent',false);
END $$;
REVOKE ALL ON FUNCTION public.multi_day_end_flight_v1(uuid,integer,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.multi_day_end_flight_v1(uuid,integer,uuid)
  TO authenticated;
