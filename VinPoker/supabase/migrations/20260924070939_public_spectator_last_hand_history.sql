-- Public Viewer: current-session last hand + per-physical-table history.
--
-- This is read/projection-only. Business hands, stacks, cards, settlement and
-- table-session ownership remain canonical in public.*. No client or worker
-- writes chips, selects a winner, or derives a pot in this migration.
--
-- Rollback: disable the new frontend flag and use a forward replacement of the
-- functions below. Do not delete historical hands or projection publications.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.get_public_spectator_projection_source_v2(uuid,text,uuid)') IS NULL
    OR to_regprocedure('public.get_public_tournament_hand_v2(uuid,uuid)') IS NULL
    OR to_regclass('public.table_sessions') IS NULL
  THEN
    RAISE EXCEPTION 'Apply public spectator v2 and Floor table sessions first';
  END IF;
END;
$preflight$;

-- A single read selects a hand only from the table's *current* session. It is
-- deliberately separate from table history: a null or closed current session
-- can never inherit a hand from an earlier session on the same physical table.
CREATE OR REPLACE FUNCTION public.get_public_tournament_table_live_or_last_hand_v2(
  p_tournament_id uuid,
  p_tournament_table_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
WITH scope AS (
  SELECT tt.id AS table_id, tt.table_session_id, ts.closed_at
  FROM public.tournament_tables tt
  JOIN public.tournaments t ON t.id = tt.tournament_id
  LEFT JOIN public.table_sessions ts ON ts.id = tt.table_session_id
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
    AND t.deleted_at IS NULL
), picked AS (
  SELECT s.table_id, s.table_session_id, s.closed_at, h.id AS hand_id, h.display_state
  FROM scope s
  LEFT JOIN LATERAL (
    SELECT candidate.id, candidate.display_state
    FROM (
      SELECT th.id, th.created_at, 'live'::text AS display_state, 0 AS priority
      FROM public.tournament_hands th
      WHERE th.tournament_id = p_tournament_id
        AND th.tournament_table_id = s.table_id
        AND th.table_session_id = s.table_session_id
        AND th.status = 'in_progress'
        AND NOT COALESCE(th.is_voided, false)
      UNION ALL
      SELECT th.id, th.created_at, 'last_completed'::text AS display_state, 1 AS priority
      FROM public.tournament_hands th
      WHERE th.tournament_id = p_tournament_id
        AND th.tournament_table_id = s.table_id
        AND th.table_session_id = s.table_session_id
        AND th.status <> 'in_progress'
        AND NOT COALESCE(th.is_voided, false)
    ) candidate
    ORDER BY candidate.priority, candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) h ON s.table_session_id IS NOT NULL AND s.closed_at IS NULL
)
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_tournament_table_id IS NULL
    THEN jsonb_build_object('error', 'invalid_request')
  WHEN NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL)
    THEN jsonb_build_object('access', 'revoked')
  WHEN NOT EXISTS (SELECT 1 FROM scope)
    THEN jsonb_build_object('error', 'table_out_of_scope')
  ELSE COALESCE((
    SELECT jsonb_build_object(
      'access', 'public',
      'tableId', p.table_id,
      'tableSessionId', p.table_session_id,
      'state', CASE
        WHEN p.table_session_id IS NULL THEN 'inactive'
        WHEN p.closed_at IS NOT NULL THEN 'closed'
        WHEN p.hand_id IS NULL THEN 'waiting'
        ELSE p.display_state
      END,
      'hand', CASE WHEN p.hand_id IS NULL THEN NULL
        ELSE (
          SELECT public.get_public_tournament_hand_v2(p_tournament_id, h.id)
            || jsonb_build_object(
              'smallBlind', h.tracker_small_blind,
              'bigBlind', h.tracker_big_blind,
              'levelNumber', h.tracker_level_number,
              'ante', h.tracker_bba
            )
          FROM public.tournament_hands h WHERE h.id = p.hand_id
        )
      END
    )
    FROM picked p
  ), jsonb_build_object('error', 'table_out_of_scope'))
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_table_live_or_last_hand_v2(uuid,uuid)
  TO anon, authenticated, service_role;

-- History is scoped to one canonical tournament table, not a display name or a
-- seat number. It may cross its sessions in this tournament; legacy rows with a
-- missing session remain explicitly null and are never treated as current.
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
    h.community_cards, h.pot_size, h.button_seat,
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
  SELECT * FROM rows ORDER BY created_at DESC, id DESC LIMIT LEAST(GREATEST(p_limit, 1), 50)
), tail AS (
  SELECT created_at, id FROM rows ORDER BY created_at DESC, id DESC OFFSET LEAST(GREATEST(p_limit, 1), 50) LIMIT 1
)
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_tournament_table_id IS NULL
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 50
    OR ((p_before_created_at IS NULL) <> (p_before_id IS NULL))
    THEN jsonb_build_object('error', 'invalid_request')
  WHEN NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL)
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
      'ante', p.tracker_bba
    ) ORDER BY p.created_at DESC, p.id DESC) FROM page p), '[]'::jsonb),
    -- The cursor is the last *returned* row.  Using the look-ahead row here
    -- would skip it because the next page uses a strict tuple comparison.
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

-- Exact replay from table history remains server-scoped. The client may not turn
-- a hand UUID into a replay for an unrelated physical table.
CREATE OR REPLACE FUNCTION public.get_public_tournament_table_hand_v2(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_hand_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
SELECT CASE
  WHEN p_tournament_id IS NULL OR p_tournament_table_id IS NULL OR p_hand_id IS NULL
    THEN jsonb_build_object('error', 'invalid_request')
  WHEN NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL)
    THEN jsonb_build_object('access', 'revoked')
  WHEN NOT EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    JOIN public.tournament_tables tt ON tt.id = h.tournament_table_id
    WHERE h.id = p_hand_id
      AND h.tournament_id = p_tournament_id
      AND h.tournament_table_id = p_tournament_table_id
      AND tt.tournament_id = p_tournament_id
      AND h.status <> 'in_progress'
      AND NOT COALESCE(h.is_voided, false)
  ) THEN jsonb_build_object('error', 'hand_out_of_scope')
  ELSE public.get_public_tournament_hand_v2(p_tournament_id, p_hand_id)
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_tournament_table_hand_v2(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_table_hand_v2(uuid,uuid,uuid)
  TO anon, authenticated, service_role;

-- The worker continues to own publication. This replacement only changes the
-- tables payload: LIVE wins; otherwise use the newest completed, non-voided hand
-- in the same active session. Ranking and payout keep their established source.
CREATE OR REPLACE FUNCTION public.get_public_spectator_projection_source_v2(
  p_tournament_id uuid, p_component text, p_fencing_token uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload jsonb;
  v_vector jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM spectator_projection_v2.work_groups w
    WHERE w.tournament_id = p_tournament_id
      AND w.component = p_component
      AND w.fencing_token = p_fencing_token
      AND w.claimed_until > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'lease_expired';
  END IF;

  SELECT COALESCE(jsonb_object_agg(m.entity_key, m.source_revision::text), '{}'::jsonb)
    INTO v_vector
  FROM spectator_projection_v2.entity_markers m
  WHERE m.tournament_id = p_tournament_id AND m.component = p_component;

  IF p_component = 'tables' THEN
    SELECT jsonb_build_object(
      'items', COALESCE(jsonb_agg(x ORDER BY x->>'name'), '[]'::jsonb),
      'removed', '[]'::jsonb
    ) INTO v_payload
    FROM (
      SELECT jsonb_build_object(
        'tableId', tt.id,
        'tableSessionId', tt.table_session_id,
        'name', tt.table_name,
        'handId', h.id,
        'handNumber', h.hand_number,
        'buttonSeat', h.button_seat,
        'street', CASE WHEN h.id IS NULL THEN NULL ELSE CASE jsonb_array_length(COALESCE(h.community_cards, '[]'::jsonb))
          WHEN 0 THEN 'preflop' WHEN 3 THEN 'flop' WHEN 4 THEN 'turn' ELSE 'river' END END,
        'board', CASE WHEN h.id IS NULL THEN NULL ELSE COALESCE(h.community_cards, '[]'::jsonb) END,
        'pot', CASE WHEN h.id IS NULL THEN NULL ELSE h.pot_size END,
        'actions', CASE WHEN h.id IS NULL THEN NULL ELSE COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'playerId', a.player_id, 'entryNumber', a.entry_number, 'street', a.street,
            'actionType', a.action_type, 'amount', a.action_amount, 'order', a.action_order
          ) ORDER BY a.action_order)
          FROM public.hand_actions a WHERE a.hand_id = h.id
        ), '[]'::jsonb) END,
        'smallBlind', CASE WHEN h.id IS NULL THEN current_level.small_blind ELSE h.tracker_small_blind END,
        'bigBlind', CASE WHEN h.id IS NULL THEN current_level.big_blind ELSE h.tracker_big_blind END,
        'levelNumber', CASE WHEN h.id IS NULL THEN current_level.level_number ELSE h.tracker_level_number END,
        'ante', CASE WHEN h.id IS NULL THEN current_level.ante ELSE h.tracker_bba END,
        'trackerState', CASE
          WHEN tt.table_session_id IS NULL THEN 'inactive'
          WHEN session_row.closed_at IS NOT NULL THEN 'closed'
          WHEN h.id IS NULL THEN 'waiting'
          ELSE h.display_state
        END,
        'latestAction', CASE WHEN h.id IS NULL THEN NULL ELSE (
          SELECT jsonb_build_object(
            'playerId', a.player_id, 'entryNumber', a.entry_number,
            'actionType', a.action_type, 'amount', a.action_amount
          ) FROM public.hand_actions a WHERE a.hand_id = h.id ORDER BY a.action_order DESC LIMIT 1
        ) END,
        'players', CASE WHEN h.id IS NOT NULL THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'entryId', e.id, 'playerId', hp.player_id, 'entryNumber', hp.entry_number,
            'seatNumber', hp.seat_number, 'name', COALESCE(NULLIF(hp.player_name, ''), 'Người chơi'),
            'avatarUrl', hp.avatar_url, 'startingStack', hp.starting_stack,
            'stack', CASE WHEN h.display_state = 'last_completed' THEN hp.ending_stack ELSE NULL END,
            'holeCards', COALESCE(hp.hole_cards, '[]'::jsonb),
            'isFolded', EXISTS (SELECT 1 FROM public.hand_actions a WHERE a.hand_id = h.id AND a.player_id = hp.player_id AND a.action_type = 'fold'),
            'isAllIn', EXISTS (SELECT 1 FROM public.hand_actions a WHERE a.hand_id = h.id AND a.player_id = hp.player_id AND a.action_type = 'all_in')
          ) ORDER BY hp.seat_number)
          FROM public.hand_players hp
          LEFT JOIN public.tournament_entries e ON e.tournament_id = p_tournament_id
            AND e.player_id = hp.player_id AND e.entry_no = hp.entry_number
          WHERE hp.hand_id = h.id
        ), '[]'::jsonb) ELSE '[]'::jsonb END
      ) AS x
      FROM public.tournament_tables tt
      JOIN public.tournaments tour ON tour.id = tt.tournament_id
      LEFT JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
      LEFT JOIN LATERAL (
        SELECT lv.small_blind, lv.big_blind, lv.ante, lv.level_number
        FROM public.tournament_levels lv
        WHERE lv.tournament_id = tour.id
          AND ((tour.current_level_id IS NOT NULL AND lv.id = tour.current_level_id)
            OR (tour.current_level_id IS NULL AND lv.level_number = tour.current_level))
        ORDER BY lv.id LIMIT 1
      ) current_level ON true
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM (
          SELECT th.*, 'live'::text AS display_state, 0 AS priority
          FROM public.tournament_hands th
          WHERE th.tournament_id = p_tournament_id
            AND th.tournament_table_id = tt.id
            AND th.table_session_id = tt.table_session_id
            AND th.status = 'in_progress'
            AND NOT COALESCE(th.is_voided, false)
          UNION ALL
          SELECT th.*, 'last_completed'::text AS display_state, 1 AS priority
          FROM public.tournament_hands th
          WHERE th.tournament_id = p_tournament_id
            AND th.tournament_table_id = tt.id
            AND th.table_session_id = tt.table_session_id
            AND th.status <> 'in_progress'
            AND NOT COALESCE(th.is_voided, false)
        ) candidate
        ORDER BY candidate.priority, candidate.created_at DESC, candidate.id DESC
        LIMIT 1
      ) h ON tt.table_session_id IS NOT NULL AND session_row.closed_at IS NULL
      WHERE tt.tournament_id = p_tournament_id
    ) table_rows;
  ELSIF p_component = 'ranking' THEN
    SELECT jsonb_build_object(
      'bigBlind', (SELECT l.big_blind FROM public.tournaments t
        LEFT JOIN public.tournament_levels l ON l.tournament_id = t.id
          AND ((t.current_level_id IS NOT NULL AND l.id = t.current_level_id)
            OR (t.current_level_id IS NULL AND l.level_number = t.current_level))
        WHERE t.id = p_tournament_id LIMIT 1),
      'items', COALESCE(jsonb_agg(x ORDER BY (x->>'chips')::numeric DESC NULLS LAST), '[]'::jsonb)
    ) INTO v_payload
    FROM (
      SELECT jsonb_build_object(
        'entryId', e.id, 'playerId', c.player_id, 'entryNumber', c.entry_number,
        'name', COALESCE(NULLIF(s.player_name, ''), 'Người chơi'), 'avatarUrl', s.avatar_url,
        'chips', c.chip_count, 'updatedAt', c.updated_at
      ) x
      FROM public.tournament_chip_counts c
      LEFT JOIN public.tournament_entries e ON e.tournament_id = c.tournament_id
        AND e.player_id = c.player_id AND e.entry_no = c.entry_number
      LEFT JOIN LATERAL (
        SELECT seat.player_name, seat.avatar_url FROM public.tournament_seats seat
        WHERE seat.tournament_id = c.tournament_id
          AND ((e.id IS NOT NULL AND seat.entry_id = e.id)
            OR (e.id IS NULL AND seat.player_id = c.player_id AND seat.entry_number = c.entry_number))
        ORDER BY seat.is_active DESC, seat.created_at DESC LIMIT 1
      ) s ON true
      WHERE c.tournament_id = p_tournament_id AND c.chip_count > 0
    ) ranking_rows;
  ELSIF p_component = 'payout' THEN
    SELECT jsonb_build_object(
      'published', COUNT(*) > 0,
      'items', COALESCE(jsonb_agg(x ORDER BY (x->>'fromPlace')::int), '[]'::jsonb)
    ) INTO v_payload
    FROM (
      SELECT jsonb_build_object(
        'fromPlace', p.position, 'toPlace', p.position, 'amountPerPlayer', p.amount,
        'playerName', CASE WHEN e.finished_place = p.position THEN COALESCE(NULLIF(s.player_name, ''), NULL) ELSE NULL END,
        'avatarUrl', CASE WHEN e.finished_place = p.position THEN s.avatar_url ELSE NULL END,
        'resultStatus', CASE WHEN e.finished_place = p.position THEN 'official' ELSE 'open' END
      ) x
      FROM public.tournament_prizes p
      LEFT JOIN LATERAL (
        SELECT candidate.tournament_id, (array_agg(candidate.player_id))[1] AS player_id,
          (array_agg(candidate.entry_no))[1] AS entry_no, candidate.finished_place
        FROM public.tournament_entries candidate
        WHERE candidate.tournament_id = p.tournament_id AND candidate.finished_place = p.position
        GROUP BY candidate.tournament_id, candidate.finished_place
        HAVING count(*) = 1
      ) e ON true
      LEFT JOIN LATERAL (
        SELECT seat.player_name, seat.avatar_url FROM public.tournament_seats seat
        WHERE seat.tournament_id = e.tournament_id
          AND seat.player_id = e.player_id AND seat.entry_number = e.entry_no
        ORDER BY seat.is_active DESC, seat.created_at DESC LIMIT 1
      ) s ON true
      WHERE p.tournament_id = p_tournament_id
    ) payout_rows;
  ELSE
    v_payload := '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'tournamentId', p_tournament_id,
    'component', p_component,
    'sourceVector', v_vector,
    'payload', COALESCE(v_payload, '{}'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_spectator_projection_source_v2(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_spectator_projection_source_v2(uuid,text,uuid) TO service_role;

-- Recompute only the read projection after a reviewed apply. This does not
-- touch hand, chip, roster or payout business data.
SELECT spectator_projection_v2.mark_dirty(t.id, 'tables', 'set', 'last_hand_history')
FROM public.tournaments t
WHERE t.deleted_at IS NULL;

COMMIT;
