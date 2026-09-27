-- Read-only display extension for one physical table's completed-hand history.
-- ROLLBACK: restore the prior definition from
-- migration-archive/remote-history/recovered-source/20260924070939_public_spectator_last_hand_history.sql.
-- No business hand, chip, or settlement row is written by this function.
-- hand_players.hole_cards is the existing stored-only-public contract: Tracker
-- writes cards only after the player tables them for the dealer to record. The
-- function does not derive cards from private settlement evidence.
CREATE OR REPLACE FUNCTION public.get_public_tournament_table_history_v2(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_limit integer DEFAULT 20,
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
WITH scope AS (
  SELECT tt.id
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND t.deleted_at IS NULL
), rows AS (
  SELECT h.id, h.table_session_id, h.hand_number, h.created_at,
    h.community_cards, h.pot_size, h.button_seat, h.source_revision,
    h.tracker_small_blind, h.tracker_big_blind,
    h.tracker_level_number, h.tracker_bba
  FROM public.tournament_hands h
  JOIN scope s ON s.id = h.tournament_table_id
  WHERE h.tournament_id = p_tournament_id
    AND h.status <> 'in_progress'
    AND NOT COALESCE(h.is_voided, false)
    AND (
      p_before_created_at IS NULL
      OR (h.created_at, h.id) < (p_before_created_at, p_before_id)
    )
  ORDER BY h.created_at DESC, h.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50) + 1
), page AS (
  SELECT * FROM rows ORDER BY created_at DESC, id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 50)
), tail AS (
  SELECT created_at, id FROM rows ORDER BY created_at DESC, id DESC
  OFFSET LEAST(GREATEST(p_limit, 1), 50) LIMIT 1
), page_results AS (
  SELECT p.*, outcome.public_outcome,
    CASE WHEN outcome.public_outcome IS NOT NULL AND recipient.items IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(outcome.public_outcome->'pots') checked_pot
        JOIN LATERAL jsonb_array_elements(checked_pot.value->'allocations') checked_allocation ON true
        WHERE (checked_allocation.value->>'amount')::bigint > 0
          AND (SELECT count(*) FROM public.hand_players checked_player
            WHERE checked_player.hand_id = p.id
              AND checked_player.player_id::text = checked_allocation.value->>'winnerId') <> 1
      )
      THEN jsonb_build_object('status', 'verified', 'recipients', recipient.items)
      ELSE jsonb_build_object('status', 'pending') END AS result
  FROM page p
  LEFT JOIN LATERAL (
    SELECT o.public_outcome
    FROM public.tournament_settlement_outcomes o
    WHERE o.hand_id = p.id
      AND o.status = 'verified'
      AND o.source_revision = p.source_revision
    ORDER BY o.settlement_revision DESC
    LIMIT 1
  ) outcome ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'playerId', hp.player_id, 'entryNumber', hp.entry_number,
      'seatNumber', hp.seat_number,
      'name', COALESCE(NULLIF(hp.player_name, ''), 'Người chơi'),
      'avatarUrl', hp.avatar_url,
      'holeCards', COALESCE(hp.hole_cards, '[]'::jsonb),
      'potAward', (player.value->>'potAward')::bigint,
      'netDelta', (player.value->>'netDelta')::bigint,
      'potKinds', (
        SELECT COALESCE(jsonb_agg(DISTINCT pot.value->>'kind'), '[]'::jsonb)
        FROM jsonb_array_elements(outcome.public_outcome->'pots') pot
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(pot.value->'allocations') allocation
          WHERE allocation.value->>'winnerId' = hp.player_id::text
            AND (allocation.value->>'amount')::bigint > 0
        )
      )
    ) ORDER BY hp.seat_number, hp.player_id) AS items
    FROM jsonb_array_elements(outcome.public_outcome->'players') player
    JOIN public.hand_players hp ON hp.hand_id = p.id
      AND hp.player_id::text = player.value->>'playerId'
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(outcome.public_outcome->'pots') pot
      JOIN LATERAL jsonb_array_elements(pot.value->'allocations') allocation ON true
        WHERE allocation.value->>'winnerId' = hp.player_id::text
          AND (allocation.value->>'amount')::bigint > 0
    )
  ) recipient ON true
)
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_tournament_table_id IS NULL
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50
    OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL))
    THEN jsonb_build_object('error', 'invalid_request')
  WHEN NOT EXISTS (SELECT 1 FROM public.tournaments t
    WHERE t.id = p_tournament_id AND t.deleted_at IS NULL)
    THEN jsonb_build_object('access', 'revoked', 'items', '[]'::jsonb)
  WHEN NOT EXISTS (SELECT 1 FROM scope)
    THEN jsonb_build_object('error', 'table_out_of_scope')
  ELSE jsonb_build_object(
    'access', 'public',
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'handId', p.id, 'tableSessionId', p.table_session_id,
      'handNumber', p.hand_number, 'createdAt', p.created_at,
      'board', COALESCE(p.community_cards, '[]'::jsonb), 'pot', p.pot_size,
      'buttonSeat', p.button_seat, 'smallBlind', p.tracker_small_blind,
      'bigBlind', p.tracker_big_blind, 'levelNumber', p.tracker_level_number,
      'ante', p.tracker_bba, 'result', p.result
    ) ORDER BY p.created_at DESC, p.id DESC) FROM page_results p), '[]'::jsonb),
    'nextCursor', CASE WHEN EXISTS (SELECT 1 FROM tail) THEN (
      SELECT jsonb_build_object('createdAt', p.created_at, 'id', p.id)
      FROM page p ORDER BY p.created_at ASC, p.id ASC LIMIT 1
    ) ELSE NULL END
  )
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_table_history_v2(uuid,uuid,integer,timestamptz,uuid)
  TO anon, authenticated, service_role;
