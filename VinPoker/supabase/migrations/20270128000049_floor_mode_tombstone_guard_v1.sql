-- Forward-only tombstone guard. No seat, chip, attendance or ledger changes.
-- Exact predecessor definitions are checked before surgical replacement; drift
-- aborts the whole transaction rather than overwriting an unknown live body.
-- Rollback: forward migration restoring the captured predecessor definitions
-- and removing trg_mode_tournament_lifecycle_v1; retain expired request history.
-- Unschedule exact50 first. Then revoke/drop the retry worker and retire its
-- cursor in the forward rollback; never drop mode request/audit history.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE signature text; expected text; definition text; old_fragment text; new_fragment text;
BEGIN
  FOR signature, expected IN SELECT * FROM (VALUES
    ('public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)','6eee12a1f821d289d672e5045a55d8da'),
    ('floor_private.resolve_table_mode_request_v1(uuid)','7fddff799c1f382de6f0e61cebdeda24'),
    ('public.floor_get_table_control_mode_request_v1(uuid,uuid)','233b8282a4f3d158ba00546fa31763b1'),
    ('public.floor_cancel_table_control_mode_request_v1(uuid,uuid,uuid)','f2394e970c5e295a60bdc6ee569ee19b'),
    ('public.get_floor_tournament_table_inventory_v1(uuid)','02f8a9ebe29cb2f3c8c9d6643259df9b')
  ) AS predecessor(signature,digest) LOOP
    IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'floor49 missing predecessor %',signature; END IF;
    definition:=replace(pg_get_functiondef(to_regprocedure(signature)),chr(13),'');
    IF md5(definition)<>expected THEN RAISE EXCEPTION 'floor49 predecessor drift %',signature; END IF;
  END LOOP;

  definition:=replace(pg_get_functiondef('public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid)'::regprocedure),chr(13),'');
  old_fragment:='IF c.status IN (''completed'',''cancelled'') THEN';
  new_fragment:='IF c.deleted_at IS NOT NULL OR c.status IN (''completed'',''cancelled'') THEN';
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'floor49 request seam missing'; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);

  definition:=replace(pg_get_functiondef('floor_private.resolve_table_mode_request_v1(uuid)'::regprocedure),chr(13),'');
  definition:=replace(definition,'DECLARE s public.table_sessions%ROWTYPE; t public.tournament_tables%ROWTYPE;',
    'DECLARE s public.table_sessions%ROWTYPE; t public.tournament_tables%ROWTYPE; v_tournament public.tournaments%ROWTYPE;');
  definition:=replace(definition,'r floor_private.table_mode_requests_v1%ROWTYPE; b jsonb',
    'r floor_private.table_mode_requests_v1%ROWTYPE; v_request_id uuid; b jsonb');
  old_fragment:='  SELECT * INTO r FROM floor_private.table_mode_requests_v1 WHERE table_session_id=p_session_id AND status=''pending'' FOR UPDATE;';
  new_fragment:=$request_lock$  SELECT * INTO r FROM floor_private.table_mode_requests_v1 WHERE table_session_id=p_session_id AND status='pending';
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_request_id:=r.id;
  BEGIN
    SELECT * INTO r FROM floor_private.table_mode_requests_v1 WHERE id=v_request_id AND status='pending' FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok',true,'outcome','pending','request_id',v_request_id,'blockers',jsonb_build_array('request_busy'));
  END;$request_lock$;
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'floor49 request lock seam missing'; END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:='  SELECT * INTO t FROM public.tournament_tables WHERE id=r.tournament_table_id;';
  new_fragment:=$resolver$  SELECT * INTO t FROM public.tournament_tables WHERE id=r.tournament_table_id;
  -- Callbacks may already hold a session lock. Never block on the tournament
  -- behind that lock: request/close lifecycle writers acquire tournament first.
  BEGIN
    SELECT * INTO v_tournament FROM public.tournaments WHERE id=t.tournament_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    UPDATE floor_private.table_mode_requests_v1 SET blockers='["tournament_busy"]' WHERE id=r.id;
    RETURN jsonb_build_object('ok',true,'outcome','pending','request_id',r.id,'blockers',jsonb_build_array('tournament_busy'));
  END;
  IF v_tournament.id IS NULL OR v_tournament.deleted_at IS NOT NULL OR v_tournament.status IN ('completed','cancelled')
    OR v_tournament.club_id IS DISTINCT FROM s.club_id THEN
    UPDATE floor_private.table_mode_requests_v1 SET status='expired',resolved_at=now(),blockers='["tournament_not_open"]' WHERE id=r.id;
    RETURN jsonb_build_object('ok',true,'outcome','expired','request_id',r.id);
  END IF;$resolver$;
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'floor49 resolver seam missing'; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);

  FOREACH signature IN ARRAY ARRAY[
    'public.floor_get_table_control_mode_request_v1(uuid,uuid)',
    'public.floor_cancel_table_control_mode_request_v1(uuid,uuid,uuid)'
  ] LOOP
    definition:=replace(pg_get_functiondef(to_regprocedure(signature)),chr(13),'');
    old_fragment:='FROM public.tournaments WHERE id=t.tournament_id';
    new_fragment:='FROM public.tournaments WHERE id=t.tournament_id AND deleted_at IS NULL';
    IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'floor49 scope seam missing %',signature; END IF;
    EXECUTE replace(definition,old_fragment,new_fragment);
  END LOOP;

  definition:=replace(pg_get_functiondef('public.get_floor_tournament_table_inventory_v1(uuid)'::regprocedure),chr(13),'');
  old_fragment:='FROM public.tournaments t WHERE t.id = p_tournament_id;';
  new_fragment:='FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;';
  IF position(old_fragment IN definition)=0 THEN RAISE EXCEPTION 'floor49 inventory seam missing'; END IF;
  EXECUTE replace(definition,old_fragment,new_fragment);
END $guard$;

-- Tombstoning/ending a tour terminalizes pending requests without locking or
-- modifying sessions. This avoids tournament -> request -> session inversion.
CREATE FUNCTION floor_private.expire_tournament_mode_requests_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR NEW.status IN ('completed','cancelled') THEN
    UPDATE floor_private.table_mode_requests_v1 r
    SET status='expired',resolved_at=now(),blockers='["tournament_not_open"]'
    FROM public.tournament_tables t
    WHERE r.tournament_table_id=t.id AND t.tournament_id=NEW.id AND r.status='pending';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.expire_tournament_mode_requests_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_mode_tournament_lifecycle_v1
AFTER UPDATE OF deleted_at,status ON public.tournaments FOR EACH ROW
WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION floor_private.expire_tournament_mode_requests_v1();

-- A cursor owns retry fairness only, never authorization or operational truth.
-- Advance over attempted AND locked candidates, so blocked/locked low UUIDs do
-- not permanently starve a ready tail. One worker per advisory transaction lock.
CREATE TABLE floor_private.table_mode_retry_cursor_v1 (
  singleton boolean PRIMARY KEY CHECK (singleton),
  last_session_id uuid
);
ALTER TABLE floor_private.table_mode_retry_cursor_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.table_mode_retry_cursor_v1 FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO floor_private.table_mode_retry_cursor_v1(singleton) VALUES(true);

-- Server retry entry point. Select a circular batch, then acquire its session
-- locks in UUID order; resolver never waits on a request/tournament row lock.
CREATE FUNCTION floor_private.resolve_pending_table_modes_v1(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid; cursor_id uuid; batch uuid[]; result jsonb;
  checked integer:=0; applied integer:=0; expired integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_mode_retry_limit';
  END IF;
  IF NOT pg_try_advisory_xact_lock(280000,49) THEN
    RETURN jsonb_build_object('checked',0,'applied',0,'expired',0,'busy',true);
  END IF;
  SELECT last_session_id INTO cursor_id FROM floor_private.table_mode_retry_cursor_v1 WHERE singleton FOR UPDATE;
  SELECT array_agg(candidate.id ORDER BY candidate.wrap,candidate.id) INTO batch FROM (
    SELECT s.id,CASE WHEN cursor_id IS NULL OR s.id>cursor_id THEN 0 ELSE 1 END AS wrap
    FROM public.table_sessions s
    JOIN floor_private.table_mode_requests_v1 r ON r.table_session_id=s.id AND r.status='pending'
    ORDER BY wrap,s.id LIMIT p_limit
  ) candidate;
  IF batch IS NULL THEN RETURN jsonb_build_object('checked',0,'applied',0,'expired',0); END IF;
  UPDATE floor_private.table_mode_retry_cursor_v1 SET last_session_id=batch[array_length(batch,1)] WHERE singleton;
  FOR sid IN
    SELECT s.id FROM public.table_sessions s
    WHERE s.id=ANY(batch) ORDER BY s.id FOR UPDATE OF s SKIP LOCKED
  LOOP
    result:=floor_private.resolve_table_mode_request_v1(sid);
    checked:=checked+1;
    IF result->>'outcome'='applied' THEN applied:=applied+1; END IF;
    IF result->>'outcome'='expired' THEN expired:=expired+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('checked',checked,'applied',applied,'expired',expired);
END $$;
REVOKE ALL ON FUNCTION floor_private.resolve_pending_table_modes_v1(integer) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
