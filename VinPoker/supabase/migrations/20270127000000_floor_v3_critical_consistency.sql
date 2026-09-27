-- Floor V3 critical consistency: explicit orphan inventory, visible legacy
-- seats, server-authoritative break preview, and queued break completion.
-- Source-only RED. No business-data repair is performed by this migration.
-- Rollback (owner-gated): restore the v1/v4 read RPCs from 20270114000011,
-- revoke/drop the v1 plan and v5 writer, then drop the deferred close trigger.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_floor_tournament_table_inventory_v1(p_tournament_id uuid)
RETURNS TABLE(
  game_table_id uuid, table_number integer, table_name text,
  operational_status text, availability_status text, table_session_id uuid,
  control_mode text, control_epoch bigint, revision bigint,
  tournament_table_id uuid, max_seats integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_club_id uuid;
BEGIN
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'floor_table_inventory_access_denied';
  END IF;
  RETURN QUERY
  SELECT gt.id, gt.table_number, gt.table_name, gt.operational_status,
    CASE
      WHEN current_session.id IS NOT NULL AND current_table.id IS NULL THEN 'repair_required'
      WHEN current_session.id IS NOT NULL THEN 'current_tournament'
      WHEN gt.operational_status IS NULL THEN 'preflight_required'
      WHEN gt.operational_status <> 'available' THEN gt.operational_status
      ELSE 'available'
    END,
    current_session.id, current_session.control_mode, current_session.control_epoch,
    current_session.revision, current_table.id, current_table.max_seats
  FROM public.game_tables gt
  LEFT JOIN public.table_sessions any_session
    ON any_session.game_table_id = gt.id AND any_session.closed_at IS NULL
  LEFT JOIN public.table_sessions current_session
    ON current_session.id = any_session.id
   AND current_session.session_type = 'tournament'
   AND current_session.tournament_id = p_tournament_id
  LEFT JOIN public.tournament_tables current_table
    ON current_table.table_session_id = current_session.id
   AND current_table.tournament_id = p_tournament_id
   AND current_table.status = 'active'
  WHERE gt.club_id = v_club_id
    AND (any_session.id IS NULL OR current_session.id IS NOT NULL)
  ORDER BY gt.table_number, gt.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_floor_tournament_table_roster_v5(p_tournament_id uuid)
RETURNS TABLE(
  tournament_id uuid, tournament_table_id uuid, game_table_id uuid,
  table_number integer, table_name text, table_session_id uuid,
  session_revision bigint, control_mode text, control_epoch bigint,
  max_seats integer, tournament_table_status text, session_closed_at timestamptz,
  active_dealer_assignment_id uuid, seat_locks jsonb, seats jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_club_id uuid;
BEGIN
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'floor_table_v5_roster_access_denied';
  END IF;
  RETURN QUERY
  SELECT tt.tournament_id, tt.id, tt.game_table_id, gt.table_number,
    COALESCE(gt.table_name, tt.table_name), session_row.id, session_row.revision,
    session_row.control_mode, session_row.control_epoch, tt.max_seats, tt.status,
    session_row.closed_at, dealer_assignment.id,
    COALESCE(lock_rows.rows, '[]'::jsonb), COALESCE(seat_rows.rows, '[]'::jsonb)
  FROM public.tournament_tables tt
  JOIN public.table_sessions session_row
    ON session_row.id = tt.table_session_id
   AND session_row.tournament_id = tt.tournament_id
   AND session_row.game_table_id = tt.game_table_id
   AND session_row.closed_at IS NULL
  JOIN public.game_tables gt ON gt.id = tt.game_table_id AND gt.club_id = v_club_id
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'seat_number', l.seat_number, 'reason', l.reason,
      'locked_at', l.locked_at, 'locked_by', l.locked_by
    ) ORDER BY l.seat_number) AS rows
    FROM public.table_session_seat_locks l
    WHERE l.table_session_id = session_row.id AND l.unlocked_at IS NULL
  ) lock_rows ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'seat_number', s.seat_number,
      'entry_id', e.id,
      'player_id', s.player_id,
      'display_name', COALESCE(NULLIF(p.display_name, ''), NULLIF(s.player_name, ''), s.player_id::text),
      'entry_no', e.entry_no,
      'chip_count', s.chip_count,
      'is_active', s.is_active,
      'integrity_status', CASE WHEN e.id IS NULL THEN 'missing_entry' ELSE 'valid' END
    ) ORDER BY s.seat_number) AS rows
    FROM public.tournament_seats s
    LEFT JOIN public.tournament_entries e
      ON e.id = s.entry_id AND e.tournament_id = tt.tournament_id
    LEFT JOIN public.profiles p ON p.user_id = s.player_id
    WHERE s.tournament_id = tt.tournament_id
      AND s.tournament_table_id = tt.id
      AND s.table_session_id = session_row.id
      AND s.is_active
  ) seat_rows ON true
  LEFT JOIN LATERAL (
    SELECT d.id FROM public.dealer_assignments d
    WHERE d.table_session_id = session_row.id AND d.released_at IS NULL
      AND d.status IN ('assigned', 'on_break')
    ORDER BY d.assigned_at DESC, d.id DESC LIMIT 1
  ) dealer_assignment ON true
  WHERE tt.tournament_id = p_tournament_id AND tt.status = 'active'
  ORDER BY gt.table_number, tt.id;
END;
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_break_plan_rows_v1(
  p_tournament_id uuid, p_source_tournament_table_id uuid
)
RETURNS TABLE(
  ordinal bigint, source_seat_id uuid, entry_id uuid, player_id uuid,
  player_name text, entry_number integer, chip_count bigint,
  source_seat_number integer, destination_tournament_table_id uuid,
  destination_table_session_id uuid, destination_table_number integer,
  destination_seat_number integer, transfer_mode text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH source_rows AS (
    SELECT row_number() OVER (ORDER BY s.seat_number, s.id) AS ordinal,
      s.id AS source_seat_id, s.entry_id, s.player_id,
      COALESCE(NULLIF(p.display_name, ''), NULLIF(s.player_name, ''), s.player_id::text) AS player_name,
      e.entry_no AS entry_number, s.chip_count, s.seat_number AS source_seat_number
    FROM public.tournament_seats s
    LEFT JOIN public.tournament_entries e
      ON e.id = s.entry_id AND e.tournament_id = p_tournament_id
    LEFT JOIN public.profiles p ON p.user_id = s.player_id
    WHERE s.tournament_id = p_tournament_id
      AND s.tournament_table_id = p_source_tournament_table_id
      AND s.is_active
  ), destination_rows AS (
    SELECT row_number() OVER (
        ORDER BY occupied.count, gt.table_number, tt.id, seat_no
      ) AS ordinal,
      tt.id AS destination_tournament_table_id,
      ts.id AS destination_table_session_id,
      gt.table_number AS destination_table_number,
      seat_no AS destination_seat_number,
      CASE WHEN floor_private.floor_table_v3_has_active_hand(p_tournament_id, tt.id, ts.id)
        THEN 'after_current_hand' ELSE 'immediate' END AS transfer_mode
    FROM public.tournament_tables tt
    JOIN public.tournaments tournament_row ON tournament_row.id = tt.tournament_id
    JOIN public.table_sessions ts
      ON ts.id = tt.table_session_id
      AND ts.closed_at IS NULL
      AND ts.tournament_id = tt.tournament_id
      AND ts.game_table_id = tt.game_table_id
      AND ts.club_id = tournament_row.club_id
    JOIN public.game_tables gt
      ON gt.id = tt.game_table_id
      AND gt.club_id = tournament_row.club_id
    CROSS JOIN LATERAL pg_catalog.generate_series(1, tt.max_seats) seat_no
    CROSS JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS count FROM public.tournament_seats x
      WHERE x.tournament_table_id = tt.id AND x.table_session_id = ts.id AND x.is_active
    ) occupied
    WHERE tt.tournament_id = p_tournament_id AND tt.status = 'active'
      AND tt.id <> p_source_tournament_table_id
      AND tt.max_seats IN (8, 9)
      AND (NOT floor_private.floor_table_v3_has_active_hand(p_tournament_id, tt.id, ts.id)
        OR ts.control_mode = 'tracker')
      AND NOT EXISTS (SELECT 1 FROM public.tournament_seats x
        WHERE x.tournament_table_id = tt.id AND x.table_session_id = ts.id
          AND x.seat_number = seat_no AND x.is_active)
      AND NOT EXISTS (SELECT 1 FROM public.table_session_seat_locks l
        WHERE l.table_session_id = ts.id AND l.seat_number = seat_no AND l.unlocked_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.floor_pending_tracker_moves q
        WHERE q.destination_table_session_id = ts.id AND q.destination_seat_number = seat_no
          AND q.status = 'pending')
  )
  SELECT s.ordinal, s.source_seat_id, s.entry_id, s.player_id, s.player_name,
    s.entry_number, s.chip_count, s.source_seat_number,
    d.destination_tournament_table_id, d.destination_table_session_id,
    d.destination_table_number, d.destination_seat_number, d.transfer_mode
  FROM source_rows s LEFT JOIN destination_rows d USING (ordinal)
  ORDER BY s.ordinal;
$$;
REVOKE ALL ON FUNCTION floor_private.floor_break_plan_rows_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.floor_plan_break_table_v1(
  p_tournament_table_id uuid, p_expected_revision bigint,
  p_draw_mode text DEFAULT 'fill_lowest_table'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid(); v_tt public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE; v_tournament public.tournaments%ROWTYPE;
  v_moves jsonb; v_complete boolean; v_payload jsonb;
BEGIN
  IF v_actor IS NULL OR p_tournament_table_id IS NULL OR p_expected_revision IS NULL
     OR p_draw_mode <> 'fill_lowest_table' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT * INTO v_tt FROM public.tournament_tables
    WHERE id = p_tournament_table_id AND status = 'active';
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found'); END IF;
  SELECT * INTO v_session FROM public.table_sessions
    WHERE id = v_tt.table_session_id AND closed_at IS NULL;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tt.tournament_id;
  IF v_session.id IS NULL OR v_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF v_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_tt.id, v_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'entry_id', r.entry_id, 'player_name', r.player_name,
      'source_seat_number', r.source_seat_number,
      'destination_tournament_table_id', r.destination_tournament_table_id,
      'destination_table_number', r.destination_table_number,
      'destination_seat_number', r.destination_seat_number,
      'transfer_mode', r.transfer_mode
    ) ORDER BY r.ordinal), '[]'::jsonb),
    COALESCE(pg_catalog.bool_and(r.entry_id IS NOT NULL AND r.destination_tournament_table_id IS NOT NULL), true)
  INTO v_moves, v_complete
  FROM floor_private.floor_break_plan_rows_v1(v_tournament.id, v_tt.id) r;
  v_payload := pg_catalog.jsonb_build_object(
    'source_tournament_table_id', v_tt.id,
    'source_table_number', v_tt.table_number,
    'expected_revision', v_session.revision,
    'complete', v_complete,
    'moves', v_moves
  );
  RETURN v_payload || pg_catalog.jsonb_build_object(
    'ok', true, 'plan_hash', pg_catalog.md5(v_payload::text)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_break_table_v5(
  p_tournament_table_id uuid, p_expected_revision bigint, p_request_id uuid,
  p_draw_mode text DEFAULT 'fill_lowest_table', p_plan_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid(); v_plan jsonb; v_tt public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE; v_tournament public.tournaments%ROWTYPE;
  v_row record; v_pending integer := 0; v_moved integer := 0; v_result jsonb;
  v_fingerprint text; v_receipt record; v_new_seat_id uuid;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR p_plan_hash IS NULL OR p_plan_hash = '' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_table_id', p_tournament_table_id, 'expected_revision', p_expected_revision,
    'draw_mode', p_draw_mode, 'plan_hash', p_plan_hash
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_break_table_v5', p_request_id);
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_break_table_v5', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;
  SELECT * INTO v_tt FROM public.tournament_tables
    WHERE id = p_tournament_table_id AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found'); END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tt.tournament_id FOR UPDATE;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  PERFORM 1 FROM public.game_tables gt
    JOIN public.table_sessions ts ON ts.game_table_id = gt.id
    WHERE ts.tournament_id = v_tournament.id AND ts.closed_at IS NULL
    ORDER BY gt.id FOR UPDATE OF gt;
  PERFORM 1 FROM public.table_sessions ts JOIN public.game_tables gt ON gt.id = ts.game_table_id
    WHERE ts.tournament_id = v_tournament.id AND ts.closed_at IS NULL
    ORDER BY gt.id, ts.id FOR UPDATE OF ts;
  SELECT * INTO v_session FROM public.table_sessions
    WHERE id = v_tt.table_session_id AND closed_at IS NULL FOR UPDATE;
  IF v_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
  END IF;
  v_plan := public.floor_plan_break_table_v1(p_tournament_table_id, p_expected_revision, p_draw_mode);
  IF COALESCE((v_plan ->> 'ok')::boolean, false) IS NOT TRUE THEN RETURN v_plan; END IF;
  IF (v_plan ->> 'complete')::boolean IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'insufficient_capacity');
  END IF;
  IF v_plan ->> 'plan_hash' <> p_plan_hash THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_BREAK_PLAN');
  END IF;
  FOR v_row IN SELECT * FROM floor_private.floor_break_plan_rows_v1(v_tournament.id, v_tt.id)
  LOOP
    IF v_row.transfer_mode = 'after_current_hand' THEN
      INSERT INTO public.floor_pending_tracker_moves(
        tournament_id, entry_id, source_seat_id, source_tournament_table_id,
        source_table_session_id, destination_tournament_table_id,
        destination_table_session_id, destination_seat_number,
        source_control_epoch, destination_control_epoch, requested_by, request_id
      ) SELECT v_tournament.id, v_row.entry_id, v_row.source_seat_id, v_tt.id,
        v_session.id, v_row.destination_tournament_table_id,
        v_row.destination_table_session_id, v_row.destination_seat_number,
        v_session.control_epoch, dst.control_epoch, v_actor, gen_random_uuid()
      FROM public.table_sessions dst WHERE dst.id = v_row.destination_table_session_id;
      v_pending := v_pending + 1;
    ELSE
      UPDATE public.tournament_seats SET is_active = false, status = 'moved'
      WHERE id = v_row.source_seat_id AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'break_source_changed'; END IF;
      INSERT INTO public.tournament_seats(
        tournament_id, player_id, entry_number, tournament_table_id, table_session_id,
        seat_number, chip_count, is_active, entry_id, status, assigned_by, assigned_at
      ) VALUES (v_tournament.id, v_row.player_id, v_row.entry_number,
        v_row.destination_tournament_table_id, v_row.destination_table_session_id,
        v_row.destination_seat_number, v_row.chip_count, true, v_row.entry_id,
        'active', v_actor, pg_catalog.now())
      RETURNING id INTO v_new_seat_id;
      -- Keep the compatibility projection synchronized while active-seat V3
      -- identity remains authoritative. This mirrors the deferred Tracker move.
      UPDATE public.tournament_entries
      SET table_id = destination.game_table_id,
          seat_id = v_new_seat_id,
          seat_number = v_row.destination_seat_number,
          current_stack = v_row.chip_count,
          updated_at = pg_catalog.now()
      FROM public.tournament_tables destination
      WHERE public.tournament_entries.id = v_row.entry_id
        AND public.tournament_entries.status = 'seated'
        AND destination.id = v_row.destination_tournament_table_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'break_entry_state_changed';
      END IF;
      INSERT INTO public.tournament_chip_counts(
        tournament_id, player_id, entry_number, chip_count
      ) VALUES (
        v_tournament.id, v_row.player_id, v_row.entry_number, v_row.chip_count
      ) ON CONFLICT (tournament_id, player_id, entry_number)
      DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = pg_catalog.now();
      v_moved := v_moved + 1;
    END IF;
    UPDATE public.table_sessions SET revision = revision + 1
      WHERE id = v_row.destination_table_session_id AND closed_at IS NULL;
  END LOOP;
  IF v_pending = 0 THEN
    UPDATE public.dealer_assignments SET released_at = COALESCE(released_at, pg_catalog.now()),
      status = CASE WHEN status IN ('assigned','on_break') THEN 'completed' ELSE status END
      WHERE table_session_id = v_session.id AND released_at IS NULL;
    UPDATE public.tournament_tables SET status = 'closed' WHERE id = v_tt.id AND status = 'active';
    UPDATE public.table_sessions SET closed_at = pg_catalog.now(), closed_by = v_actor,
      close_reason = 'floor_break_v5', revision = revision + 1
      WHERE id = v_session.id AND closed_at IS NULL;
  ELSE
    UPDATE public.table_sessions SET revision = revision + 1
      WHERE id = v_session.id AND closed_at IS NULL;
  END IF;
  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'closed', v_pending = 0, 'break_pending', v_pending > 0,
    'moved_count', v_moved, 'pending_count', v_pending,
    'tournament_table_id', v_tt.id, 'table_session_id', v_session.id
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_break_table_v5', p_request_id, v_fingerprint, v_result);
  RETURN v_result;
EXCEPTION WHEN unique_violation THEN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'break_capacity_changed');
END;
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_close_completed_break_source_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status <> 'applied' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_seats s
      WHERE s.table_session_id = NEW.source_table_session_id AND s.is_active)
     OR EXISTS (SELECT 1 FROM public.floor_pending_tracker_moves q
      WHERE q.source_table_session_id = NEW.source_table_session_id AND q.status = 'pending') THEN
    RETURN NEW;
  END IF;
  UPDATE public.dealer_assignments SET released_at = COALESCE(released_at, pg_catalog.now()),
    status = CASE WHEN status IN ('assigned','on_break') THEN 'completed' ELSE status END
    WHERE table_session_id = NEW.source_table_session_id AND released_at IS NULL;
  UPDATE public.tournament_tables SET status = 'closed'
    WHERE id = NEW.source_tournament_table_id AND status = 'active';
  UPDATE public.table_sessions SET closed_at = pg_catalog.now(), closed_by = NEW.requested_by,
    close_reason = 'floor_break_v5_completed', revision = revision + 1
    WHERE id = NEW.source_table_session_id AND closed_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION floor_private.floor_close_completed_break_source_v1()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_floor_close_completed_break_source_v1 ON public.floor_pending_tracker_moves;
CREATE CONSTRAINT TRIGGER trg_floor_close_completed_break_source_v1
AFTER UPDATE ON public.floor_pending_tracker_moves
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION floor_private.floor_close_completed_break_source_v1();

ALTER FUNCTION public.get_floor_tournament_table_inventory_v1(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_floor_tournament_table_roster_v5(uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_plan_break_table_v1(uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.floor_break_table_v5(uuid,bigint,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_break_plan_rows_v1(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_close_completed_break_source_v1() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_floor_tournament_table_inventory_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_floor_tournament_table_roster_v5(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_plan_break_table_v1(uuid,bigint,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_break_table_v5(uuid,bigint,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_inventory_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_roster_v5(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_break_table_v1(uuid,bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_break_table_v5(uuid,bigint,uuid,text,text) TO authenticated;

COMMIT;
