-- Per-tournament presentation only. No chip, hand, seating or payout writes.
-- Requires public spectator v2 live-display migration and existing hand blind snapshots.
-- ROLLBACK: roll back frontend and worker; retain appearance rows and additive read fields.
-- This migration does not enable flags, Cron, or broaden hole-card visibility.
BEGIN;
DO $preflight$ BEGIN
  IF to_regprocedure('public.get_public_spectator_projection_source_v2(uuid,text,uuid)') IS NULL
    OR (SELECT count(*) FROM pg_attribute WHERE attrelid='public.tournament_hands'::regclass AND attname IN ('tracker_small_blind','tracker_big_blind','tracker_level_number','tracker_bba') AND attnum>0 AND NOT attisdropped) <> 4
  THEN RAISE EXCEPTION 'Apply spectator v2 live display and hand blind snapshots first'; END IF;
END; $preflight$;
CREATE TABLE IF NOT EXISTS public.tournament_table_appearance (
  tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  felt_color text NOT NULL DEFAULT '#143d32' CHECK (felt_color ~ '^#[0-9a-fA-F]{6}$'),
  rail_color text NOT NULL DEFAULT '#a68b4c' CHECK (rail_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text CHECK (logo_url IS NULL OR (length(logo_url) <= 1024 AND logo_url ~ '^https://orlesggcjamwuknxwcpk[.]supabase[.]co/storage/v1/object/public/backing-proofs/[0-9a-f-]+/table-logo/[0-9a-f-]+/[0-9a-f-]+[.](png|jpg|webp)$'))
);
ALTER TABLE public.tournament_table_appearance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_table_appearance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_table_appearance TO anon, authenticated;
GRANT INSERT, UPDATE ON public.tournament_table_appearance TO authenticated;
GRANT ALL ON public.tournament_table_appearance TO service_role;
DROP POLICY IF EXISTS table_appearance_public_read ON public.tournament_table_appearance;
CREATE POLICY table_appearance_public_read ON public.tournament_table_appearance FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id=tournament_id AND t.deleted_at IS NULL));
DROP POLICY IF EXISTS table_appearance_owner_insert ON public.tournament_table_appearance;
CREATE POLICY table_appearance_owner_insert ON public.tournament_table_appearance FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id=tournament_id AND t.deleted_at IS NULL AND public.is_club_owner(auth.uid(),t.club_id)));
DROP POLICY IF EXISTS table_appearance_owner_update ON public.tournament_table_appearance;
CREATE POLICY table_appearance_owner_update ON public.tournament_table_appearance FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id=tournament_id AND t.deleted_at IS NULL AND public.is_club_owner(auth.uid(),t.club_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id=tournament_id AND t.deleted_at IS NULL AND public.is_club_owner(auth.uid(),t.club_id)));

-- An idle table uses the tournament's current level. Mark the table projection
-- when that level changes; hand-in-progress blinds remain frozen on the hand.
DROP TRIGGER IF EXISTS spectator_v2_tournament_tables_level_dirty ON public.tournaments;
CREATE TRIGGER spectator_v2_tournament_tables_level_dirty
  AFTER UPDATE OF current_level, current_level_id ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('tables');
DROP TRIGGER IF EXISTS spectator_v2_levels_tables_dirty ON public.tournament_levels;
CREATE TRIGGER spectator_v2_levels_tables_dirty
  AFTER INSERT OR UPDATE OR DELETE ON public.tournament_levels
  FOR EACH ROW EXECUTE FUNCTION spectator_projection_v2.mark_row_dirty('tables');

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
        'smallBlind',CASE WHEN h.id IS NULL THEN current_level.small_blind ELSE h.tracker_small_blind END,
        'bigBlind',CASE WHEN h.id IS NULL THEN current_level.big_blind ELSE h.tracker_big_blind END,
        'levelNumber',CASE WHEN h.id IS NULL THEN current_level.level_number ELSE h.tracker_level_number END,
        'ante',CASE WHEN h.id IS NULL THEN current_level.ante ELSE h.tracker_bba END,
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
      JOIN public.tournaments tour ON tour.id=tt.tournament_id
      LEFT JOIN LATERAL (
        SELECT lv.small_blind,lv.big_blind,lv.ante,lv.level_number
        FROM public.tournament_levels lv
        WHERE lv.tournament_id=tour.id AND ((tour.current_level_id IS NOT NULL AND lv.id=tour.current_level_id)
          OR (tour.current_level_id IS NULL AND lv.level_number=tour.current_level))
        ORDER BY lv.id LIMIT 1
      ) current_level ON true
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
  'levelNumber',h.tracker_level_number,'ante',h.tracker_bba,
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


SELECT spectator_projection_v2.mark_dirty(t.id,'tables','set','table_appearance_read') FROM public.tournaments t WHERE t.deleted_at IS NULL;
COMMIT;
