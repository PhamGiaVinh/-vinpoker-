-- Durable mode changes. No seat/chip mutation. Reserved after live 00012.
-- Rollback: revoke public v4 RPCs, cancel pending requests with an audit reason,
-- and remove the boundary triggers in a forward migration; retain request history.
BEGIN;
CREATE TABLE floor_private.table_mode_requests_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id),
  tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id),
  actor_id uuid NOT NULL,
  target_mode text NOT NULL CHECK (target_mode IN ('manual','tracker')),
  initial_epoch bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled','expired')),
  blockers jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
ALTER TABLE floor_private.table_mode_requests_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.table_mode_requests_v1 FROM PUBLIC, anon, authenticated, service_role;
CREATE UNIQUE INDEX table_mode_requests_one_pending_v1 ON floor_private.table_mode_requests_v1(table_session_id) WHERE status='pending';

CREATE FUNCTION floor_private.resolve_table_mode_request_v1(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.table_sessions%ROWTYPE; t public.tournament_tables%ROWTYPE;
  r floor_private.table_mode_requests_v1%ROWTYPE; b jsonb := '[]';
BEGIN
  SELECT * INTO s FROM public.table_sessions WHERE id=p_session_id FOR UPDATE;
  SELECT * INTO r FROM floor_private.table_mode_requests_v1 WHERE table_session_id=p_session_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.tournament_tables WHERE id=r.tournament_table_id;
  IF s.id IS NULL OR s.closed_at IS NOT NULL OR t.status IS DISTINCT FROM 'active'
    OR t.table_session_id IS DISTINCT FROM s.id OR t.game_table_id IS DISTINCT FROM s.game_table_id
    OR t.tournament_id IS DISTINCT FROM s.tournament_id OR s.control_epoch IS DISTINCT FROM r.initial_epoch
    OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(r.actor_id,s.club_id)
    OR EXISTS(SELECT 1 FROM public.tournaments tournament WHERE tournament.id=t.tournament_id AND tournament.status IN ('completed','cancelled')) THEN
    UPDATE floor_private.table_mode_requests_v1 SET status='expired', resolved_at=now(), blockers='["session_changed"]' WHERE id=r.id;
    RETURN jsonb_build_object('ok',true,'outcome','expired');
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(t.tournament_id,t.id,s.id) THEN b:=b||'"active_hand"'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves m WHERE m.status='pending' AND (m.source_table_session_id=s.id OR m.destination_table_session_id=s.id)) THEN b:=b||'"pending_move"'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM public.tracker_voice_configs c WHERE c.tournament_table_id=t.id AND c.table_session_id=s.id AND c.correction_state='correction_pending')
    OR EXISTS(SELECT 1 FROM public.tracker_floor_alerts a JOIN public.tournament_hands h ON h.id=a.hand_id
      WHERE h.table_session_id=s.id AND a.correction_required IS TRUE AND a.status IN ('open','acknowledged','in_progress'))
    THEN b:=b||'"correction_pending"'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM public.tracker_voice_configs c WHERE c.tournament_table_id=t.id AND c.table_session_id IS NULL AND c.correction_state='correction_pending')
    OR EXISTS(SELECT 1 FROM public.tracker_floor_alerts a JOIN public.tournament_hands h ON h.id=a.hand_id
      WHERE h.table_session_id IS NULL AND h.tournament_table_id=t.id AND a.correction_required IS TRUE AND a.status IN ('open','acknowledged','in_progress'))
    THEN b:=b||'"correction_session_unknown"'::jsonb; END IF;
  IF jsonb_array_length(b)>0 THEN
    UPDATE floor_private.table_mode_requests_v1 SET blockers=b WHERE id=r.id;
    RETURN jsonb_build_object('ok',true,'outcome','pending','request_id',r.id,'blockers',b);
  END IF;
  UPDATE public.table_sessions SET control_mode=r.target_mode, control_epoch=control_epoch+1, revision=revision+1 WHERE id=s.id;
  UPDATE floor_private.table_mode_requests_v1 SET status='applied', resolved_at=now(), blockers='[]' WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'outcome','applied','request_id',r.id,'control_mode',r.target_mode);
END $$;
REVOKE ALL ON FUNCTION floor_private.resolve_table_mode_request_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.floor_request_table_control_mode_v4(
  p_tournament_table_id uuid,p_table_session_id uuid,p_control_mode text,
  p_expected_revision bigint,p_expected_epoch bigint,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid(); t public.tournament_tables%ROWTYPE; s public.table_sessions%ROWTYPE;
  c public.tournaments%ROWTYPE; f text; receipt record; r floor_private.table_mode_requests_v1%ROWTYPE; result jsonb;
BEGIN
  IF a IS NULL OR p_request_id IS NULL OR p_table_session_id IS NULL OR p_tournament_table_id IS NULL
    OR p_expected_revision IS NULL OR p_expected_epoch IS NULL OR p_control_mode IS NULL OR p_control_mode NOT IN ('manual','tracker') THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
  SELECT * INTO t FROM public.tournament_tables WHERE id=p_tournament_table_id;
  SELECT * INTO c FROM public.tournaments WHERE id=t.tournament_id FOR UPDATE;
  IF c.id IS NULL OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(a,c.club_id) THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  PERFORM 1 FROM public.game_tables WHERE id=t.game_table_id AND club_id=c.club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','game_table_scope_mismatch'); END IF;
  SELECT * INTO s FROM public.table_sessions WHERE id=p_table_session_id FOR UPDATE;
  SELECT * INTO t FROM public.tournament_tables WHERE id=p_tournament_table_id FOR UPDATE;
  f:=jsonb_build_object('table',p_tournament_table_id,'session',p_table_session_id,'mode',p_control_mode,'revision',p_expected_revision,'epoch',p_expected_epoch)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(a,'floor_request_table_control_mode_v4',p_request_id);
  SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(a,'floor_request_table_control_mode_v4',p_request_id);
  IF FOUND THEN
    IF receipt.request_fingerprint<>f THEN RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN receipt.result;
  END IF;
  IF s.id IS NULL OR s.closed_at IS NOT NULL OR t.status IS DISTINCT FROM 'active' OR t.table_session_id IS DISTINCT FROM s.id
    OR t.tournament_id IS DISTINCT FROM c.id OR s.tournament_id IS DISTINCT FROM c.id OR s.club_id IS DISTINCT FROM c.club_id OR s.game_table_id IS DISTINCT FROM t.game_table_id THEN
    RETURN jsonb_build_object('ok',false,'error','table_session_mismatch'); END IF;
  IF c.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_open'); END IF;
  IF s.revision<>p_expected_revision OR s.control_epoch<>p_expected_epoch THEN RETURN jsonb_build_object('ok',false,'error','STALE_STATE'); END IF;
  SELECT * INTO r FROM floor_private.table_mode_requests_v1 WHERE table_session_id=s.id AND status='pending';
  IF FOUND THEN
    IF r.target_mode<>p_control_mode THEN RETURN jsonb_build_object('ok',false,'error','cancel_pending_mode_first'); END IF;
    result:=floor_private.resolve_table_mode_request_v1(s.id);
  ELSIF s.control_mode=p_control_mode THEN result:=jsonb_build_object('ok',true,'outcome','unchanged');
  ELSE
    INSERT INTO floor_private.table_mode_requests_v1(table_session_id,tournament_table_id,actor_id,target_mode,initial_epoch)
      VALUES(s.id,t.id,a,p_control_mode,s.control_epoch);
    result:=floor_private.resolve_table_mode_request_v1(s.id);
  END IF;
  PERFORM floor_private.floor_table_v3_save_receipt(a,'floor_request_table_control_mode_v4',p_request_id,f,result);
  RETURN result;
END $$;

CREATE FUNCTION public.floor_get_table_control_mode_request_v1(p_tournament_table_id uuid,p_table_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tournament_tables%ROWTYPE; club uuid; r floor_private.table_mode_requests_v1%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tournament_tables WHERE id=p_tournament_table_id;
  SELECT club_id INTO club FROM public.tournaments WHERE id=t.tournament_id;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(auth.uid(),club) THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  IF t.table_session_id IS DISTINCT FROM p_table_session_id THEN RETURN jsonb_build_object('ok',false,'error','table_session_mismatch'); END IF;
  SELECT * INTO r FROM floor_private.table_mode_requests_v1 WHERE table_session_id=p_table_session_id AND status='pending';
  RETURN jsonb_build_object('ok',true,'request',CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'target_mode',r.target_mode,'blockers',r.blockers) END);
END $$;

CREATE FUNCTION public.floor_cancel_table_control_mode_request_v1(p_tournament_table_id uuid,p_table_session_id uuid,p_mode_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.tournament_tables%ROWTYPE; club uuid;
BEGIN
  SELECT * INTO t FROM public.tournament_tables WHERE id=p_tournament_table_id;
  SELECT club_id INTO club FROM public.tournaments WHERE id=t.tournament_id FOR UPDATE;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(auth.uid(),club) THEN RETURN jsonb_build_object('ok',false,'error','actor_not_allowed'); END IF;
  PERFORM 1 FROM public.table_sessions WHERE id=p_table_session_id FOR UPDATE;
  IF t.table_session_id IS DISTINCT FROM p_table_session_id THEN RETURN jsonb_build_object('ok',false,'error','table_session_mismatch'); END IF;
  UPDATE floor_private.table_mode_requests_v1 SET status='cancelled',resolved_at=now()
    WHERE id=p_mode_request_id AND table_session_id=p_table_session_id AND tournament_table_id=t.id AND status='pending';
  IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 WHERE id=p_mode_request_id AND table_session_id=p_table_session_id AND tournament_table_id=t.id AND status='cancelled') THEN
    RETURN jsonb_build_object('ok',false,'error','request_not_pending'); END IF;
  RETURN jsonb_build_object('ok',true,'outcome','cancelled');
END $$;

-- Deferred callbacks see the final transaction state after hand completion and moves.
CREATE FUNCTION floor_private.table_mode_boundary_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid uuid;
BEGIN
  IF TG_TABLE_NAME='tournament_hands' THEN
    IF TG_OP='INSERT' THEN
      PERFORM floor_private.resolve_table_mode_request_v1(NEW.table_session_id);
      IF EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 WHERE table_session_id=NEW.table_session_id AND status='pending') THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='table_mode_change_pending'; END IF;
      IF NEW.status='in_progress' AND EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 r
        JOIN public.table_sessions s ON s.id=r.table_session_id
        WHERE r.table_session_id=NEW.table_session_id AND r.status='applied' AND s.control_mode='manual') THEN
        RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='STALE_TRACKER_CONTEXT'; END IF;
    ELSE PERFORM floor_private.resolve_table_mode_request_v1(NEW.table_session_id); END IF;
  ELSIF TG_TABLE_NAME='floor_pending_tracker_moves' THEN
    FOR sid IN SELECT DISTINCT x FROM unnest(ARRAY[NEW.source_table_session_id,NEW.destination_table_session_id]) x ORDER BY x LOOP
      PERFORM floor_private.resolve_table_mode_request_v1(sid);
    END LOOP;
  ELSIF TG_TABLE_NAME='tracker_voice_configs' THEN
    SELECT table_session_id INTO sid FROM public.tournament_tables WHERE id=NEW.tournament_table_id;
    PERFORM floor_private.resolve_table_mode_request_v1(sid);
  ELSIF TG_TABLE_NAME='tracker_floor_alerts' THEN
    SELECT table_session_id INTO sid FROM public.tournament_hands WHERE id=NEW.hand_id;
    PERFORM floor_private.resolve_table_mode_request_v1(sid);
  ELSE PERFORM floor_private.resolve_table_mode_request_v1(NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION floor_private.table_mode_boundary_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_mode_before_new_hand_v1 BEFORE INSERT ON public.tournament_hands FOR EACH ROW EXECUTE FUNCTION floor_private.table_mode_boundary_v1();
CREATE CONSTRAINT TRIGGER trg_mode_after_hand_v1 AFTER UPDATE ON public.tournament_hands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION floor_private.table_mode_boundary_v1();
CREATE CONSTRAINT TRIGGER trg_mode_after_moves_v1 AFTER UPDATE ON public.floor_pending_tracker_moves DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION floor_private.table_mode_boundary_v1();
CREATE CONSTRAINT TRIGGER trg_mode_after_correction_v1 AFTER UPDATE ON public.tracker_voice_configs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION floor_private.table_mode_boundary_v1();
CREATE CONSTRAINT TRIGGER trg_mode_after_alert_v1 AFTER UPDATE ON public.tracker_floor_alerts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION floor_private.table_mode_boundary_v1();
CREATE CONSTRAINT TRIGGER trg_mode_after_session_v1 AFTER UPDATE ON public.table_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION floor_private.table_mode_boundary_v1();
REVOKE ALL ON FUNCTION public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.floor_get_table_control_mode_request_v1(uuid,uuid) FROM PUBLIC,anon,service_role;
REVOKE ALL ON FUNCTION public.floor_cancel_table_control_mode_request_v1(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.floor_request_table_control_mode_v4(uuid,uuid,text,bigint,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_get_table_control_mode_request_v1(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_cancel_table_control_mode_request_v1(uuid,uuid,uuid) TO authenticated;
COMMIT;
