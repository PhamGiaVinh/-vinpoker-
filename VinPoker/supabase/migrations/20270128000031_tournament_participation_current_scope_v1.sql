-- Read-only participation projection; never repair or delete legacy seats.
-- ROLLBACK: forward migration restoring reviewed readers. Preserve all data.
-- CLI-generated candidate promoted to unused catalog31 after live ledger30
-- and source reservation checks. Never replay existing migrations.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_seats_for_draw(uuid)'::regprocedure)
   IS DISTINCT FROM 'abb73a71ca5f99316621f5ff8428bcf7' THEN
  RAISE EXCEPTION 'participation_reader_definition_drift';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.tournament_entries'::regclass
   AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (tournament_id, player_id, entry_no)')
   OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.tournament_chip_counts'::regclass
   AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (tournament_id, player_id, entry_number)') THEN
  RAISE EXCEPTION 'participation_identity_constraint_drift';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION floor_private.tournament_participation_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH entries AS (
  SELECT e.*,count(*) OVER (PARTITION BY e.player_id,e.entry_no) generation_count
  FROM public.tournament_entries e WHERE e.tournament_id=p_tournament_id
 ), seats AS (
  SELECT q.*,t.table_name,e.current_stack entry_stack,cc.chip_count projected_stack,
   count(*) OVER (PARTITION BY q.entry_id) entry_seat_count,
   count(*) OVER (PARTITION BY q.table_session_id,q.seat_number) position_count,
   CASE
    WHEN e.id IS NULL THEN 'missing_entry'
    WHEN e.tournament_id IS DISTINCT FROM q.tournament_id OR e.player_id IS DISTINCT FROM q.player_id
      OR e.entry_no IS DISTINCT FROM q.entry_number THEN 'entry_identity_mismatch'
    WHEN e.status NOT IN ('registered','seated') THEN 'entry_not_live'
    WHEN t.id IS NULL OR s.id IS NULL THEN 'missing_table_session'
    WHEN s.closed_at IS NOT NULL THEN 'closed_session'
    WHEN t.status IS DISTINCT FROM 'active' THEN 'inactive_table'
    WHEN t.tournament_id IS DISTINCT FROM q.tournament_id OR t.table_session_id IS DISTINCT FROM s.id
      OR s.tournament_id IS DISTINCT FROM q.tournament_id OR s.club_id IS DISTINCT FROM c.club_id
      OR s.game_table_id IS DISTINCT FROM t.game_table_id OR g.club_id IS DISTINCT FROM c.club_id
      OR q.table_id IS DISTINCT FROM t.id THEN 'table_session_mismatch'
    WHEN q.seat_number NOT BETWEEN 1 AND t.max_seats THEN 'seat_out_of_range'
    WHEN e.current_stack IS DISTINCT FROM q.chip_count
      OR cc.chip_count IS DISTINCT FROM q.chip_count THEN 'stack_projection_mismatch'
    ELSE NULL
   END lineage_error
  FROM public.tournament_seats q
  JOIN public.tournaments c ON c.id=q.tournament_id
  LEFT JOIN public.tournament_entries e ON e.id=q.entry_id
  LEFT JOIN public.tournament_tables t ON t.id=q.tournament_table_id
  LEFT JOIN public.table_sessions s ON s.id=q.table_session_id
  LEFT JOIN public.game_tables g ON g.id=t.game_table_id
  LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id=q.tournament_id
    AND cc.player_id=q.player_id AND cc.entry_number=q.entry_number
  WHERE q.tournament_id=p_tournament_id AND q.is_active
 ), classified_seats AS (
  SELECT s.*,COALESCE(lineage_error,
    CASE WHEN entry_seat_count<>1 THEN 'duplicate_entry_seat'
         WHEN position_count<>1 THEN 'duplicate_seat_position'
         WHEN e.generation_count<>1 THEN 'duplicate_entry_generation' END) anomaly_reason
  FROM seats s LEFT JOIN entries e ON e.id=s.entry_id
 ), classified_entries AS (
  SELECT e.*,
   CASE WHEN e.generation_count<>1 THEN 'anomaly'
    WHEN EXISTS(SELECT 1 FROM classified_seats s WHERE s.entry_id=e.id AND s.anomaly_reason IS NOT NULL) THEN 'anomaly'
    WHEN e.status='busted' THEN 'busted'
    WHEN e.status='finished' THEN 'finished'
    WHEN e.status='cancelled' THEN 'cancelled'
    WHEN EXISTS(SELECT 1 FROM classified_seats s WHERE s.entry_id=e.id AND s.anomaly_reason IS NULL) THEN 'seated'
    WHEN e.status='seated' THEN 'anomaly'
    ELSE 'waiting' END participation_status,
   CASE WHEN e.generation_count<>1 THEN 'duplicate_entry_generation'
    WHEN e.status='seated' AND NOT EXISTS(SELECT 1 FROM classified_seats s WHERE s.entry_id=e.id)
    THEN 'missing_active_seat' END entry_anomaly_reason,
   COALESCE((SELECT q.player_name FROM public.tournament_seats q
     WHERE q.entry_id=e.id ORDER BY q.is_active DESC,q.created_at DESC,q.id LIMIT 1),'') player_name
  FROM entries e
 )
 SELECT jsonb_build_object('tournament_id',p_tournament_id,
  'seats',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'seat_id',s.id,'entry_id',s.entry_id,'player_id',s.player_id,'player_name',s.player_name,'avatar_url',s.avatar_url,
   'entry_number',s.entry_number,'table_id',s.table_id,'tournament_table_id',s.tournament_table_id,
   'table_session_id',s.table_session_id,'table_name',s.table_name,'seat_number',s.seat_number,
   'chip_count',s.chip_count,'entry_stack',s.entry_stack,'projected_stack',s.projected_stack,
   'is_active',true,'participation_status',
    CASE WHEN s.anomaly_reason IS NULL THEN 'seated' ELSE 'anomaly' END,
   'anomaly_reason',s.anomaly_reason) ORDER BY s.table_id,s.seat_number,s.id)
   FROM classified_seats s),'[]'::jsonb),
  'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',e.id,'player_id',e.player_id,'player_name',e.player_name,'entry_no',e.entry_no,
   'status',e.status,'current_stack',e.current_stack,'seat_number',e.seat_number,
   'finished_place',e.finished_place,'participation_status',e.participation_status,
   'anomaly_reason',COALESCE(e.entry_anomaly_reason,
     (SELECT s.anomaly_reason FROM classified_seats s WHERE s.entry_id=e.id AND s.anomaly_reason IS NOT NULL ORDER BY s.id LIMIT 1)))
   ORDER BY e.player_id,e.entry_no,e.id) FROM classified_entries e),'[]'::jsonb),
  'counts',(SELECT jsonb_build_object(
   'total_entries',count(DISTINCT (player_id,entry_no)) FILTER(WHERE status<>'cancelled'),
   're_entries',count(DISTINCT (player_id,entry_no)) FILTER(WHERE status<>'cancelled' AND entry_no>1),
   'remaining',count(DISTINCT (player_id,entry_no)) FILTER(WHERE status IN ('registered','seated')),
   'seated',count(*) FILTER(WHERE participation_status='seated'),
   'waiting',count(*) FILTER(WHERE participation_status='waiting'),
   'busted',count(*) FILTER(WHERE participation_status='busted'),
   'anomaly_entries',count(*) FILTER(WHERE participation_status='anomaly'),
   'anomaly_seats',(SELECT count(*) FROM classified_seats WHERE anomaly_reason IS NOT NULL),
   'live_entry_stack',COALESCE(sum(current_stack) FILTER(WHERE status IN ('registered','seated')),0),
   'seated_stack',(SELECT COALESCE(sum(chip_count),0) FROM classified_seats WHERE anomaly_reason IS NULL),
   'waiting_stack',COALESCE(sum(current_stack) FILTER(WHERE participation_status='waiting'),0)
  ) FROM classified_entries));
$$;
REVOKE ALL ON FUNCTION floor_private.tournament_participation_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_tournament_participation_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid(); c uuid;
BEGIN
 SELECT club_id INTO c FROM public.tournaments WHERE id=p_tournament_id AND deleted_at IS NULL;
 IF a IS NULL OR c IS NULL OR NOT (public.is_club_floor(a,c) OR public.is_club_tracker(a,c) OR public.is_club_cashier(a,c)) THEN
  RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE='42501';
 END IF;
 RETURN floor_private.tournament_participation_v1(p_tournament_id);
END $$;
REVOKE ALL ON FUNCTION public.get_tournament_participation_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_participation_v1(uuid) TO authenticated;

-- Compatibility read returns only current valid seating. Operational consumers
-- must use the versioned projection to display anomalies rather than hide them.
CREATE OR REPLACE FUNCTION public.get_seats_for_draw(p_tournament_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE(jsonb_agg(s ORDER BY s->>'table_id',(s->>'seat_number')::integer),'[]'::jsonb)
 FROM jsonb_array_elements(public.get_tournament_participation_v1(p_tournament_id)->'seats') s
 WHERE s->>'participation_status'='seated';
$$;
REVOKE ALL ON FUNCTION public.get_seats_for_draw(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_seats_for_draw(uuid) TO authenticated;

-- Authenticated TV readers get aggregates only, with the existing club read
-- authority. They cannot retrieve the private operational rows through this RPC.
CREATE OR REPLACE FUNCTION public.get_tournament_participation_counts_v1(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid(); c uuid; counts jsonb;
BEGIN
 SELECT club_id INTO c FROM public.tournaments WHERE id=p_tournament_id AND deleted_at IS NULL;
 IF a IS NULL OR c IS NULL OR NOT (public.is_club_dealer_control(a,c)
   OR public.is_club_floor(a,c) OR public.is_club_tracker(a,c) OR public.is_club_cashier(a,c)) THEN
  RAISE EXCEPTION 'actor_not_authorized' USING ERRCODE='42501';
 END IF;
 counts:=floor_private.tournament_participation_v1(p_tournament_id)->'counts';
 RETURN jsonb_build_object('tournament_id',p_tournament_id,'counts',counts,
   'average_stack',CASE WHEN (counts->>'remaining')::bigint=0 THEN 0
     ELSE round((counts->>'live_entry_stack')::numeric/(counts->>'remaining')::numeric) END);
END $$;
REVOKE ALL ON FUNCTION public.get_tournament_participation_counts_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_participation_counts_v1(uuid) TO authenticated;

-- The paired token is the anonymous read capability. Preserve the existing
-- pairing/revocation/branding contract and heartbeat; replace only aggregates.
-- Never include operational seats/entries or accept a caller-supplied tour ID.
CREATE OR REPLACE FUNCTION public.get_tv_display_state_v4(p_display_token text,p_include_branding boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tv_displays%ROWTYPE; payload jsonb; counts jsonb; avg_stack numeric;
BEGIN
 IF p_display_token IS NULL OR length(p_display_token)<32 THEN
  RETURN jsonb_build_object('status','invalid'); END IF;
 -- The delegated getter writes last_seen_at. Acquire its write lock before
 -- delegating, avoiding SHARE-to-UPDATE upgrades between simultaneous polls.
 -- This also fences reassignment/revocation until the capability read finishes.
 SELECT * INTO d FROM public.tv_displays WHERE display_token=p_display_token FOR UPDATE;
 IF d.id IS NULL THEN RETURN jsonb_build_object('status','invalid'); END IF;
 IF d.status<>'paired' OR d.assigned_tournament_id IS NULL THEN
  RETURN public.get_tv_display_state(p_display_token); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=d.assigned_tournament_id
  AND t.club_id=d.club_id AND t.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('status','invalid'); END IF;
 payload:=CASE WHEN p_include_branding THEN public.get_tv_display_state_v3(p_display_token)
   ELSE public.get_tv_display_state(p_display_token) END;
 IF payload->>'status' IS DISTINCT FROM 'paired' OR payload->'tournament' IS NULL
   OR payload->'tournament'='null'::jsonb THEN RETURN payload; END IF;
 counts:=floor_private.tournament_participation_v1(d.assigned_tournament_id)->'counts';
 avg_stack:=CASE WHEN (counts->>'remaining')::bigint=0 THEN 0
   ELSE round((counts->>'live_entry_stack')::numeric/(counts->>'remaining')::numeric) END;
 payload:=jsonb_set(payload,'{tournament}',payload->'tournament'||jsonb_build_object(
   'players_remaining',counts->'remaining','average_stack',avg_stack),true);
 payload:=jsonb_set(payload,'{entries}',COALESCE(payload->'entries','{}'::jsonb)
   ||jsonb_build_object('total_confirmed',counts->'total_entries'),true);
 RETURN payload||jsonb_build_object('re_entries',counts->'re_entries','participation_counts',counts);
END $$;
REVOKE ALL ON FUNCTION public.get_tv_display_state_v4(text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v4(text,boolean) TO anon,authenticated;
COMMIT;
