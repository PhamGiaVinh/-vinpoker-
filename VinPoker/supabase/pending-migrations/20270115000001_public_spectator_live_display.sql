-- Read-only spectator corrections. No business rows are updated.
-- ROLLBACK: stop spectator dispatcher/worker and disable spectator frontend;
-- retain additive read fields rather than restoring stale chip display.
BEGIN;
CREATE OR REPLACE FUNCTION spectator_projection_v2.read_contract_version()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS 'SELECT 2';
REVOKE ALL ON FUNCTION spectator_projection_v2.read_contract_version() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.claim_public_spectator_projection_v2(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  WITH due AS (
    SELECT w.tournament_id, w.component, w.group_key
    FROM spectator_projection_v2.work_groups w
    WHERE w.available_at <= clock_timestamp()
      AND (w.claimed_until IS NULL OR w.claimed_until < clock_timestamp())
    AND NOT EXISTS (SELECT 1 FROM spectator_projection_v2.work_groups busy
        WHERE busy.tournament_id=w.tournament_id AND busy.component=w.component
          AND busy.claimed_until >= clock_timestamp())
      AND w.group_key=(SELECT first_job.group_key FROM spectator_projection_v2.work_groups first_job
        WHERE first_job.tournament_id=w.tournament_id AND first_job.component=w.component
          AND first_job.available_at<=clock_timestamp()
        ORDER BY first_job.available_at,first_job.group_key LIMIT 1)
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
        'actions',CASE WHEN h.id IS NULL THEN NULL ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('playerId',ha.player_id,'entryNumber',ha.entry_number,'street',ha.street,'actionType',ha.action_type,'amount',ha.action_amount,'order',ha.action_order) ORDER BY ha.action_order) FROM public.hand_actions ha WHERE ha.hand_id=h.id),'[]'::jsonb) END,
        'smallBlind',h.tracker_small_blind,'bigBlind',h.tracker_big_blind,
        'trackerState',CASE WHEN h.id IS NULL THEN 'unavailable' ELSE 'live' END,
        'latestAction',CASE WHEN h.id IS NULL THEN NULL ELSE (SELECT jsonb_build_object(
          'playerId',ha.player_id,'entryNumber',ha.entry_number,'actionType',ha.action_type,'amount',ha.action_amount)
          FROM public.hand_actions ha WHERE ha.hand_id=h.id ORDER BY ha.action_order DESC LIMIT 1) END,
        'players',CASE WHEN h.id IS NOT NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'entryId',e.id,'playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
          'name',COALESCE(NULLIF(hp.player_name,''),'Người chơi'),'avatarUrl',hp.avatar_url,
          'startingStack',hp.starting_stack,'stack',NULL,'holeCards',COALESCE(hp.hole_cards,'[]'::jsonb)) ORDER BY hp.seat_number)
          FROM public.hand_players hp
          LEFT JOIN public.tournament_entries e ON e.tournament_id=p_tournament_id
            AND e.player_id=hp.player_id AND e.entry_no=hp.entry_number
          LEFT JOIN public.tournament_chip_counts cc ON cc.tournament_id=p_tournament_id
            AND cc.player_id=hp.player_id AND cc.entry_number=hp.entry_number
          WHERE hp.hand_id=h.id),'[]'::jsonb)
        ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'entryId',s.entry_id,'playerId',s.player_id,'entryNumber',s.entry_number,'seatNumber',s.seat_number,
          'name',COALESCE(NULLIF(s.player_name,''),'Người chơi'),'avatarUrl',s.avatar_url,
          'stack',cc.chip_count,'holeCards','[]'::jsonb) ORDER BY s.seat_number)
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

CREATE OR REPLACE FUNCTION public.get_public_tournament_hand_v2(p_tournament_id uuid,p_hand_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
SELECT COALESCE((SELECT jsonb_build_object('id',h.id,'tournamentId',h.tournament_id,'tableId',h.tournament_table_id,
  'tableSessionId',h.table_session_id,'handNumber',h.hand_number,'buttonSeat',h.button_seat,'status',h.status,
  'bigBlind',h.tracker_big_blind,'smallBlind',h.tracker_small_blind,
  'board',COALESCE(h.community_cards,'[]'::jsonb),'pot',h.pot_size,'holeCardsPolicy','recorded',
  'players',COALESCE((SELECT jsonb_agg(jsonb_build_object('playerId',hp.player_id,'entryNumber',hp.entry_number,'seatNumber',hp.seat_number,
    'name',COALESCE(NULLIF(hp.player_name,''),'Người chơi'),'avatarUrl',hp.avatar_url,
    'startingStack',hp.starting_stack,'endingStack',hp.ending_stack,'eliminated',hp.is_eliminated,
    'holeCards',COALESCE(hp.hole_cards,'[]'::jsonb)) ORDER BY hp.seat_number)
    FROM public.hand_players hp WHERE hp.hand_id=h.id),'[]'::jsonb),
  'actions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ha.id,'playerId',ha.player_id,'entryNumber',ha.entry_number,
    'street',ha.street,'actionType',ha.action_type,'amount',ha.action_amount,'order',ha.action_order) ORDER BY ha.action_order)
    FROM public.hand_actions ha WHERE ha.hand_id=h.id),'[]'::jsonb))
  FROM public.tournament_hands h JOIN public.tournaments t ON t.id=h.tournament_id
  WHERE h.id=p_hand_id AND h.tournament_id=p_tournament_id AND t.deleted_at IS NULL AND NOT COALESCE(h.is_voided,false)),'{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_hand_v2(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_hand_v2(uuid,uuid) TO anon, authenticated, service_role;

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
        'bigBlind',h.tracker_big_blind,'id',h.id,'handNumber',h.hand_number,'createdAt',h.created_at,
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

SELECT spectator_projection_v2.mark_dirty(t.id,'tables','set','read_contract') FROM public.tournaments t WHERE t.deleted_at IS NULL;
COMMIT;
