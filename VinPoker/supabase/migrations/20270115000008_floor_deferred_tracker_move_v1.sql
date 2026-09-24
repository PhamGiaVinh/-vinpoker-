-- Floor: reserve a Tracker seat while its current hand finishes, then move the
-- entry in the same transaction as the hand's terminal update. Source-only RED.
-- Depends on 20270115000006 and 20270115000007.
-- Rollback (owner-gated): revoke the three public RPCs, disable the two new
-- triggers, and keep queued/applied rows as audit history. Never delete moves.
BEGIN;

CREATE TABLE IF NOT EXISTS public.floor_pending_tracker_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL REFERENCES public.tournament_entries(id) ON DELETE RESTRICT,
  source_seat_id uuid NOT NULL REFERENCES public.tournament_seats(id) ON DELETE RESTRICT,
  source_tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id) ON DELETE RESTRICT,
  source_table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  destination_tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id) ON DELETE RESTRICT,
  destination_table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  destination_seat_number integer NOT NULL CHECK (destination_seat_number BETWEEN 1 AND 9),
  source_control_epoch bigint NOT NULL,
  destination_control_epoch bigint NOT NULL,
  requested_by uuid NOT NULL,
  request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'stale', 'cancelled')),
  resolution_reason text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT floor_pending_tracker_moves_resolution_pair_check CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status <> 'pending' AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT floor_pending_tracker_moves_different_tables_check
    CHECK (source_tournament_table_id <> destination_tournament_table_id),
  CONSTRAINT floor_pending_tracker_moves_request_unique UNIQUE (requested_by, request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_pending_tracker_moves_entry
  ON public.floor_pending_tracker_moves (tournament_id, entry_id)
  WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_pending_tracker_moves_destination
  ON public.floor_pending_tracker_moves (destination_table_session_id, destination_seat_number)
  WHERE status = 'pending';

CREATE OR REPLACE VIEW floor_private.floor_break_pending_reservations_v1 AS
SELECT destination_table_session_id AS table_session_id,
       destination_seat_number AS seat_number
FROM public.floor_pending_tracker_moves
WHERE status = 'pending';
REVOKE ALL ON floor_private.floor_break_pending_reservations_v1 FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_floor_pending_tracker_moves_tournament
  ON public.floor_pending_tracker_moves (tournament_id, requested_at DESC)
  WHERE status = 'pending';
ALTER TABLE public.floor_pending_tracker_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.floor_pending_tracker_moves FROM PUBLIC, anon, authenticated, service_role;

-- A legacy Tracker hand may still have only table_id. Resolve it explicitly,
-- otherwise the Floor active-hand guard can miss that hand.
CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_has_active_hand(
  p_tournament_id uuid, p_tournament_table_id uuid, p_table_session_id uuid
)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournament_hands h
    WHERE h.tournament_id = p_tournament_id AND h.status = 'in_progress'
      AND COALESCE(h.is_voided, false) = false
      AND (h.tournament_table_id = p_tournament_table_id
           OR h.table_session_id = p_table_session_id
           OR h.table_id IN (
             SELECT tt.id FROM public.tournament_tables tt
             WHERE tt.id = p_tournament_table_id
             UNION
             SELECT tt.table_id FROM public.tournament_tables tt
             WHERE tt.id = p_tournament_table_id
             UNION
             SELECT tt.game_table_id FROM public.tournament_tables tt
             WHERE tt.id = p_tournament_table_id
           ))
  );
$$;
REVOKE ALL ON FUNCTION floor_private.floor_table_v3_has_active_hand(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Make new Tracker hands carry the active assignment/session before other
-- BEFORE INSERT triggers snapshot blinds. Never infer from a physical table ID.
CREATE OR REPLACE FUNCTION floor_private.floor_tracker_hand_session_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tt public.tournament_tables%ROWTYPE;
BEGIN
  IF NEW.status <> 'in_progress' THEN RETURN NEW; END IF;
  SELECT tt.* INTO v_tt FROM public.tournament_tables tt
  JOIN public.table_sessions ts ON ts.id = tt.table_session_id
  WHERE NEW.table_id IN (tt.id, tt.table_id, tt.game_table_id)
    AND tt.tournament_id = NEW.tournament_id
    AND tt.status = 'active' AND ts.closed_at IS NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF (NEW.tournament_table_id IS NOT NULL AND NEW.tournament_table_id <> v_tt.id)
     OR (NEW.table_session_id IS NOT NULL AND NEW.table_session_id <> v_tt.table_session_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'tracker_hand_session_mismatch';
  END IF;
  NEW.tournament_table_id := v_tt.id;
  NEW.table_session_id := v_tt.table_session_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_00_floor_tracker_hand_session_v1 ON public.tournament_hands;
CREATE TRIGGER trg_00_floor_tracker_hand_session_v1
BEFORE INSERT ON public.tournament_hands FOR EACH ROW
EXECUTE FUNCTION floor_private.floor_tracker_hand_session_v1();
REVOKE ALL ON FUNCTION floor_private.floor_tracker_hand_session_v1()
  FROM PUBLIC, anon, authenticated, service_role;

-- The reservation is enforced below every legacy or V3 seat writer. The
-- terminal handler marks its own request applied before inserting that seat.
CREATE OR REPLACE FUNCTION floor_private.floor_guard_pending_tracker_seat_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_active AND EXISTS (
    SELECT 1 FROM public.floor_pending_tracker_moves q
    JOIN public.tournament_tables tt ON tt.id = q.destination_tournament_table_id
    WHERE q.tournament_id = NEW.tournament_id
      AND (q.destination_table_session_id = NEW.table_session_id
           OR q.destination_tournament_table_id = NEW.tournament_table_id
           OR q.destination_tournament_table_id = NEW.table_id
           OR tt.game_table_id = NEW.table_id)
      AND q.destination_seat_number = NEW.seat_number AND q.status = 'pending'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'seat_reserved_pending_move';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_floor_guard_pending_tracker_seat_v1 ON public.tournament_seats;
CREATE TRIGGER trg_floor_guard_pending_tracker_seat_v1
BEFORE INSERT OR UPDATE OF is_active, seat_number, table_id, tournament_table_id, table_session_id
ON public.tournament_seats FOR EACH ROW
EXECUTE FUNCTION floor_private.floor_guard_pending_tracker_seat_v1();
REVOKE ALL ON FUNCTION floor_private.floor_guard_pending_tracker_seat_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.floor_queue_tracker_move_v1(
  p_entry_id uuid,
  p_destination_tournament_table_id uuid,
  p_destination_seat_number integer,
  p_expected_source_revision bigint,
  p_expected_destination_revision bigint,
  p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_seat public.tournament_seats%ROWTYPE;
  v_source public.tournament_tables%ROWTYPE;
  v_destination public.tournament_tables%ROWTYPE;
  v_source_session public.table_sessions%ROWTYPE;
  v_destination_session public.table_sessions%ROWTYPE;
  v_receipt record;
  v_fingerprint text;
  v_result jsonb;
  v_id uuid;
BEGIN
  IF v_actor IS NULL OR p_entry_id IS NULL OR p_destination_tournament_table_id IS NULL
     OR p_destination_seat_number IS NULL OR p_expected_source_revision IS NULL
     OR p_expected_destination_revision IS NULL OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT tournament_id INTO v_tournament_id FROM public.tournament_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found'); END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'entry', p_entry_id, 'destination', p_destination_tournament_table_id,
    'seat', p_destination_seat_number, 'source_revision', p_expected_source_revision,
    'destination_revision', p_expected_destination_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_queue_tracker_move_v1', p_request_id);
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_queue_tracker_move_v1', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed','cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  SELECT * INTO v_seat FROM public.tournament_seats s
  WHERE s.tournament_id = v_tournament_id AND s.entry_id = p_entry_id
    AND s.is_active AND s.tournament_table_id IS NOT NULL AND s.table_session_id IS NOT NULL;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_seat'); END IF;
  SELECT * INTO v_source FROM public.tournament_tables WHERE id = v_seat.tournament_table_id;
  SELECT * INTO v_destination FROM public.tournament_tables
  WHERE id = p_destination_tournament_table_id AND tournament_id = v_tournament_id;
  IF v_source.id IS NULL OR v_destination.id IS NULL OR v_source.id = v_destination.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id IN (v_source.game_table_id, v_destination.game_table_id)
    AND gt.club_id = v_tournament.club_id ORDER BY gt.id FOR UPDATE;
  IF (SELECT pg_catalog.count(*) FROM public.game_tables gt
      WHERE gt.id IN (v_source.game_table_id, v_destination.game_table_id)
        AND gt.club_id = v_tournament.club_id) <> 2 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  PERFORM 1 FROM public.table_sessions ts
  JOIN public.game_tables gt ON gt.id = ts.game_table_id
  WHERE ts.id IN (v_seat.table_session_id, v_destination.table_session_id)
  ORDER BY gt.id, ts.id FOR UPDATE;
  SELECT * INTO v_source_session FROM public.table_sessions WHERE id = v_seat.table_session_id;
  SELECT * INTO v_destination_session FROM public.table_sessions WHERE id = v_destination.table_session_id;
  SELECT * INTO v_source FROM public.tournament_tables
    WHERE id = v_source.id AND status = 'active' AND table_session_id = v_source_session.id FOR UPDATE;
  SELECT * INTO v_destination FROM public.tournament_tables
    WHERE id = v_destination.id AND status = 'active' AND table_session_id = v_destination_session.id FOR UPDATE;
  IF v_source.id IS NULL OR v_destination.id IS NULL
     OR v_source_session.closed_at IS NOT NULL OR v_destination_session.closed_at IS NOT NULL
     OR v_source_session.tournament_id IS DISTINCT FROM v_tournament_id
     OR v_destination_session.tournament_id IS DISTINCT FROM v_tournament_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  SELECT * INTO v_entry FROM public.tournament_entries WHERE id = p_entry_id FOR UPDATE;
  SELECT * INTO v_seat FROM public.tournament_seats
  WHERE id = v_seat.id AND is_active AND table_session_id = v_source_session.id FOR UPDATE;
  IF v_entry.status <> 'seated' OR v_seat.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_state_changed');
  END IF;
  IF v_entry.current_stack IS DISTINCT FROM v_seat.chip_count OR EXISTS (
    SELECT 1 FROM public.tournament_chip_counts chip_row
    WHERE chip_row.tournament_id = v_tournament_id
      AND chip_row.player_id = v_entry.player_id
      AND chip_row.entry_number = v_entry.entry_no
      AND chip_row.chip_count IS DISTINCT FROM v_seat.chip_count
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'chip_state_mismatch');
  END IF;
  IF v_source_session.revision <> p_expected_source_revision
     OR v_destination_session.revision <> p_expected_destination_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
  END IF;
  IF v_source_session.control_mode <> 'manual'
     OR floor_private.floor_table_v3_has_active_hand(v_tournament_id, v_source.id, v_source_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'source_table_busy');
  END IF;
  IF v_destination_session.control_mode <> 'tracker'
     OR NOT floor_private.floor_table_v3_has_active_hand(
       v_tournament_id, v_destination.id, v_destination_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'destination_hand_not_active');
  END IF;
  IF p_destination_seat_number NOT BETWEEN 1 AND v_destination.max_seats
     OR v_destination.max_seats NOT IN (8,9) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_seats s
             WHERE s.tournament_table_id = v_destination.id AND s.is_active
               AND s.seat_number = p_destination_seat_number)
     OR EXISTS (SELECT 1 FROM public.table_session_seat_locks l
                WHERE l.table_session_id = v_destination_session.id
                  AND l.seat_number = p_destination_seat_number AND l.unlocked_at IS NULL) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END IF;
  BEGIN
    INSERT INTO public.floor_pending_tracker_moves (
      tournament_id, entry_id, source_seat_id, source_tournament_table_id,
      source_table_session_id, destination_tournament_table_id,
      destination_table_session_id, destination_seat_number,
      source_control_epoch, destination_control_epoch, requested_by, request_id
    ) VALUES (
      v_tournament_id, p_entry_id, v_seat.id, v_source.id,
      v_source_session.id, v_destination.id, v_destination_session.id,
      p_destination_seat_number, v_source_session.control_epoch,
      v_destination_session.control_epoch, v_actor, p_request_id
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'pending_move_conflict');
  END;
  UPDATE public.table_sessions SET revision = revision + 1
  WHERE id = v_destination_session.id AND revision = p_expected_destination_revision;
  v_result := pg_catalog.jsonb_build_object(
    'ok', true, 'queued', true, 'pending_move_id', v_id,
    'entry_id', p_entry_id, 'destination_tournament_table_id', v_destination.id,
    'destination_seat_number', p_destination_seat_number
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_queue_tracker_move_v1', p_request_id, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
-- Release gate: the queue writer remains uncallable after DB apply. The
-- operations bundle must explicitly grant EXECUTE in a reviewed later step.

CREATE OR REPLACE FUNCTION public.get_floor_pending_tracker_moves_v1(p_tournament_id uuid)
RETURNS TABLE(
  pending_move_id uuid, entry_id uuid, source_tournament_table_id uuid,
  destination_tournament_table_id uuid, destination_seat_number integer,
  status text, resolution_reason text, requested_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_club_id uuid;
BEGIN
  SELECT t.club_id INTO v_club_id FROM public.tournaments t WHERE t.id = p_tournament_id;
  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'floor_pending_moves_access_denied';
  END IF;
  RETURN QUERY SELECT q.id, q.entry_id, q.source_tournament_table_id,
    q.destination_tournament_table_id, q.destination_seat_number,
    q.status, q.resolution_reason, q.requested_at
  FROM public.floor_pending_tracker_moves q
  WHERE q.tournament_id = p_tournament_id
    AND (q.status = 'pending' OR (q.status = 'stale' AND q.resolved_at > pg_catalog.now() - interval '1 day'))
  ORDER BY q.requested_at DESC LIMIT 100;
END;
$$;
REVOKE ALL ON FUNCTION public.get_floor_pending_tracker_moves_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_floor_pending_tracker_moves_v1(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.floor_cancel_pending_tracker_move_v1(p_pending_move_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_tournament_id uuid; v_tournament public.tournaments%ROWTYPE;
  v_move public.floor_pending_tracker_moves%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_pending_move_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT tournament_id INTO v_tournament_id FROM public.floor_pending_tracker_moves
  WHERE id = p_pending_move_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'pending_move_not_found'); END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  SELECT * INTO v_move FROM public.floor_pending_tracker_moves WHERE id = p_pending_move_id FOR UPDATE;
  IF v_move.status <> 'pending' THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'status', v_move.status, 'already_resolved', true);
  END IF;
  UPDATE public.floor_pending_tracker_moves
  SET status = 'cancelled', resolution_reason = 'floor_cancelled', resolved_at = pg_catalog.now()
  WHERE id = v_move.id AND status = 'pending';
  UPDATE public.table_sessions SET revision = revision + 1
  WHERE id = v_move.destination_table_session_id AND closed_at IS NULL;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'status', 'cancelled', 'pending_move_id', v_move.id);
END;
$$;
REVOKE ALL ON FUNCTION public.floor_cancel_pending_tracker_move_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.floor_cancel_pending_tracker_move_v1(uuid) TO authenticated;

-- The terminal hand writer owns the transaction. A queued move never joins the
-- hand being settled; it becomes a seat only after that hand is terminal.
-- Unexpected per-move failures are recorded as stale without losing the hand.
CREATE OR REPLACE FUNCTION floor_private.floor_apply_tracker_moves_after_hand_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_table public.tournament_tables%ROWTYPE;
  v_move public.floor_pending_tracker_moves%ROWTYPE;
  v_source_session public.table_sessions%ROWTYPE;
  v_destination_session public.table_sessions%ROWTYPE;
  v_source public.tournament_tables%ROWTYPE;
  v_destination public.tournament_tables%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_seat public.tournament_seats%ROWTYPE;
  v_new_seat_id uuid;
  v_reason text;
BEGIN
  IF OLD.status <> 'in_progress'
     OR NEW.status NOT IN ('completed', 'voided') THEN RETURN NEW; END IF;
  SELECT * INTO v_table FROM public.tournament_tables tt
  JOIN public.table_sessions ts ON ts.id = tt.table_session_id
  WHERE tt.tournament_id = NEW.tournament_id
    AND (tt.id = NEW.tournament_table_id
      OR (NEW.tournament_table_id IS NULL AND NEW.table_id IN (tt.id, tt.table_id, tt.game_table_id)))
    AND tt.status = 'active' AND ts.closed_at IS NULL;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- record_hand already holds this tournament row. The lock also serializes
  -- queue/cancel/bust/close when another terminal writer reaches this trigger.
  PERFORM 1 FROM public.tournaments t WHERE t.id = NEW.tournament_id FOR UPDATE;
  FOR v_move IN
    SELECT * FROM public.floor_pending_tracker_moves q
    WHERE q.destination_table_session_id = v_table.table_session_id
      AND q.status = 'pending'
    ORDER BY q.requested_at, q.id FOR UPDATE
  LOOP
    v_reason := NULL;
    SELECT * INTO v_source_session FROM public.table_sessions
      WHERE id = v_move.source_table_session_id;
    SELECT * INTO v_destination_session FROM public.table_sessions
      WHERE id = v_move.destination_table_session_id;
    SELECT * INTO v_source FROM public.tournament_tables
      WHERE id = v_move.source_tournament_table_id;
    SELECT * INTO v_destination FROM public.tournament_tables
      WHERE id = v_move.destination_tournament_table_id;
    SELECT * INTO v_entry FROM public.tournament_entries WHERE id = v_move.entry_id;
    SELECT * INTO v_seat FROM public.tournament_seats WHERE id = v_move.source_seat_id;

    IF v_source_session.id IS NULL OR v_destination_session.id IS NULL
       OR v_source_session.closed_at IS NOT NULL OR v_destination_session.closed_at IS NOT NULL
       OR v_source.id IS NULL OR v_destination.id IS NULL
       OR v_source.status <> 'active' OR v_destination.status <> 'active'
       OR v_source.table_session_id IS DISTINCT FROM v_source_session.id
       OR v_destination.table_session_id IS DISTINCT FROM v_destination_session.id
       OR v_source_session.tournament_id IS DISTINCT FROM NEW.tournament_id
       OR v_destination_session.tournament_id IS DISTINCT FROM NEW.tournament_id THEN
      v_reason := 'table_session_changed';
    ELSIF v_source_session.control_epoch IS DISTINCT FROM v_move.source_control_epoch
       OR v_destination_session.control_epoch IS DISTINCT FROM v_move.destination_control_epoch
       OR v_source_session.control_mode <> 'manual'
       OR v_destination_session.control_mode <> 'tracker' THEN
      v_reason := 'control_mode_changed';
    ELSIF v_entry.id IS NULL OR v_entry.status <> 'seated'
       OR v_seat.id IS NULL OR NOT v_seat.is_active
       OR v_seat.entry_id IS DISTINCT FROM v_entry.id
       OR v_seat.tournament_table_id IS DISTINCT FROM v_source.id
       OR v_seat.table_session_id IS DISTINCT FROM v_source_session.id THEN
      v_reason := 'entry_or_seat_changed';
    ELSIF v_entry.current_stack IS DISTINCT FROM v_seat.chip_count
       OR EXISTS (
         SELECT 1 FROM public.tournament_chip_counts chip_row
         WHERE chip_row.tournament_id = NEW.tournament_id
           AND chip_row.player_id = v_entry.player_id
           AND chip_row.entry_number = v_entry.entry_no
           AND chip_row.chip_count IS DISTINCT FROM v_seat.chip_count
       ) THEN
      v_reason := 'chip_state_mismatch';
    ELSIF EXISTS (
      SELECT 1 FROM public.tournament_seats occupied
      WHERE occupied.tournament_table_id = v_destination.id
        AND occupied.seat_number = v_move.destination_seat_number
        AND occupied.is_active
    ) OR EXISTS (
      SELECT 1 FROM public.table_session_seat_locks lock_row
      WHERE lock_row.table_session_id = v_destination_session.id
        AND lock_row.seat_number = v_move.destination_seat_number
        AND lock_row.unlocked_at IS NULL
    ) THEN
      v_reason := 'destination_seat_unavailable';
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE public.floor_pending_tracker_moves
      SET status = 'stale', resolution_reason = v_reason, resolved_at = pg_catalog.now()
      WHERE id = v_move.id;
      UPDATE public.table_sessions SET revision = revision + 1
      WHERE id = v_move.destination_table_session_id AND closed_at IS NULL;
      CONTINUE;
    END IF;
    IF floor_private.floor_table_v3_has_active_hand(
      NEW.tournament_id, v_source.id, v_source_session.id
    ) OR floor_private.floor_table_v3_has_active_hand(
      NEW.tournament_id, v_destination.id, v_destination_session.id
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      UPDATE public.floor_pending_tracker_moves
      SET status = 'applied', resolution_reason = 'hand_finished', resolved_at = pg_catalog.now()
      WHERE id = v_move.id AND status = 'pending';
      UPDATE public.tournament_seats
      SET is_active = false, status = 'moved'
      WHERE id = v_seat.id AND is_active;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'source_seat_changed';
      END IF;
      INSERT INTO public.tournament_seats (
        tournament_id, player_id, entry_number, table_id,
        tournament_table_id, table_session_id, seat_number, chip_count,
        is_active, entry_id, status, assigned_by, assigned_at
      ) VALUES (
        NEW.tournament_id, v_entry.player_id, v_entry.entry_no, v_destination.id,
        v_destination.id, v_destination_session.id,
        v_move.destination_seat_number, v_seat.chip_count,
        true, v_entry.id, 'active', v_move.requested_by, pg_catalog.now()
      ) RETURNING id INTO v_new_seat_id;
      -- Temporary Tracker compatibility projection. Explicit V3 IDs remain
      -- authoritative; Tracker still reads the legacy physical/assignment IDs.
      UPDATE public.tournament_entries
      SET table_id = v_destination.game_table_id, seat_id = v_new_seat_id,
          seat_number = v_move.destination_seat_number,
          current_stack = v_seat.chip_count, updated_at = pg_catalog.now()
      WHERE id = v_entry.id AND status = 'seated';
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entry_state_changed';
      END IF;
      INSERT INTO public.tournament_chip_counts (
        tournament_id, player_id, entry_number, chip_count
      ) VALUES (
        NEW.tournament_id, v_entry.player_id, v_entry.entry_no, v_seat.chip_count
      ) ON CONFLICT (tournament_id, player_id, entry_number)
      DO UPDATE SET chip_count = EXCLUDED.chip_count, updated_at = pg_catalog.now();
      UPDATE public.table_sessions SET revision = revision + 1
      WHERE id IN (v_move.source_table_session_id, v_move.destination_table_session_id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.floor_pending_tracker_moves
      SET status = 'stale', resolution_reason = 'apply_sqlstate_' || SQLSTATE,
          resolved_at = pg_catalog.now()
      WHERE id = v_move.id;
      UPDATE public.table_sessions SET revision = revision + 1
      WHERE id = v_move.destination_table_session_id AND closed_at IS NULL;
    END;
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_floor_apply_tracker_moves_after_hand_v1 ON public.tournament_hands;
CREATE TRIGGER trg_floor_apply_tracker_moves_after_hand_v1
AFTER UPDATE OF status ON public.tournament_hands FOR EACH ROW
WHEN (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'voided'))
EXECUTE FUNCTION floor_private.floor_apply_tracker_moves_after_hand_v1();
REVOKE ALL ON FUNCTION floor_private.floor_apply_tracker_moves_after_hand_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
