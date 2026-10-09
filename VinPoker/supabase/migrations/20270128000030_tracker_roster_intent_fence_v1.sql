-- Forward catalog30: live ledger29 verified; never replay historical SQL.
-- Rollback via reviewed forward migration; preserve receipts and canonical entries.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.set_tracker_table_roster_seat(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)'::regprocedure);
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.set_tracker_table_roster_seat(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid)'::regprocedure) IS DISTINCT FROM '79028f01581113dea6dc484d8762ab06' THEN
  RAISE EXCEPTION 'roster_core_definition_drift';
 END IF;
 d:=replace(d,'public.set_tracker_table_roster_seat(', 'floor_private.set_tracker_roster_seat_core_v1(');
 IF position('floor_private.set_tracker_roster_seat_core_v1(' in d)=0 THEN RAISE EXCEPTION 'roster_core_copy_failed'; END IF;
 EXECUTE d;
END $$;
REVOKE ALL ON FUNCTION floor_private.set_tracker_roster_seat_core_v1(uuid,uuid,integer,text,integer,uuid,boolean,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.set_tracker_table_roster_seat_v2(
 p_tournament_id uuid,p_tournament_table_id uuid,p_table_session_id uuid,p_expected_epoch bigint,
 p_request_id uuid,p_seat_number integer,p_player_name text,p_chip_count integer,
 p_existing_player_id uuid DEFAULT NULL,p_touch_avatar boolean DEFAULT false,p_avatar_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid(); c public.tournaments%ROWTYPE; t public.tournament_tables%ROWTYPE;
 s public.table_sessions%ROWTYPE; f text; receipt record; result jsonb;
BEGIN
 IF a IS NULL OR p_tournament_id IS NULL OR p_tournament_table_id IS NULL
   OR p_table_session_id IS NULL OR p_expected_epoch IS NULL OR p_request_id IS NULL
   OR p_seat_number IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_request'); END IF;
 SELECT * INTO c FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 IF c.id IS NULL OR NOT (public.is_club_tracker(a,c.club_id) OR public.is_club_floor(a,c.club_id)) THEN
  RETURN jsonb_build_object('ok',false,'error','actor_not_authorized'); END IF;
 f:=jsonb_build_object('tournament',p_tournament_id,'table',p_tournament_table_id,'session',p_table_session_id,
  'epoch',p_expected_epoch,'seat',p_seat_number,'name',p_player_name,'chips',p_chip_count,
  'player',p_existing_player_id,'touch_avatar',p_touch_avatar,'avatar',p_avatar_url)::text;
 PERFORM floor_private.floor_table_v3_lock_receipt(a,'set_tracker_table_roster_seat_v2',p_request_id);
 SELECT * INTO receipt FROM floor_private.floor_table_v3_existing_receipt(a,'set_tracker_table_roster_seat_v2',p_request_id);
 IF FOUND THEN
  IF receipt.request_fingerprint<>f THEN RETURN jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN receipt.result;
 END IF;
 SELECT * INTO t FROM public.tournament_tables WHERE id=p_tournament_table_id;
 PERFORM 1 FROM public.game_tables WHERE id=t.game_table_id AND club_id=c.club_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','table_mismatch'); END IF;
 SELECT * INTO s FROM public.table_sessions WHERE id=p_table_session_id FOR UPDATE;
 SELECT * INTO t FROM public.tournament_tables WHERE id=p_tournament_table_id FOR UPDATE;
 IF t.tournament_id IS DISTINCT FROM c.id OR t.status IS DISTINCT FROM 'active'
  OR t.table_session_id IS DISTINCT FROM s.id OR s.id IS NULL OR s.closed_at IS NOT NULL
  OR s.tournament_id IS DISTINCT FROM c.id OR s.club_id IS DISTINCT FROM c.club_id
  OR s.game_table_id IS DISTINCT FROM t.game_table_id THEN
  RETURN jsonb_build_object('ok',false,'error','table_session_mismatch'); END IF;
 IF c.status IN ('completed','cancelled') THEN RETURN jsonb_build_object('ok',false,'error','tournament_not_open'); END IF;
 IF s.control_epoch IS DISTINCT FROM p_expected_epoch THEN RETURN jsonb_build_object('ok',false,'error','STALE_STATE'); END IF;
 IF EXISTS(SELECT 1 FROM public.table_session_seat_locks l WHERE l.table_session_id=s.id
  AND l.seat_number=p_seat_number AND l.unlocked_at IS NULL) THEN RETURN jsonb_build_object('ok',false,'error','seat_locked'); END IF;
 IF EXISTS(SELECT 1 FROM public.floor_pending_tracker_moves m WHERE m.status='pending'
  AND (m.source_table_session_id=s.id OR (m.destination_table_session_id=s.id AND m.destination_seat_number=p_seat_number))) THEN
  RETURN jsonb_build_object('ok',false,'error','pending_move'); END IF;
 result:=floor_private.set_tracker_roster_seat_core_v1(c.id,t.id,p_seat_number,p_player_name,p_chip_count,
  p_existing_player_id,p_touch_avatar,p_avatar_url,a);
 IF result->>'ok'='true' THEN
  result:=result||jsonb_build_object('table_session_id',s.id,'tournament_table_id',t.id,'control_epoch',s.control_epoch);
  PERFORM floor_private.floor_table_v3_save_receipt(a,'set_tracker_table_roster_seat_v2',p_request_id,f,result);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.set_tracker_table_roster_seat_v2(uuid,uuid,uuid,bigint,uuid,integer,text,integer,uuid,boolean,text) TO authenticated;
-- Old payload cannot distinguish old epoch/session. Never infer current authority.
CREATE OR REPLACE FUNCTION public.set_tracker_table_roster_seat(
 p_tournament_id uuid,p_table_id uuid,p_seat_number integer,p_player_name text,p_chip_count integer,
 p_existing_player_id uuid DEFAULT NULL,p_touch_avatar boolean DEFAULT false,p_avatar_url text DEFAULT NULL,p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',false,'error','roster_context_required');
$$;
COMMIT;
