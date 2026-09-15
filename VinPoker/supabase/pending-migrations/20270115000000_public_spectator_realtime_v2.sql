-- Public spectator projection v2 (SOURCE ONLY; feature remains OFF).
-- Business tables remain authoritative. These objects only copy sanitized data
-- for guest viewing and never settle hands, calculate winners, or mutate chips.
-- ROLLBACK: unschedule public-spectator-v2-dispatch, revoke the RPC grants, drop
-- the triggers/functions below, then drop schema spectator_projection_v2.

CREATE SCHEMA IF NOT EXISTS spectator_projection_v2;
REVOKE ALL ON SCHEMA spectator_projection_v2 FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA spectator_projection_v2 TO service_role;

CREATE TABLE spectator_projection_v2.entity_markers (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  component text NOT NULL CHECK (component IN ('tables','ranking','payout','visibility')),
  entity_key text NOT NULL,
  source_revision bigint NOT NULL DEFAULT 1,
  source_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tournament_id, component, entity_key)
);

CREATE TABLE spectator_projection_v2.work_groups (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  component text NOT NULL CHECK (component IN ('tables','ranking','payout','visibility')),
  group_key text NOT NULL,
  dirty_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_vector jsonb NOT NULL DEFAULT '{}'::jsonb,
  oldest_pending_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_until timestamptz,
  fencing_token uuid,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  PRIMARY KEY (tournament_id, component, group_key)
);

CREATE SEQUENCE spectator_projection_v2.publication_revision_seq;
CREATE TABLE spectator_projection_v2.publications (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  component text NOT NULL CHECK (component IN ('tables','ranking','payout','visibility')),
  publication_revision bigint NOT NULL DEFAULT nextval('spectator_projection_v2.publication_revision_seq'),
  source_vector jsonb NOT NULL,
  payload jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tournament_id, component),
  UNIQUE (publication_revision)
);

CREATE TABLE spectator_projection_v2.notification_throttle (
  tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  last_sent_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz
);

REVOKE ALL ON ALL TABLES IN SCHEMA spectator_projection_v2 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA spectator_projection_v2 TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA spectator_projection_v2 TO service_role;

CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_dirty(
  p_tournament_id uuid,
  p_component text,
  p_entity_key text,
  p_group_key text DEFAULT 'event'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision bigint;
  v_dirty_id text := gen_random_uuid()::text;
BEGIN
  IF p_tournament_id IS NULL OR p_component NOT IN ('tables','ranking','payout','visibility') THEN RETURN; END IF;
  INSERT INTO spectator_projection_v2.entity_markers(tournament_id, component, entity_key)
  VALUES (p_tournament_id, p_component, COALESCE(NULLIF(p_entity_key,''),'set'))
  ON CONFLICT (tournament_id, component, entity_key) DO UPDATE
    SET source_revision = spectator_projection_v2.entity_markers.source_revision + 1,
        source_changed_at = clock_timestamp()
  RETURNING source_revision INTO v_revision;

  INSERT INTO spectator_projection_v2.work_groups(tournament_id, component, group_key, dirty_ids, source_vector)
  VALUES (p_tournament_id, p_component, p_group_key,
          jsonb_build_array(v_dirty_id), jsonb_build_object(COALESCE(NULLIF(p_entity_key,''),'set'), v_revision::text))
  ON CONFLICT (tournament_id, component, group_key) DO UPDATE
    SET dirty_ids = spectator_projection_v2.work_groups.dirty_ids || EXCLUDED.dirty_ids,
        source_vector = spectator_projection_v2.work_groups.source_vector || EXCLUDED.source_vector,
        oldest_pending_at = LEAST(spectator_projection_v2.work_groups.oldest_pending_at, EXCLUDED.oldest_pending_at),
        available_at = LEAST(spectator_projection_v2.work_groups.available_at, EXCLUDED.available_at),
        claimed_until = NULL, fencing_token = NULL, attempts = 0, last_error = NULL;
END;
$$;

REVOKE ALL ON FUNCTION spectator_projection_v2.mark_dirty(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION spectator_projection_v2.mark_dirty(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_row_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row jsonb;
  v_tid uuid;
  v_entity text;
  v_component text := TG_ARGV[0];
  v_group text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  v_tid := NULLIF(COALESCE(v_row->>'tournament_id',CASE WHEN TG_TABLE_NAME='tournaments' THEN v_row->>'id' END),'')::uuid;
  v_entity := COALESCE(v_row->>'id', v_row->>'player_id', v_row->>'position', 'set');
  -- Ranking and payout rows written by one business transaction must publish as
  -- one unit. pg_current_xact_id() is stable for every trigger in that commit.
  v_group := CASE WHEN v_component IN ('ranking','payout') THEN 'tx:' || pg_current_xact_id()::text ELSE COALESCE(NULLIF(v_row->>'hand_id',''), v_entity) END;
  PERFORM spectator_projection_v2.mark_dirty(v_tid, v_component, v_entity, v_group);
  IF TG_OP = 'DELETE' OR TG_OP = 'INSERT' THEN
    PERFORM spectator_projection_v2.mark_dirty(v_tid, v_component, 'set', v_group);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION spectator_projection_v2.mark_hand_child_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row jsonb;
  v_tid uuid;
  v_hand_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD); ELSE v_row := to_jsonb(NEW); END IF;
  v_hand_id := NULLIF(v_row->>'hand_id','')::uuid;
  SELECT h.tournament_id INTO v_tid FROM public.tournament_hands h WHERE h.id = v_hand_id;
  PERFORM spectator_projection_v2.mark_dirty(v_tid, 'tables', v_hand_id::text, v_hand_id::text);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spectator_v2_tournaments_dirty ON public.tournaments;
CREATE TRIGGER spectator_v2_tournaments_dirty AFTER INSERT OR UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('visibility');
DROP TRIGGER IF EXISTS spectator_v2_tournament_ranking_dirty ON public.tournaments;
CREATE TRIGGER spectator_v2_tournament_ranking_dirty AFTER UPDATE OF current_level, current_level_id ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('ranking');
DROP TRIGGER IF EXISTS spectator_v2_levels_ranking_dirty ON public.tournament_levels;
CREATE TRIGGER spectator_v2_levels_ranking_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_levels
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('ranking');
DROP TRIGGER IF EXISTS spectator_v2_sessions_tables_dirty ON public.table_sessions;
CREATE TRIGGER spectator_v2_sessions_tables_dirty AFTER INSERT OR UPDATE OR DELETE ON public.table_sessions
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('tables');
DROP TRIGGER IF EXISTS spectator_v2_tables_dirty ON public.tournament_tables;
CREATE TRIGGER spectator_v2_tables_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_tables
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('tables');
DROP TRIGGER IF EXISTS spectator_v2_seats_dirty ON public.tournament_seats;
CREATE TRIGGER spectator_v2_seats_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('tables');
DROP TRIGGER IF EXISTS spectator_v2_seats_ranking_dirty ON public.tournament_seats;
CREATE TRIGGER spectator_v2_seats_ranking_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('ranking');
DROP TRIGGER IF EXISTS spectator_v2_seats_payout_dirty ON public.tournament_seats;
CREATE TRIGGER spectator_v2_seats_payout_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_seats
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('payout');
DROP TRIGGER IF EXISTS spectator_v2_hands_dirty ON public.tournament_hands;
CREATE TRIGGER spectator_v2_hands_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('tables');
DROP TRIGGER IF EXISTS spectator_v2_hand_players_dirty ON public.hand_players;
CREATE TRIGGER spectator_v2_hand_players_dirty AFTER INSERT OR UPDATE OR DELETE ON public.hand_players
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_hand_child_dirty();
DROP TRIGGER IF EXISTS spectator_v2_hand_actions_dirty ON public.hand_actions;
CREATE TRIGGER spectator_v2_hand_actions_dirty AFTER INSERT OR UPDATE OR DELETE ON public.hand_actions
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_hand_child_dirty();
DROP TRIGGER IF EXISTS spectator_v2_chip_counts_dirty ON public.tournament_chip_counts;
CREATE TRIGGER spectator_v2_chip_counts_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_chip_counts
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('ranking');
DROP TRIGGER IF EXISTS spectator_v2_chip_counts_tables_dirty ON public.tournament_chip_counts;
CREATE TRIGGER spectator_v2_chip_counts_tables_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_chip_counts
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('tables');
DROP TRIGGER IF EXISTS spectator_v2_entries_dirty ON public.tournament_entries;
CREATE TRIGGER spectator_v2_entries_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_entries
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('ranking');
DROP TRIGGER IF EXISTS spectator_v2_entries_payout_dirty ON public.tournament_entries;
CREATE TRIGGER spectator_v2_entries_payout_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_entries
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('payout');
DROP TRIGGER IF EXISTS spectator_v2_prizes_dirty ON public.tournament_prizes;
CREATE TRIGGER spectator_v2_prizes_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_prizes
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('payout');
DROP TRIGGER IF EXISTS spectator_v2_eliminations_dirty ON public.tournament_eliminations;
CREATE TRIGGER spectator_v2_eliminations_dirty AFTER INSERT OR UPDATE OR DELETE ON public.tournament_eliminations
FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('payout');

-- Bootstrap existing events without treating zero/empty values as real data.
SELECT spectator_projection_v2.mark_dirty(t.id,c.component,'set','event')
FROM public.tournaments t
CROSS JOIN (VALUES('tables'),('ranking'),('payout')) AS c(component)
WHERE t.deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_public_spectator_projection_v2(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  WITH due AS (
    SELECT w.tournament_id, w.component, w.group_key
    FROM spectator_projection_v2.work_groups w
    WHERE w.available_at <= clock_timestamp()
      AND (w.claimed_until IS NULL OR w.claimed_until < clock_timestamp())
    ORDER BY w.available_at, w.tournament_id, w.component, w.group_key
    FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),50)
  ), claimed AS (
    UPDATE spectator_projection_v2.work_groups w
       SET claimed_until=clock_timestamp()+interval '15 seconds', fencing_token=gen_random_uuid(), attempts=w.attempts+1
      FROM due d WHERE (w.tournament_id,w.component,w.group_key)=(d.tournament_id,d.component,d.group_key)
    RETURNING w.*
  ) SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_result FROM claimed;
  RETURN v_result;
END; $$;
REVOKE ALL ON FUNCTION public.claim_public_spectator_projection_v2(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_spectator_projection_v2(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_spectator_projection_source_v2(
  p_tournament_id uuid, p_component text, p_fencing_token uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_payload jsonb; v_vector jsonb; BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM spectator_projection_v2.work_groups w WHERE w.tournament_id=p_tournament_id AND w.component=p_component AND w.fencing_token=p_fencing_token AND w.claimed_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'lease_expired';
  END IF;
  SELECT COALESCE(jsonb_object_agg(m.entity_key,m.source_revision::text),'{}'::jsonb) INTO v_vector
  FROM spectator_projection_v2.entity_markers m WHERE m.tournament_id=p_tournament_id AND m.component=p_component;

  IF p_component='tables' THEN
    SELECT jsonb_build_object('items',COALESCE(jsonb_agg(x ORDER BY x->>'name'),'[]'::jsonb),'removed','[]'::jsonb) INTO v_payload FROM (
      SELECT jsonb_build_object(
        'tableId',tt.id,'tableSessionId',COALESCE(h.table_session_id,tt.table_session_id),'name',tt.table_name,
        'handId',h.id,'handNumber',h.hand_number,'buttonSeat',h.button_seat,
        'street',CASE WHEN h.id IS NULL THEN NULL ELSE CASE jsonb_array_length(COALESCE(h.community_cards,'[]'::jsonb))
          WHEN 0 THEN 'preflop' WHEN 3 THEN 'flop' WHEN 4 THEN 'turn' ELSE 'river' END END,
        'board',CASE WHEN h.id IS NULL THEN NULL ELSE COALESCE(h.community_cards,'[]'::jsonb) END,
        'pot',CASE WHEN h.id IS NULL THEN NULL ELSE h.pot_size END,
        'smallBlind',h.tracker_small_blind,'bigBlind',h.tracker_big_blind,
        'trackerState',CASE WHEN h.id IS NULL THEN 'unavailable' ELSE 'live' END,
        'latestAction',CASE WHEN h.id IS NULL THEN NULL ELSE (SELECT jsonb_build_object(
          'playerId',ha.player_id,'entryNumber',ha.entry_number,'actionType',ha.action_type,'amount',ha.action_amount)
          FROM public.hand_actions ha WHERE ha.hand_id=h.id ORDER BY ha.action_order DESC LIMIT 1) END,
        'players',CASE WHEN h.id IS NOT NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'entryId',e.id,'playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
          'name',COALESCE(NULLIF(hp.player_name,''),'Người chơi'),'avatarUrl',hp.avatar_url,
          'stack',cc.chip_count) ORDER BY hp.seat_number)
          FROM public.hand_players hp
          LEFT JOIN public.tournament_entries e ON e.tournament_id=p_tournament_id
            AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
          LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id=p_tournament_id
            AND cc.player_id=hp.player_id AND cc.entry_number=hp.entry_number
          WHERE hp.hand_id=h.id),'[]'::jsonb)
        ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'entryId',s.entry_id,'playerId',s.player_id,'entryNumber',s.entry_number,'seatNumber',s.seat_number,
          'name',COALESCE(NULLIF(s.player_name,''),'Người chơi'),'avatarUrl',s.avatar_url,
          'stack',cc.chip_count) ORDER BY s.seat_number)
          FROM public.tournament_seats s LEFT JOIN public.tournament_chip_counts cc
            ON cc.tournament_id=s.tournament_id AND cc.player_id=s.player_id AND cc.entry_number=s.entry_number
          WHERE s.tournament_id=p_tournament_id AND s.tournament_table_id=tt.id
            AND s.table_session_id=tt.table_session_id AND s.is_active),'[]'::jsonb) END
      ) x
      FROM public.tournament_tables tt
      LEFT JOIN LATERAL (SELECT th.* FROM public.tournament_hands th
        WHERE th.tournament_id=p_tournament_id AND th.tournament_table_id=tt.id
          AND th.table_session_id=tt.table_session_id AND th.status='in_progress'
          AND NOT COALESCE(th.is_voided,false)
        ORDER BY th.created_at DESC LIMIT 1) h ON true
      WHERE tt.tournament_id=p_tournament_id
    ) q;
  ELSIF p_component='ranking' THEN
    SELECT jsonb_build_object(
      'bigBlind',(SELECT l.big_blind FROM public.tournaments t LEFT JOIN public.tournament_levels l
        ON l.tournament_id=t.id AND ((t.current_level_id IS NOT NULL AND l.id=t.current_level_id)
          OR (t.current_level_id IS NULL AND l.level_number=t.current_level)) WHERE t.id=p_tournament_id LIMIT 1),
      'items',COALESCE(jsonb_agg(x ORDER BY (x->>'chips')::numeric DESC NULLS LAST),'[]'::jsonb)) INTO v_payload FROM (
      SELECT jsonb_build_object('entryId',e.id,'playerId',c.player_id,'entryNumber',c.entry_number,
        'name',COALESCE(NULLIF(s.player_name,''),'Người chơi'),'avatarUrl',s.avatar_url,
        'chips',c.chip_count,'updatedAt',c.updated_at) x
      FROM public.tournament_chip_counts c
      LEFT JOIN public.tournament_entries e ON e.tournament_id=c.tournament_id AND e.player_id=c.player_id AND e.entry_no=c.entry_number
      LEFT JOIN LATERAL (
        SELECT seat.player_name,seat.avatar_url FROM public.tournament_seats seat
        WHERE seat.tournament_id=c.tournament_id
          AND ((e.id IS NOT NULL AND seat.entry_id=e.id) OR (e.id IS NULL AND seat.player_id=c.player_id AND seat.entry_number=c.entry_number))
        ORDER BY seat.is_active DESC,seat.created_at DESC LIMIT 1
      ) s ON true
      WHERE c.tournament_id=p_tournament_id AND c.chip_count>0
    ) q;
  ELSIF p_component='payout' THEN
    SELECT jsonb_build_object('published',COUNT(*)>0,'items',COALESCE(jsonb_agg(x ORDER BY (x->>'fromPlace')::int),'[]'::jsonb)) INTO v_payload FROM (
      SELECT jsonb_build_object('fromPlace',p.position,'toPlace',p.position,'amountPerPlayer',p.amount,
        'playerName',CASE WHEN e.finished_place=p.position THEN COALESCE(NULLIF(s.player_name,''),NULL) ELSE NULL END,
        'avatarUrl',CASE WHEN e.finished_place=p.position THEN s.avatar_url ELSE NULL END,
        'resultStatus',CASE WHEN e.finished_place=p.position THEN 'official' ELSE 'open' END) x
      FROM public.tournament_prizes p
      LEFT JOIN LATERAL (
        SELECT candidate.tournament_id,(array_agg(candidate.player_id))[1] AS player_id,
          (array_agg(candidate.entry_no))[1] AS entry_no,candidate.finished_place
        FROM public.tournament_entries candidate
        WHERE candidate.tournament_id=p.tournament_id AND candidate.finished_place=p.position
        GROUP BY candidate.tournament_id,candidate.finished_place HAVING count(*)=1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT seat.player_name,seat.avatar_url FROM public.tournament_seats seat
        WHERE seat.tournament_id=e.tournament_id AND seat.player_id=e.player_id AND seat.entry_number=e.entry_no
        ORDER BY seat.is_active DESC,seat.created_at DESC LIMIT 1
      ) s ON true
      WHERE p.tournament_id=p_tournament_id
    ) q;
  ELSE v_payload := '{}'::jsonb; END IF;
  RETURN jsonb_build_object('tournamentId',p_tournament_id,'component',p_component,'sourceVector',v_vector,'payload',COALESCE(v_payload,'{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.get_public_spectator_projection_source_v2(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_spectator_projection_source_v2(uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.publish_public_spectator_projection_v2(
  p_tournament_id uuid, p_component text, p_group_key text, p_fencing_token uuid,
  p_source_vector jsonb, p_payload jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_current jsonb; v_notify boolean:=false; BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM spectator_projection_v2.work_groups w
   WHERE w.tournament_id=p_tournament_id AND w.component=p_component AND w.group_key=p_group_key
     AND w.fencing_token=p_fencing_token AND w.claimed_until>clock_timestamp()
   FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Lock the exact source markers in a deterministic order before comparing
  -- the vector. This fences concurrent publication without touching business rows.
  PERFORM 1 FROM spectator_projection_v2.entity_markers m
   WHERE m.tournament_id=p_tournament_id AND m.component=p_component
   ORDER BY m.entity_key FOR UPDATE NOWAIT;
  SELECT COALESCE(jsonb_object_agg(m.entity_key,m.source_revision::text),'{}'::jsonb) INTO v_current
    FROM spectator_projection_v2.entity_markers m WHERE m.tournament_id=p_tournament_id AND m.component=p_component;
  IF v_current IS DISTINCT FROM p_source_vector THEN
    UPDATE spectator_projection_v2.work_groups SET claimed_until=NULL,fencing_token=NULL,available_at=clock_timestamp() WHERE tournament_id=p_tournament_id AND component=p_component AND group_key=p_group_key;
    RETURN false;
  END IF;
  INSERT INTO spectator_projection_v2.publications(tournament_id,component,source_vector,payload)
  VALUES(p_tournament_id,p_component,p_source_vector,p_payload)
  ON CONFLICT(tournament_id,component) DO UPDATE SET source_vector=EXCLUDED.source_vector,payload=EXCLUDED.payload,
    publication_revision=nextval('spectator_projection_v2.publication_revision_seq'),published_at=clock_timestamp();
  -- The payload is a full component snapshot. Clear every older group whose
  -- requested revisions are covered by this exact source vector. A concurrent
  -- newer revision cannot pass this predicate and remains pending.
  DELETE FROM spectator_projection_v2.work_groups w
  WHERE w.tournament_id=p_tournament_id AND w.component=p_component
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each_text(w.source_vector) requested
      WHERE p_source_vector->>requested.key IS NULL
         OR (p_source_vector->>requested.key)::bigint < requested.value::bigint
    );
  INSERT INTO spectator_projection_v2.notification_throttle(tournament_id,last_sent_at) VALUES(p_tournament_id,clock_timestamp())
  ON CONFLICT(tournament_id) DO UPDATE SET last_sent_at=EXCLUDED.last_sent_at
    WHERE spectator_projection_v2.notification_throttle.last_sent_at<=clock_timestamp()-interval '1 second'
  RETURNING true INTO v_notify;
  IF COALESCE(v_notify,false) THEN
    PERFORM realtime.send(jsonb_build_object('tournamentId',p_tournament_id),'changed','public:tournament-viewer-v2:'||p_tournament_id::text,false);
  END IF;
  RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END; $$;
REVOKE ALL ON FUNCTION public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_public_spectator_projection_v2(uuid,text,text,uuid,jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.fail_public_spectator_projection_v2(
  p_tournament_id uuid,p_component text,p_group_key text,p_fencing_token uuid,p_error text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  UPDATE spectator_projection_v2.work_groups w SET
    claimed_until=NULL,fencing_token=NULL,last_error=left(COALESCE(p_error,'unknown'),300),
    available_at=CASE WHEN w.attempts>=8 THEN clock_timestamp()+interval '5 minutes'
      ELSE clock_timestamp()+LEAST(interval '60 seconds',interval '1 second'*power(2,GREATEST(w.attempts-1,0))) END
  WHERE w.tournament_id=p_tournament_id AND w.component=p_component AND w.group_key=p_group_key
    AND w.fencing_token=p_fencing_token;
END; $$;
REVOKE ALL ON FUNCTION public.fail_public_spectator_projection_v2(uuid,text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_public_spectator_projection_v2(uuid,text,text,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_public_tournament_viewer_snapshot_v2(
  p_tournament_id uuid,
  p_table_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_sections text[] DEFAULT ARRAY['tables','ranking','payout']::text[],
  p_known_revisions jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_sections jsonb := '{}'::jsonb; v_component text; v_pub record; v_now timestamptz:=clock_timestamp(); v_oldest timestamptz; v_source_changed timestamptz; v_source_vector jsonb; v_payload jsonb; v_unchanged boolean; BEGIN
  IF p_tournament_id IS NULL OR p_table_ids IS NULL OR p_sections IS NULL OR cardinality(p_table_ids)>16 OR EXISTS(SELECT 1 FROM unnest(p_sections) s WHERE s NOT IN ('tables','ranking','payout')) THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok',true,'access','revoked','tournamentId',p_tournament_id,'sections','{}'::jsonb);
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_table_ids) x(id) LEFT JOIN public.tournament_tables tt ON tt.id=x.id AND tt.tournament_id=p_tournament_id WHERE tt.id IS NULL) THEN RAISE EXCEPTION 'table_out_of_scope'; END IF;
  FOREACH v_component IN ARRAY p_sections LOOP
    SELECT p.* INTO v_pub FROM spectator_projection_v2.publications p WHERE p.tournament_id=p_tournament_id AND p.component=v_component;
    SELECT min(w.oldest_pending_at) INTO v_oldest FROM spectator_projection_v2.work_groups w WHERE w.tournament_id=p_tournament_id AND w.component=v_component;
    SELECT COALESCE(jsonb_object_agg(m.entity_key,m.source_revision::text),'{}'::jsonb),max(m.source_changed_at)
      INTO v_source_vector,v_source_changed FROM spectator_projection_v2.entity_markers m WHERE m.tournament_id=p_tournament_id AND m.component=v_component;
    v_payload:=COALESCE(v_pub.payload,'{}'::jsonb);
    -- A payout source change invalidates cached confirmation immediately. The
    -- worker may still be catching up, but stale names must not remain official.
    IF v_component='payout' AND v_source_vector IS DISTINCT FROM COALESCE(v_pub.source_vector,'{}'::jsonb) THEN
      v_payload:=jsonb_set(v_payload,'{items}',COALESCE((SELECT jsonb_agg(
        i || jsonb_build_object('playerName',NULL,'avatarUrl',NULL,'resultStatus','open'))
        FROM jsonb_array_elements(COALESCE(v_payload->'items','[]'::jsonb)) i),'[]'::jsonb));
    END IF;
    v_unchanged:=COALESCE(p_known_revisions->>v_component,'')=COALESCE(v_pub.publication_revision::text,'0')
      AND v_source_vector=COALESCE(v_pub.source_vector,'{}'::jsonb);
    IF v_unchanged THEN
      v_payload:='{}'::jsonb;
    ELSIF v_component='tables' THEN
      v_payload:=jsonb_set(v_payload,'{catalog}',COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'tableId',i->>'tableId','name',i->>'name','playerCount',jsonb_array_length(COALESCE(i->'players','[]'::jsonb)),
        'searchPlayers',COALESCE((SELECT jsonb_agg(player->>'name') FROM jsonb_array_elements(COALESCE(i->'players','[]'::jsonb)) player),'[]'::jsonb)))
        FROM jsonb_array_elements(COALESCE(v_payload->'items','[]'::jsonb)) i),'[]'::jsonb));
      v_payload:=jsonb_set(v_payload,'{items}',COALESCE((SELECT jsonb_agg(i) FROM jsonb_array_elements(COALESCE(v_payload->'items','[]'::jsonb)) i WHERE (i->>'tableId')::uuid=ANY(p_table_ids)),'[]'::jsonb));
    END IF;
    v_sections:=v_sections||jsonb_build_object(v_component,v_payload||jsonb_build_object(
      'revision',COALESCE(v_pub.publication_revision::text,'0'),
      'unchanged',v_unchanged,
      'freshness',jsonb_build_object('sourceRevision',v_source_vector::text,'projectedSourceRevision',COALESCE(v_pub.source_vector,'{}'::jsonb)::text,
        'sourceChangedAt',v_source_changed,'publishedAt',v_pub.published_at,'serverCheckedAt',v_now,'oldestPendingAt',v_oldest,
        'state',CASE WHEN v_source_vector=COALESCE(v_pub.source_vector,'{}'::jsonb) AND v_oldest IS NULL THEN 'current' WHEN v_oldest IS NOT NULL AND v_now-v_oldest>interval '10 seconds' THEN 'stale' ELSE 'updating' END)));
  END LOOP;
  RETURN jsonb_build_object('ok',true,'access','public','tournamentId',p_tournament_id,'sections',v_sections);
END; $$;
REVOKE ALL ON FUNCTION public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_viewer_snapshot_v2(uuid,uuid[],text[],jsonb) TO anon, authenticated, service_role;

-- Public history seam. Hole cards deliberately fail closed until a separate
-- audit proves every writer's reveal authorization. Public settlement remains
-- available through its existing verified, source-revision-bound RPC.
CREATE OR REPLACE FUNCTION public.get_public_tournament_hand_v2(p_tournament_id uuid,p_hand_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT COALESCE((SELECT jsonb_build_object('id',h.id,'tournamentId',h.tournament_id,'tableId',h.tournament_table_id,
  'tableSessionId',h.table_session_id,'handNumber',h.hand_number,'buttonSeat',h.button_seat,'status',h.status,
  'board',COALESCE(h.community_cards,'[]'::jsonb),'pot',h.pot_size,'holeCardsPolicy','hidden',
  'players',COALESCE((SELECT jsonb_agg(jsonb_build_object('playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
    'name',COALESCE(NULLIF(hp.player_name,''),'Người chơi'),'avatarUrl',hp.avatar_url,
    'startingStack',hp.starting_stack,'endingStack',hp.ending_stack,'eliminated',hp.is_eliminated,'holeCards','[]'::jsonb) ORDER BY hp.seat_number)
    FROM public.hand_players hp WHERE hp.hand_id=h.id),'[]'::jsonb),
  'actions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ha.id,'playerId',ha.player_id,'entryNumber',ha.entry_number,
    'street',ha.street,'actionType',ha.action_type,'amount',ha.action_amount,'order',ha.action_order) ORDER BY ha.action_order)
    FROM public.hand_actions ha WHERE ha.hand_id=h.id),'[]'::jsonb))
  FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
  WHERE h.id=p_hand_id AND h.tournament_id=p_tournament_id AND t.deleted_at IS NULL AND NOT COALESCE(h.is_voided,false)),'{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_hand_v2(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_hand_v2(uuid,uuid) TO anon, authenticated, service_role;

-- Sanitized history catalog used to discover completed hands without directly
-- selecting community cards or identity rows from business tables.
CREATE OR REPLACE FUNCTION public.get_public_tournament_hand_catalog_v2(
  p_tournament_id uuid,p_tournament_table_id uuid DEFAULT NULL,p_limit integer DEFAULT 11
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_limit<1 OR p_limit>101 THEN jsonb_build_object('error','invalid_request')
  WHEN NOT EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL)
    THEN jsonb_build_object('access','revoked','items','[]'::jsonb)
  WHEN p_tournament_table_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.tournament_tables tt WHERE tt.id=p_tournament_table_id AND tt.tournament_id=p_tournament_id)
    THEN jsonb_build_object('error','table_out_of_scope')
  ELSE jsonb_build_object('access','public','items',COALESCE((
    SELECT jsonb_agg(item ORDER BY item_created_at DESC) FROM (
      SELECT h.created_at AS item_created_at,jsonb_build_object(
        'id',h.id,'handNumber',h.hand_number,'createdAt',h.created_at,
        'board',COALESCE(h.community_cards,'[]'::jsonb),'pot',h.pot_size,
        'buttonSeat',h.button_seat,'tableId',h.tournament_table_id,'status',h.status,'isVoided',false) AS item
      FROM public.tournament_hands h
      WHERE h.tournament_id=p_tournament_id AND NOT COALESCE(h.is_voided,false)
        AND h.status<>'in_progress'
        AND (p_tournament_table_id IS NULL OR h.tournament_table_id=p_tournament_table_id)
      ORDER BY h.created_at DESC LIMIT p_limit
    ) catalog_rows),'[]'::jsonb))
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_hand_catalog_v2(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_hand_catalog_v2(uuid,uuid,integer) TO anon, authenticated, service_role;

-- One bounded dispatcher. A dedicated Vault secret is required; absence is a
-- fail-closed no-op, so applying schema alone cannot start the worker.
CREATE OR REPLACE FUNCTION public.dispatch_public_spectator_projection_v2() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_url text; v_secret text; v_request_id bigint; BEGIN
  IF NOT EXISTS(SELECT 1 FROM spectator_projection_v2.work_groups w WHERE w.available_at<=clock_timestamp() AND (w.claimed_until IS NULL OR w.claimed_until<clock_timestamp())) THEN RETURN NULL; END IF;
  v_url:=COALESCE(NULLIF(current_setting('app.supabase_url',true),''),'https://orlesggcjamwuknxwcpk.supabase.co');
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='PUBLIC_SPECTATOR_WORKER_SECRET';
  IF v_secret IS NULL OR btrim(v_secret)='' THEN RAISE LOG 'spectator v2 dispatcher skipped: secret missing'; RETURN NULL; END IF;
  SELECT net.http_post(url:=v_url||'/functions/v1/public-spectator-projector-v2',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=8000) INTO v_request_id;
  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN RAISE LOG 'spectator v2 dispatcher failed: %',SQLERRM; RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.dispatch_public_spectator_projection_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_public_spectator_projection_v2() TO service_role;

-- Activation is deliberately outside this source-only migration. After the
-- Edge function, dedicated Vault secret and release gate are verified, the
-- owner-gated runbook schedules exactly one job named
-- public-spectator-v2-dispatch at one-second cadence. Until then no worker or
-- publication loop starts merely because the schema exists.
