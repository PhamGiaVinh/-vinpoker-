-- ============================================================================
-- Floor Table Ops Phase A2 — redraw_tournament RPC  (SOURCE-ONLY, NOT APPLIED)
-- ============================================================================
-- Scheduled / tournament redraw — SEPARATE from the broken-table redraw in
-- close_tournament_table. Re-seats a wider eligible set and (for consolidation
-- modes) closes the emptied tables. Per the merged spec (#233).
--
-- Modes (p_mode):
--   final_table            : all seated players → consolidate onto TC tables (default 1)
--   table_count_threshold  : all seated players → consolidate onto TC tables (default 3, configurable)
--   itm                    : all seated players (ITM survivors) → TC tables (default = enough)
--   manual_custom          : a TD-selected entry set (p_eligible_entry_ids) → reseat into the room
--   (day2_itm is DEFERRED — needs a flight/day schema that does not exist yet.)
--
-- p_dry_run = true  -> compute the plan and RETURN it as a PREVIEW (NO writes).
-- p_dry_run = false -> apply it atomically: VACATE all eligible seats, then CLAIM the
--   planned seats (two-pass avoids seat-swap unique_violation), supersede receipts,
--   issue new receipts, write seat_assignment_history (reason per mode,
--   draw_type='manual_move'), and close any emptied non-target tables.
--
-- Owner rules: never auto-runs (caller-invoked, TD confirms); atomic (any failure
-- rolls the whole redraw back); insufficient seats -> block (no auto-open); no money.
-- The tournament is locked FOR UPDATE (serialises against the other floor RPCs that
-- also lock it). The seat partial-unique index is the final race guard.
--
-- Live-constraint-correct values (verified in the A1 apply): seat status
-- 'moved'/'active'; receipt/history draw_type='manual_move'; game_tables.status
-- 'inactive'; tournament_tables.status 'closed'. Dual tournament_seats.table_id
-- convention handled via table_id IN (tt.id, tt.table_id).
--
-- ROLLBACK: DROP FUNCTION public.redraw_tournament(uuid, text, uuid[], integer, text, boolean);
-- Controlled apply only (pre-apply dry-run -> CREATE OR REPLACE -> verify -> post-apply
-- live dry-run). NO supabase db push, NO deploy_db, NO schema_migrations edit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.redraw_tournament(
  p_tournament_id      UUID,
  p_mode               TEXT,
  p_eligible_entry_ids UUID[] DEFAULT NULL,
  p_target_table_count INTEGER DEFAULT NULL,
  p_draw_mode          TEXT DEFAULT 'redraw_balanced',  -- 'redraw_balanced' | 'fill_lowest_table'
  p_dry_run            BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor        UUID := auth.uid();
  v_authorized   BOOLEAN;
  v_tour         RECORD;
  v_reason       TEXT;
  v_room_seats   INTEGER;
  v_tc           INTEGER;
  v_need         INTEGER;
  v_have         INTEGER;
  v_p            RECORD;
  v_h            RECORD;
  v_new_seat_id  UUID;
  v_receipt_id   UUID;
  v_receipt_code TEXT;
  v_attempt      INTEGER;
  v_moves        JSONB := '[]'::jsonb;
  v_closed       JSONB := '[]'::jsonb;
BEGIN
  -- 0. Actor + arg validation.
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_mode NOT IN ('final_table','table_count_threshold','itm','manual_custom') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode',
      'hint', 'day2_itm is deferred (needs flight/day schema)');
  END IF;
  IF p_draw_mode NOT IN ('redraw_balanced','fill_lowest_table') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_draw_mode');
  END IF;
  IF p_mode = 'manual_custom' AND (p_eligible_entry_ids IS NULL OR cardinality(p_eligible_entry_ids) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'manual_requires_entry_ids');
  END IF;

  -- 1. Lock tournament; must be open.
  SELECT * INTO v_tour FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tour.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'status', v_tour.status);
  END IF;

  -- 2. Authorization: owner or club_cashier.
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor
    WHERE t.id = p_tournament_id
      AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  v_reason := CASE p_mode
    WHEN 'final_table'           THEN 'final_table_redraw'
    WHEN 'table_count_threshold' THEN 'threshold_redraw'
    WHEN 'itm'                   THEN 'itm_redraw'
    WHEN 'manual_custom'         THEN 'manual_redraw'
  END;

  -- Drop temp tables left by a prior call in the SAME transaction (ON COMMIT DROP only
  -- fires at commit, so a second call in one txn — e.g. preview then commit — would hit
  -- "relation already exists"). In production each RPC call is its own txn, but this keeps
  -- the function robust to multiple calls per transaction.
  DROP TABLE IF EXISTS _elig, _targets, _holes, _plan;

  -- 3. ELIGIBLE = active, entry-backed seats. manual_custom restricts to the given
  --    entry ids; the consolidation modes take ALL seated players.
  CREATE TEMP TABLE _elig ON COMMIT DROP AS
  SELECT ts.id AS from_seat_id, ts.table_id AS from_seat_tid, ts.seat_number AS from_seat_number,
         ts.player_name, ts.chip_count,
         e.id AS entry_id, e.player_id, e.entry_no, e.registration_id,
         tt.table_id AS from_game_id, tt.table_number AS from_table_number
  FROM public.tournament_seats ts
  JOIN public.tournament_entries e ON e.id = ts.entry_id
  LEFT JOIN public.tournament_tables tt
    ON tt.tournament_id = ts.tournament_id AND ts.table_id IN (tt.id, tt.table_id)
  WHERE ts.tournament_id = p_tournament_id
    AND ts.is_active = true
    AND (p_mode <> 'manual_custom' OR e.id = ANY(p_eligible_entry_ids));

  v_need := (SELECT count(*) FROM _elig);
  IF v_need = 0 THEN
    RETURN jsonb_build_object('ok', true, 'mode', p_mode, 'dry_run', p_dry_run,
      'moves', '[]'::jsonb, 'closed', '[]'::jsonb, 'note', 'no_eligible_players');
  END IF;

  -- 4. Representative seat count + target table count.
  v_room_seats := COALESCE(
    (SELECT mode() WITHIN GROUP (ORDER BY max_seats) FROM public.tournament_tables
       WHERE tournament_id = p_tournament_id AND status = 'active' AND max_seats IS NOT NULL),
    9);
  v_tc := COALESCE(p_target_table_count, CASE p_mode
    WHEN 'final_table'           THEN 1
    WHEN 'table_count_threshold' THEN 3
    WHEN 'itm'                   THEN GREATEST(1, CEIL(v_need::numeric / v_room_seats)::int)
    WHEN 'manual_custom'         THEN (SELECT count(*) FROM public.tournament_tables
                                        WHERE tournament_id = p_tournament_id AND status='active' AND table_id IS NOT NULL)
  END);
  IF v_tc < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target_table_count');
  END IF;

  -- 5. TARGET tables = the v_tc active+linked tables with the lowest number (these survive).
  CREATE TEMP TABLE _targets ON COMMIT DROP AS
  SELECT tt.id AS tt_id, tt.table_id AS game_id, tt.table_number, tt.max_seats
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id AND tt.status = 'active' AND tt.table_id IS NOT NULL
  ORDER BY tt.table_number ASC NULLS LAST
  LIMIT v_tc;

  IF (SELECT count(*) FROM _targets) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_target_tables');
  END IF;

  -- 6. HOLES = seats in target tables free AFTER the eligible players vacate. A seat is
  --    a hole unless a NON-eligible active seat occupies it. occ = non-eligible players
  --    that STAY on that table (so shortest-table-first fills the emptiest first).
  CREATE TEMP TABLE _holes ON COMMIT DROP AS
  SELECT tg.tt_id, tg.game_id, tg.table_number, s.n AS seat_number,
         (SELECT count(*) FROM public.tournament_seats x
            WHERE x.is_active = true AND x.table_id IN (tg.tt_id, tg.game_id)
              AND x.entry_id IS NOT NULL
              AND x.entry_id NOT IN (SELECT entry_id FROM _elig))::int AS occ
  FROM _targets tg
  CROSS JOIN LATERAL generate_series(1, tg.max_seats) AS s(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tournament_seats x
    WHERE x.is_active = true AND x.seat_number = s.n
      AND x.table_id IN (tg.tt_id, tg.game_id)
      AND x.entry_id IS NOT NULL
      AND x.entry_id NOT IN (SELECT entry_id FROM _elig)
  );

  v_have := (SELECT count(*) FROM _holes);
  IF v_have < v_need THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity',
      'need', v_need, 'have', v_have, 'target_table_count', v_tc);
  END IF;

  -- 7. PLAN: assign each eligible player (random order) to a hole. redraw_balanced =
  --    shortest-table-first + random; fill_lowest_table = deterministic low table/seat.
  CREATE TEMP TABLE _plan (
    entry_id uuid, player_id uuid, entry_no int, registration_id uuid,
    player_name text, chip_count int,
    from_seat_id uuid, from_game_id uuid, from_table_number int, from_seat_number int,
    to_tt_id uuid, to_game_id uuid, to_table_number int, to_seat_number int
  ) ON COMMIT DROP;

  FOR v_p IN SELECT * FROM _elig ORDER BY random() LOOP
    IF p_draw_mode = 'fill_lowest_table' THEN
      SELECT * INTO v_h FROM _holes ORDER BY table_number ASC, seat_number ASC LIMIT 1;
    ELSE
      SELECT * INTO v_h FROM _holes ORDER BY occ ASC, random() LIMIT 1;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'plan_no_seat'; END IF;  -- capacity prechecked; defensive

    INSERT INTO _plan VALUES (
      v_p.entry_id, v_p.player_id, v_p.entry_no, v_p.registration_id,
      v_p.player_name, v_p.chip_count,
      v_p.from_seat_id, v_p.from_game_id, v_p.from_table_number, v_p.from_seat_number,
      v_h.tt_id, v_h.game_id, v_h.table_number, v_h.seat_number);

    DELETE FROM _holes WHERE tt_id = v_h.tt_id AND seat_number = v_h.seat_number;
    UPDATE _holes SET occ = occ + 1 WHERE tt_id = v_h.tt_id;
  END LOOP;

  -- Assemble the moves payload (used for both the dry-run preview and the commit result).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'player_name', player_name,
           'from_table_number', from_table_number, 'from_seat', from_seat_number,
           'to_table_number', to_table_number, 'to_seat_number', to_seat_number) ORDER BY to_table_number, to_seat_number), '[]'::jsonb)
  INTO v_moves FROM _plan;

  -- Tables that would close = active+linked, NOT a target, with no NON-eligible player left.
  SELECT coalesce(jsonb_agg(jsonb_build_object('table_number', tt.table_number) ORDER BY tt.table_number), '[]'::jsonb)
  INTO v_closed
  FROM public.tournament_tables tt
  WHERE tt.tournament_id = p_tournament_id AND tt.status = 'active' AND tt.table_id IS NOT NULL
    AND tt.id NOT IN (SELECT tt_id FROM _targets)
    AND NOT EXISTS (
      SELECT 1 FROM public.tournament_seats x
      WHERE x.is_active = true AND x.table_id IN (tt.id, tt.table_id)
        AND x.entry_id IS NOT NULL AND x.entry_id NOT IN (SELECT entry_id FROM _elig)
    );

  -- 8. DRY-RUN -> return the preview, no writes.
  IF p_dry_run THEN
    RETURN jsonb_build_object('ok', true, 'mode', p_mode, 'dry_run', true,
      'target_table_count', v_tc, 'eligible', v_need, 'free_seats', v_have,
      'moves', v_moves, 'tables_to_close', v_closed);
  END IF;

  -- 9. COMMIT — pass 1: vacate ALL eligible seats (so planned seats are free for pass 2).
  UPDATE public.tournament_seats SET status = 'moved', is_active = false
  WHERE id IN (SELECT from_seat_id FROM _elig);

  -- pass 2: claim planned seats + entry/receipt/history per player.
  FOR v_p IN SELECT * FROM _plan LOOP
    BEGIN
      INSERT INTO public.tournament_seats (
        tournament_id, player_id, entry_number, table_id, seat_number,
        chip_count, is_active, player_name, entry_id, status, assigned_by, assigned_at
      ) VALUES (
        p_tournament_id, v_p.player_id, v_p.entry_no, v_p.to_tt_id, v_p.to_seat_number,
        v_p.chip_count, true, v_p.player_name, v_p.entry_id, 'active', v_actor, now()
      ) RETURNING id INTO v_new_seat_id;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'redraw_seat_conflict';  -- concurrent grab -> roll the whole redraw back
    END;

    UPDATE public.tournament_entries
    SET table_id = v_p.to_game_id, seat_number = v_p.to_seat_number,
        seat_id = v_new_seat_id, current_stack = v_p.chip_count
    WHERE id = v_p.entry_id;

    UPDATE public.seat_draw_receipts SET status = 'superseded', cancelled_at = now()
    WHERE entry_id = v_p.entry_id AND status IN ('issued', 'printed');

    v_attempt := 0;
    LOOP
      v_attempt := v_attempt + 1;
      v_receipt_code := format('T%s-S%s-%s',
        COALESCE(v_p.to_table_number::text, '?'), v_p.to_seat_number,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)));
      BEGIN
        INSERT INTO public.seat_draw_receipts (
          tournament_id, registration_id, entry_id, player_id, display_name,
          table_id, table_number, seat_id, seat_number, receipt_code,
          qr_payload, draw_type, status, issued_by
        ) VALUES (
          p_tournament_id, v_p.registration_id, v_p.entry_id, v_p.player_id, v_p.player_name,
          v_p.to_game_id, v_p.to_table_number, v_new_seat_id, v_p.to_seat_number, v_receipt_code,
          jsonb_build_object('v', 1, 'receipt_code', v_receipt_code, 'entry_id', v_p.entry_id,
            'tournament_id', p_tournament_id, 'player_id', v_p.player_id,
            'table_number', v_p.to_table_number, 'seat_number', v_p.to_seat_number, 'reason', v_reason),
          'manual_move', 'issued', v_actor
        ) RETURNING id INTO v_receipt_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF v_attempt >= 5 THEN RAISE; END IF;
      END;
    END LOOP;

    INSERT INTO public.seat_assignment_history (
      tournament_id, entry_id, player_id,
      from_table_id, from_table_number, from_seat_number,
      to_table_id, to_table_number, to_seat_number,
      reason, draw_type, actor_user_id, metadata
    ) VALUES (
      p_tournament_id, v_p.entry_id, v_p.player_id,
      v_p.from_game_id, v_p.from_table_number, v_p.from_seat_number,
      v_p.to_game_id, v_p.to_table_number, v_p.to_seat_number,
      v_reason, 'manual_move', v_actor,
      jsonb_build_object('mode', p_mode, 'draw_mode', p_draw_mode,
        'to_tournament_table_id', v_p.to_tt_id, 'chip_count_at_move', v_p.chip_count)
    );
  END LOOP;

  -- 10. Close emptied non-target tables (every remaining occupant was eligible + moved).
  UPDATE public.tournament_tables tt SET status = 'closed'
  WHERE tt.tournament_id = p_tournament_id AND tt.status = 'active' AND tt.table_id IS NOT NULL
    AND tt.id NOT IN (SELECT tt_id FROM _targets)
    AND NOT EXISTS (SELECT 1 FROM public.tournament_seats x
                    WHERE x.is_active = true AND x.table_id IN (tt.id, tt.table_id));
  UPDATE public.game_tables g SET status = 'inactive'
  WHERE g.id IN (
    SELECT tt.table_id FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id AND tt.status = 'closed' AND tt.table_id IS NOT NULL
      AND tt.id NOT IN (SELECT tt_id FROM _targets)
      AND NOT EXISTS (SELECT 1 FROM public.tournament_seats x
                      WHERE x.is_active = true AND x.table_id IN (tt.id, tt.table_id)));

  RETURN jsonb_build_object('ok', true, 'mode', p_mode, 'dry_run', false,
    'target_table_count', v_tc, 'moved_count', v_need,
    'moves', v_moves, 'tables_closed', v_closed);
END;
$$;

REVOKE ALL ON FUNCTION public.redraw_tournament(UUID, TEXT, UUID[], INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redraw_tournament(UUID, TEXT, UUID[], INTEGER, TEXT, BOOLEAN) TO authenticated;
