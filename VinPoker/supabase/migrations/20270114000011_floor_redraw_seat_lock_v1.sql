-- ============================================================================
-- Floor redraw + seat lock V1 (SOURCE-ONLY / RED)
-- ============================================================================
-- Additive extension of Floor Table Control V3.  This migration never changes
-- legacy table_id semantics and never writes tournament business data while it
-- is applied.  All mutations are caller-bound RPCs and stay unreachable from
-- the UI while FEATURES.floorRedrawSeatLockV1 is OFF.
--
-- ROLLBACK (owner-gated, new migration only): revoke the V1 RPCs; keep batch,
-- move and lock rows as audit history.  Do not drop historical evidence.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.table_session_seat_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id) ON DELETE RESTRICT,
  table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  seat_number integer NOT NULL CHECK (seat_number BETWEEN 1 AND 9),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 2 AND 200),
  locked_by uuid NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  unlocked_by uuid,
  unlocked_at timestamptz,
  unlock_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_session_seat_locks_table_scope_v1_fkey
    FOREIGN KEY (tournament_table_id, table_session_id)
    REFERENCES public.tournament_tables(id, table_session_id) ON DELETE RESTRICT,
  CONSTRAINT table_session_seat_locks_tournament_scope_v1_fkey
    FOREIGN KEY (tournament_table_id, tournament_id)
    REFERENCES public.tournament_tables(id, tournament_id) ON DELETE RESTRICT,
  CONSTRAINT table_session_seat_locks_unlock_pair_v1_check CHECK (
    (unlocked_at IS NULL AND unlocked_by IS NULL)
    OR (unlocked_at IS NOT NULL AND unlocked_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_table_session_seat_locks_active_v1
  ON public.table_session_seat_locks (table_session_id, seat_number)
  WHERE unlocked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_table_session_seat_locks_tournament_active_v1
  ON public.table_session_seat_locks (tournament_id, tournament_table_id, seat_number)
  WHERE unlocked_at IS NULL;

ALTER TABLE public.table_session_seat_locks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.table_session_seat_locks FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.tournament_redraw_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  target_max_seats integer NOT NULL CHECK (target_max_seats IN (8, 9)),
  target_game_table_ids uuid[] NOT NULL CHECK (cardinality(target_game_table_ids) > 0),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'applied', 'stale', 'cancelled')),
  snapshot_fingerprint text NOT NULL,
  planned_by uuid NOT NULL,
  planned_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  applied_at timestamptz,
  stale_reason text,
  apply_result jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_redraw_batches_apply_pair_v1_check CHECK (
    (status <> 'applied' AND applied_at IS NULL AND applied_by IS NULL)
    OR (status = 'applied' AND applied_at IS NOT NULL AND applied_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_redraw_batches_one_planned_v1
  ON public.tournament_redraw_batches (tournament_id)
  WHERE status = 'planned';

CREATE INDEX IF NOT EXISTS idx_tournament_redraw_batches_latest_v1
  ON public.tournament_redraw_batches (tournament_id, planned_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.tournament_redraw_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.tournament_redraw_batches(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  entry_id uuid NOT NULL REFERENCES public.tournament_entries(id) ON DELETE RESTRICT,
  player_id uuid NOT NULL,
  entry_number integer NOT NULL CHECK (entry_number > 0),
  chip_count integer NOT NULL CHECK (chip_count >= 0),
  player_display_name text NOT NULL,
  from_game_table_id uuid NOT NULL REFERENCES public.game_tables(id) ON DELETE RESTRICT,
  from_tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id) ON DELETE RESTRICT,
  from_table_session_id uuid NOT NULL REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  from_table_number integer NOT NULL CHECK (from_table_number BETWEEN 1 AND 100),
  from_seat_number integer NOT NULL CHECK (from_seat_number BETWEEN 1 AND 9),
  to_game_table_id uuid NOT NULL REFERENCES public.game_tables(id) ON DELETE RESTRICT,
  to_table_number integer NOT NULL CHECK (to_table_number BETWEEN 1 AND 100),
  to_seat_number integer NOT NULL CHECK (to_seat_number BETWEEN 1 AND 9),
  applied_tournament_table_id uuid REFERENCES public.tournament_tables(id) ON DELETE RESTRICT,
  applied_table_session_id uuid REFERENCES public.table_sessions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, ordinal),
  UNIQUE (batch_id, entry_id),
  UNIQUE (batch_id, to_game_table_id, to_seat_number)
);

CREATE INDEX IF NOT EXISTS idx_tournament_redraw_moves_batch_v1
  ON public.tournament_redraw_moves (batch_id, ordinal);

ALTER TABLE public.tournament_redraw_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_redraw_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tournament_redraw_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tournament_redraw_moves FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION floor_private.floor_redraw_snapshot_fingerprint_v1(
  p_tournament_id uuid,
  p_target_max_seats integer,
  p_target_game_table_ids uuid[]
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'target_max_seats', p_target_max_seats,
      'target_game_table_ids', (
        SELECT COALESCE(pg_catalog.jsonb_agg(target_id ORDER BY target_id), '[]'::jsonb)
        FROM pg_catalog.unnest(p_target_game_table_ids) target_id
      ),
      'tables', (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'game_table_id', gt.id,
              'operational_status', gt.operational_status,
              'session_id', active_session.id,
              'session_tournament_id', active_session.tournament_id,
              'session_revision', active_session.revision,
              'control_mode', active_session.control_mode,
              'control_epoch', active_session.control_epoch,
              'tournament_table_id', tt.id,
              'max_seats', tt.max_seats,
              'table_status', tt.status
            ) ORDER BY gt.id
          ),
          '[]'::jsonb
        )
        FROM public.game_tables gt
        LEFT JOIN public.table_sessions active_session
          ON active_session.game_table_id = gt.id
         AND active_session.closed_at IS NULL
        LEFT JOIN public.tournament_tables tt
          ON tt.table_session_id = active_session.id
         AND tt.status = 'active'
        WHERE gt.id = ANY(p_target_game_table_ids)
      ),
      'seats', (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'seat_id', seat_row.id,
              'entry_id', seat_row.entry_id,
              'player_id', seat_row.player_id,
              'tournament_table_id', seat_row.tournament_table_id,
              'table_session_id', seat_row.table_session_id,
              'seat_number', seat_row.seat_number,
              'chip_count', seat_row.chip_count
            ) ORDER BY seat_row.entry_id, seat_row.id
          ),
          '[]'::jsonb
        )
        FROM public.tournament_seats seat_row
        WHERE seat_row.tournament_id = p_tournament_id
          AND seat_row.is_active
      ),
      'sessions', (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', session_row.id,
              'game_table_id', session_row.game_table_id,
              'revision', session_row.revision,
              'control_mode', session_row.control_mode,
              'control_epoch', session_row.control_epoch
            ) ORDER BY session_row.game_table_id, session_row.id
          ),
          '[]'::jsonb
        )
        FROM public.table_sessions session_row
        WHERE session_row.tournament_id = p_tournament_id
          AND session_row.closed_at IS NULL
      ),
      'locks', (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'table_session_id', lock_row.table_session_id,
              'seat_number', lock_row.seat_number,
              'reason', lock_row.reason
            ) ORDER BY lock_row.table_session_id, lock_row.seat_number
          ),
          '[]'::jsonb
        )
        FROM public.table_session_seat_locks lock_row
        WHERE lock_row.tournament_id = p_tournament_id
          AND lock_row.unlocked_at IS NULL
      )
    )::text
  );
$$;

ALTER FUNCTION floor_private.floor_redraw_snapshot_fingerprint_v1(uuid, integer, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.floor_redraw_snapshot_fingerprint_v1(uuid, integer, uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- Tournament-scoped inventory intentionally omits every physical table leased
-- by another tournament, Cash or VIP.  The browser cannot accidentally show
-- or select another operation's table.
CREATE OR REPLACE FUNCTION public.get_floor_tournament_table_inventory_v1(
  p_tournament_id uuid
)
RETURNS TABLE(
  game_table_id uuid,
  table_number integer,
  table_name text,
  operational_status text,
  availability_status text,
  table_session_id uuid,
  control_mode text,
  control_epoch bigint,
  revision bigint,
  tournament_table_id uuid,
  max_seats integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
BEGIN
  SELECT tournament_row.club_id INTO v_club_id
  FROM public.tournaments tournament_row
  WHERE tournament_row.id = p_tournament_id;

  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'floor_table_inventory_access_denied';
  END IF;

  RETURN QUERY
  SELECT
    gt.id,
    gt.table_number,
    gt.table_name,
    gt.operational_status,
    CASE
      WHEN current_session.id IS NOT NULL THEN 'current_tournament'
      WHEN gt.operational_status IS NULL THEN 'preflight_required'
      WHEN gt.operational_status <> 'available' THEN gt.operational_status
      ELSE 'available'
    END,
    current_session.id,
    current_session.control_mode,
    current_session.control_epoch,
    current_session.revision,
    current_table.id,
    current_table.max_seats
  FROM public.game_tables gt
  LEFT JOIN public.table_sessions any_session
    ON any_session.game_table_id = gt.id
   AND any_session.closed_at IS NULL
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

CREATE OR REPLACE FUNCTION public.get_floor_tournament_table_roster_v4(
  p_tournament_id uuid
)
RETURNS TABLE(
  tournament_id uuid,
  tournament_table_id uuid,
  game_table_id uuid,
  table_number integer,
  table_name text,
  table_session_id uuid,
  session_revision bigint,
  control_mode text,
  control_epoch bigint,
  max_seats integer,
  tournament_table_status text,
  session_closed_at timestamptz,
  active_dealer_assignment_id uuid,
  seat_locks jsonb,
  seats jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
BEGIN
  SELECT tournament_row.club_id INTO v_club_id
  FROM public.tournaments tournament_row
  WHERE tournament_row.id = p_tournament_id;

  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'floor_table_v4_roster_access_denied';
  END IF;

  RETURN QUERY
  SELECT
    tt.tournament_id,
    tt.id,
    tt.game_table_id,
    gt.table_number,
    COALESCE(gt.table_name, tt.table_name),
    session_row.id,
    session_row.revision,
    session_row.control_mode,
    session_row.control_epoch,
    tt.max_seats,
    tt.status,
    session_row.closed_at,
    dealer_assignment.id,
    COALESCE(lock_rows.rows, '[]'::jsonb),
    COALESCE(seat_rows.rows, '[]'::jsonb)
  FROM public.tournament_tables tt
  JOIN public.table_sessions session_row
    ON session_row.id = tt.table_session_id
   AND session_row.tournament_id = tt.tournament_id
   AND session_row.game_table_id = tt.game_table_id
   AND session_row.closed_at IS NULL
  JOIN public.game_tables gt
    ON gt.id = tt.game_table_id
   AND gt.club_id = v_club_id
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'seat_number', lock_row.seat_number,
        'reason', lock_row.reason,
        'locked_at', lock_row.locked_at,
        'locked_by', lock_row.locked_by
      ) ORDER BY lock_row.seat_number
    ) AS rows
    FROM public.table_session_seat_locks lock_row
    WHERE lock_row.table_session_id = session_row.id
      AND lock_row.unlocked_at IS NULL
  ) lock_rows ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'seat_number', seat_row.seat_number,
        'entry_id', seat_row.entry_id,
        'player_id', seat_row.player_id,
        'display_name', COALESCE(NULLIF(profile_row.display_name, ''), NULLIF(seat_row.player_name, ''), entry_row.player_id::text),
        'entry_no', entry_row.entry_no,
        'chip_count', seat_row.chip_count,
        'is_active', seat_row.is_active
      ) ORDER BY seat_row.seat_number
    ) AS rows
    FROM public.tournament_seats seat_row
    JOIN public.tournament_entries entry_row
      ON entry_row.id = seat_row.entry_id
     AND entry_row.tournament_id = tt.tournament_id
    LEFT JOIN public.profiles profile_row ON profile_row.user_id = entry_row.player_id
    WHERE seat_row.tournament_id = tt.tournament_id
      AND seat_row.tournament_table_id = tt.id
      AND seat_row.table_session_id = session_row.id
      AND seat_row.is_active
  ) seat_rows ON true
  LEFT JOIN LATERAL (
    SELECT assignment_row.id
    FROM public.dealer_assignments assignment_row
    WHERE assignment_row.table_session_id = session_row.id
      AND assignment_row.released_at IS NULL
      AND assignment_row.status IN ('assigned', 'on_break')
    ORDER BY assignment_row.assigned_at DESC, assignment_row.id DESC
    LIMIT 1
  ) dealer_assignment ON true
  WHERE tt.tournament_id = p_tournament_id
    AND tt.status = 'active'
  ORDER BY gt.table_number, tt.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_set_table_seat_lock_v1(
  p_tournament_table_id uuid,
  p_seat_number integer,
  p_locked boolean,
  p_reason text,
  p_expected_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tt public.tournament_tables%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
  v_receipt record;
  v_lock_id uuid;
  v_next_revision bigint;
  v_fingerprint text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_tournament_table_id IS NULL OR p_seat_number IS NULL
     OR p_locked IS NULL OR p_expected_revision IS NULL OR p_request_id IS NULL
     OR (p_locked AND length(btrim(COALESCE(p_reason, ''))) < 2) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_table_id', p_tournament_table_id,
    'seat_number', p_seat_number,
    'locked', p_locked,
    'reason', btrim(COALESCE(p_reason, '')),
    'expected_revision', p_expected_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_set_table_seat_lock_v1', p_request_id);
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_set_table_seat_lock_v1', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tt FROM public.tournament_tables WHERE id = p_tournament_table_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found'); END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tt.tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = v_tt.game_table_id AND gt.club_id = v_tournament.club_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch'); END IF;
  SELECT * INTO v_session FROM public.table_sessions session_row
  WHERE session_row.id = v_tt.table_session_id AND session_row.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_tt.status <> 'active' OR v_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active');
  END IF;
  IF v_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE', 'current_revision', v_session.revision);
  END IF;
  IF p_seat_number < 1 OR p_seat_number > v_tt.max_seats OR v_tt.max_seats NOT IN (8, 9) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_tt.id, v_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;
  IF p_locked AND EXISTS (
    SELECT 1 FROM public.tournament_seats seat_row
    WHERE seat_row.tournament_table_id = v_tt.id
      AND seat_row.table_session_id = v_session.id
      AND seat_row.seat_number = p_seat_number
      AND seat_row.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END IF;

  IF p_locked THEN
    SELECT lock_row.id INTO v_lock_id
    FROM public.table_session_seat_locks lock_row
    WHERE lock_row.table_session_id = v_session.id
      AND lock_row.seat_number = p_seat_number
      AND lock_row.unlocked_at IS NULL
    FOR UPDATE;
    IF FOUND THEN
      v_result := pg_catalog.jsonb_build_object(
        'ok', true, 'already_locked', true, 'lock_id', v_lock_id,
        'seat_number', p_seat_number, 'revision', v_session.revision
      );
    ELSE
      INSERT INTO public.table_session_seat_locks (
        tournament_id, tournament_table_id, table_session_id, seat_number, reason, locked_by
      ) VALUES (
        v_tournament.id, v_tt.id, v_session.id, p_seat_number, btrim(p_reason), v_actor
      ) RETURNING id INTO v_lock_id;
      UPDATE public.table_sessions SET revision = revision + 1, updated_at = now()
      WHERE id = v_session.id AND revision = p_expected_revision
      RETURNING revision INTO v_next_revision;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE'; END IF;
      v_result := pg_catalog.jsonb_build_object(
        'ok', true, 'locked', true, 'lock_id', v_lock_id,
        'seat_number', p_seat_number, 'revision', v_next_revision
      );
    END IF;
  ELSE
    UPDATE public.table_session_seat_locks
    SET unlocked_at = now(), unlocked_by = v_actor, unlock_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
    WHERE table_session_id = v_session.id
      AND seat_number = p_seat_number
      AND unlocked_at IS NULL
    RETURNING id INTO v_lock_id;
    IF NOT FOUND THEN
      v_result := pg_catalog.jsonb_build_object(
        'ok', true, 'already_unlocked', true,
        'seat_number', p_seat_number, 'revision', v_session.revision
      );
    ELSE
      UPDATE public.table_sessions SET revision = revision + 1, updated_at = now()
      WHERE id = v_session.id AND revision = p_expected_revision
      RETURNING revision INTO v_next_revision;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE'; END IF;
      v_result := pg_catalog.jsonb_build_object(
        'ok', true, 'locked', false, 'lock_id', v_lock_id,
        'seat_number', p_seat_number, 'revision', v_next_revision
      );
    END IF;
  END IF;

  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_set_table_seat_lock_v1', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

-- Lock-aware wrappers preserve the mature V3 writers and their idempotency
-- receipts.  The target session row serializes seat-lock changes with the
-- underlying mutation, so a lock cannot race between validation and insert.
CREATE OR REPLACE FUNCTION public.floor_assign_entry_to_seat_v4(
  p_entry_id uuid,
  p_tournament_table_id uuid,
  p_seat_number integer,
  p_expected_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_receipt record;
  v_tt public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_assign_entry_to_seat', p_request_id
  );
  IF FOUND THEN RETURN v_receipt.result; END IF;
  SELECT * INTO v_tt FROM public.tournament_tables WHERE id = p_tournament_table_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found'); END IF;
  SELECT * INTO v_session FROM public.table_sessions WHERE id = v_tt.table_session_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active'); END IF;
  IF p_seat_number < 1 OR p_seat_number > v_tt.max_seats OR v_tt.max_seats NOT IN (8, 9) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_session_seat_locks lock_row
    WHERE lock_row.table_session_id = v_session.id
      AND lock_row.seat_number = p_seat_number
      AND lock_row.unlocked_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_locked');
  END IF;
  RETURN public.floor_assign_entry_to_seat(
    p_entry_id, p_tournament_table_id, p_seat_number, p_expected_revision, p_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.move_player_seat_v3(
  p_entry_id uuid,
  p_to_tournament_table_id uuid,
  p_to_seat_number integer,
  p_expected_source_revision bigint,
  p_expected_destination_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_receipt record;
  v_tt public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'move_player_seat_v2', p_request_id
  );
  IF FOUND THEN RETURN v_receipt.result; END IF;
  SELECT * INTO v_tt FROM public.tournament_tables WHERE id = p_to_tournament_table_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_destination_table'); END IF;
  SELECT * INTO v_session FROM public.table_sessions WHERE id = v_tt.table_session_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active'); END IF;
  IF p_to_seat_number < 1 OR p_to_seat_number > v_tt.max_seats OR v_tt.max_seats NOT IN (8, 9) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_session_seat_locks lock_row
    WHERE lock_row.table_session_id = v_session.id
      AND lock_row.seat_number = p_to_seat_number
      AND lock_row.unlocked_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_locked');
  END IF;
  RETURN public.move_player_seat_v2(
    p_entry_id, p_to_tournament_table_id, p_to_seat_number,
    p_expected_source_revision, p_expected_destination_revision, p_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_restore_busted_player_to_seat_v4(
  p_entry_id uuid,
  p_to_tournament_table_id uuid,
  p_to_seat_number integer,
  p_expected_revision bigint,
  p_expected_control_epoch bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_receipt record;
  v_tt public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_restore_busted_player_to_seat_v3', p_request_id
  );
  IF FOUND THEN RETURN v_receipt.result; END IF;
  SELECT * INTO v_tt FROM public.tournament_tables WHERE id = p_to_tournament_table_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_destination_table'); END IF;
  SELECT * INTO v_session FROM public.table_sessions WHERE id = v_tt.table_session_id AND closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active'); END IF;
  IF p_to_seat_number < 1 OR p_to_seat_number > v_tt.max_seats OR v_tt.max_seats NOT IN (8, 9) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_session_seat_locks lock_row
    WHERE lock_row.table_session_id = v_session.id
      AND lock_row.seat_number = p_to_seat_number
      AND lock_row.unlocked_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_locked');
  END IF;
  RETURN public.floor_restore_busted_player_to_seat_v3(
    p_entry_id, p_to_tournament_table_id, p_to_seat_number,
    p_expected_revision, p_expected_control_epoch, p_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.close_tournament_table_v4(
  p_tournament_table_id uuid,
  p_expected_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id uuid;
  v_actor uuid := auth.uid();
  v_result jsonb;
BEGIN
  SELECT tt.table_session_id INTO v_session_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;

  v_result := public.close_tournament_table_v3(
    p_tournament_table_id,
    p_expected_revision,
    p_request_id
  );
  IF COALESCE((v_result ->> 'ok')::boolean, false) AND v_session_id IS NOT NULL THEN
    UPDATE public.table_session_seat_locks
    SET unlocked_at = COALESCE(unlocked_at, now()),
        unlocked_by = COALESCE(unlocked_by, v_actor),
        unlock_reason = COALESCE(unlock_reason, 'table_closed')
    WHERE table_session_id = v_session_id
      AND unlocked_at IS NULL;
  END IF;
  RETURN v_result;
END;
$$;

-- The legacy break algorithm assumes nine usable seats on every destination.
-- Keep it available only when that assumption is still true. Operators must use
-- the persisted redraw flow for 8-max tables or any tournament with seat locks.
CREATE OR REPLACE FUNCTION public.floor_break_table_v4(
  p_tournament_table_id uuid,
  p_expected_revision bigint,
  p_request_id uuid,
  p_draw_mode text DEFAULT 'fill_lowest_table'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_club_id uuid;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_tournament_table_id IS NULL
     OR p_expected_revision IS NULL
     OR p_request_id IS NULL
     OR p_draw_mode NOT IN ('fill_lowest_table', 'redraw_balanced') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_table_id', p_tournament_table_id,
    'expected_revision', p_expected_revision,
    'draw_mode', p_draw_mode
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_break_table_v4', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'floor_break_table_v4', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT tt.tournament_id, tournament_row.club_id
  INTO v_tournament_id, v_club_id
  FROM public.tournament_tables tt
  JOIN public.tournaments tournament_row ON tournament_row.id = tt.tournament_id
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  PERFORM 1 FROM public.tournaments
  WHERE id = v_tournament_id
  FOR UPDATE;
  PERFORM 1
  FROM public.game_tables gt
  JOIN public.table_sessions session_row ON session_row.game_table_id = gt.id
  WHERE session_row.tournament_id = v_tournament_id
    AND session_row.closed_at IS NULL
  ORDER BY gt.id
  FOR UPDATE OF gt;
  PERFORM 1
  FROM public.table_sessions session_row
  JOIN public.game_tables gt ON gt.id = session_row.game_table_id
  WHERE session_row.tournament_id = v_tournament_id
    AND session_row.closed_at IS NULL
  ORDER BY gt.id, session_row.id
  FOR UPDATE OF session_row;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
    WHERE tt.tournament_id = v_tournament_id
      AND tt.status = 'active'
      AND session_row.closed_at IS NULL
      AND tt.max_seats <> 9
  ) OR EXISTS (
    SELECT 1
    FROM public.table_session_seat_locks lock_row
    JOIN public.table_sessions session_row ON session_row.id = lock_row.table_session_id
    WHERE session_row.tournament_id = v_tournament_id
      AND session_row.closed_at IS NULL
      AND lock_row.unlocked_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'redraw_required_for_capacity_or_locks'
    );
  END IF;

  v_result := public.floor_break_table_v3(
    p_tournament_table_id,
    p_expected_revision,
    p_request_id,
    p_draw_mode
  );
  IF COALESCE((v_result ->> 'ok')::boolean, false) THEN
    PERFORM floor_private.floor_table_v3_save_receipt(
      v_actor, 'floor_break_table_v4', p_request_id, v_fingerprint, v_result
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_plan_tournament_redraw_v1(
  p_tournament_id uuid,
  p_target_max_seats integer,
  p_game_table_ids uuid[],
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament public.tournaments%ROWTYPE;
  v_receipt record;
  v_batch_id uuid := gen_random_uuid();
  v_player_count integer;
  v_target_count integer;
  v_distinct_count integer;
  v_slot_count integer;
  v_move_count integer;
  v_fingerprint text;
  v_request_fingerprint text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_tournament_id IS NULL OR p_target_max_seats NOT IN (8, 9)
     OR p_game_table_ids IS NULL OR cardinality(p_game_table_ids) = 0 OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_request_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_id', p_tournament_id,
    'target_max_seats', p_target_max_seats,
    'game_table_ids', (SELECT pg_catalog.jsonb_agg(x ORDER BY x) FROM pg_catalog.unnest(p_game_table_ids) x)
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_plan_tournament_redraw_v1', p_request_id);
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_plan_tournament_redraw_v1', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_request_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = p_tournament_id;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT pg_catalog.count(DISTINCT x)::integer INTO v_distinct_count
  FROM pg_catalog.unnest(p_game_table_ids) x;
  IF v_distinct_count <> cardinality(p_game_table_ids) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'duplicate_target_table');
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_player_count
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = p_tournament_id AND seat_row.is_active;
  IF v_player_count = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_players');
  END IF;
  v_target_count := pg_catalog.ceil(v_player_count::numeric / p_target_max_seats)::integer;
  IF cardinality(p_game_table_ids) <> v_target_count THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'target_table_count_mismatch',
      'required', v_target_count, 'selected', cardinality(p_game_table_ids)
    );
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_game_table_ids) target_id
    LEFT JOIN public.game_tables gt ON gt.id = target_id
    LEFT JOIN public.table_sessions active_session
      ON active_session.game_table_id = gt.id AND active_session.closed_at IS NULL
    WHERE gt.id IS NULL
       OR gt.club_id IS DISTINCT FROM v_tournament.club_id
       OR gt.operational_status IS DISTINCT FROM 'available'
       OR (active_session.id IS NOT NULL AND (
         active_session.session_type <> 'tournament'
         OR active_session.tournament_id IS DISTINCT FROM p_tournament_id
       ))
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'target_table_not_available');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
    WHERE tt.tournament_id = p_tournament_id
      AND tt.status = 'active'
      AND session_row.closed_at IS NULL
      AND floor_private.floor_table_v3_has_active_hand(p_tournament_id, tt.id, session_row.id)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.table_session_seat_locks lock_row
    JOIN public.table_sessions session_row ON session_row.id = lock_row.table_session_id
    WHERE lock_row.tournament_id = p_tournament_id
      AND lock_row.unlocked_at IS NULL
      AND session_row.game_table_id = ANY(p_game_table_ids)
      AND lock_row.seat_number > p_target_max_seats
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'locked_seat_outside_capacity');
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_slot_count
  FROM pg_catalog.unnest(p_game_table_ids) target_id
  CROSS JOIN LATERAL pg_catalog.generate_series(1, p_target_max_seats) slot_no
  LEFT JOIN public.table_sessions session_row
    ON session_row.game_table_id = target_id AND session_row.closed_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.table_session_seat_locks lock_row
    WHERE lock_row.table_session_id = session_row.id
      AND lock_row.seat_number = slot_no
      AND lock_row.unlocked_at IS NULL
  );
  IF v_slot_count < v_player_count THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'insufficient_unlocked_capacity', 'need', v_player_count, 'have', v_slot_count
    );
  END IF;

  UPDATE public.tournament_redraw_batches
  SET status = 'cancelled', updated_at = now(), stale_reason = 'superseded_by_new_plan'
  WHERE tournament_id = p_tournament_id AND status = 'planned';

  v_fingerprint := floor_private.floor_redraw_snapshot_fingerprint_v1(
    p_tournament_id, p_target_max_seats, p_game_table_ids
  );
  INSERT INTO public.tournament_redraw_batches (
    id, tournament_id, target_max_seats, target_game_table_ids,
    snapshot_fingerprint, planned_by
  ) VALUES (
    v_batch_id, p_tournament_id, p_target_max_seats, p_game_table_ids,
    v_fingerprint, v_actor
  );

  INSERT INTO public.tournament_redraw_moves (
    batch_id, ordinal, entry_id, player_id, entry_number, chip_count, player_display_name,
    from_game_table_id, from_tournament_table_id, from_table_session_id,
    from_table_number, from_seat_number,
    to_game_table_id, to_table_number, to_seat_number
  )
  WITH ordered_players AS (
    SELECT
      seat_row.entry_id,
      seat_row.player_id,
      seat_row.entry_number,
      seat_row.chip_count,
      COALESCE(NULLIF(profile_row.display_name, ''), NULLIF(seat_row.player_name, ''), seat_row.player_id::text) AS display_name,
      tt.game_table_id AS from_game_table_id,
      tt.id AS from_tournament_table_id,
      session_row.id AS from_table_session_id,
      gt.table_number AS from_table_number,
      seat_row.seat_number AS from_seat_number,
      pg_catalog.row_number() OVER (
        ORDER BY pg_catalog.md5(v_batch_id::text || ':' || seat_row.entry_id::text), seat_row.entry_id
      ) AS ordinal
    FROM public.tournament_seats seat_row
    JOIN public.tournament_entries entry_row
      ON entry_row.id = seat_row.entry_id AND entry_row.tournament_id = p_tournament_id
    JOIN public.tournament_tables tt
      ON tt.id = seat_row.tournament_table_id AND tt.status = 'active'
    JOIN public.table_sessions session_row
      ON session_row.id = seat_row.table_session_id AND session_row.closed_at IS NULL
    JOIN public.game_tables gt ON gt.id = tt.game_table_id
    LEFT JOIN public.profiles profile_row ON profile_row.user_id = entry_row.player_id
    WHERE seat_row.tournament_id = p_tournament_id AND seat_row.is_active
  ), ordered_slots AS (
    SELECT
      gt.id AS game_table_id,
      gt.table_number,
      slot_no AS seat_number,
      -- Round-robin by seat round keeps table populations within one player
      -- when capacity permits (36 players at 8-max => 8/7/7/7/7).
      pg_catalog.row_number() OVER (ORDER BY slot_no, gt.table_number, gt.id) AS ordinal
    FROM pg_catalog.unnest(p_game_table_ids) target_id
    JOIN public.game_tables gt ON gt.id = target_id
    LEFT JOIN public.table_sessions session_row
      ON session_row.game_table_id = gt.id AND session_row.closed_at IS NULL
    CROSS JOIN LATERAL pg_catalog.generate_series(1, p_target_max_seats) slot_no
    WHERE NOT EXISTS (
      SELECT 1 FROM public.table_session_seat_locks lock_row
      WHERE lock_row.table_session_id = session_row.id
        AND lock_row.seat_number = slot_no
        AND lock_row.unlocked_at IS NULL
    )
  )
  SELECT
    v_batch_id,
    player.ordinal,
    player.entry_id,
    player.player_id,
    player.entry_number,
    player.chip_count,
    player.display_name,
    player.from_game_table_id,
    player.from_tournament_table_id,
    player.from_table_session_id,
    player.from_table_number,
    player.from_seat_number,
    slot.game_table_id,
    slot.table_number,
    slot.seat_number
  FROM ordered_players player
  JOIN ordered_slots slot ON slot.ordinal = player.ordinal;

  GET DIAGNOSTICS v_move_count = ROW_COUNT;
  IF v_move_count <> v_player_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_plan_incomplete';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'status', 'planned',
    'target_max_seats', p_target_max_seats,
    'target_table_count', v_target_count,
    'player_count', v_player_count,
    'moved_count', v_move_count,
    'moves', COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'entry_id', move_row.entry_id,
        'player_name', move_row.player_display_name,
        'from_table_number', move_row.from_table_number,
        'from_seat_number', move_row.from_seat_number,
        'to_table_number', move_row.to_table_number,
        'to_seat_number', move_row.to_seat_number
      ) ORDER BY move_row.ordinal
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.tournament_redraw_moves move_row
  WHERE move_row.batch_id = v_batch_id;

  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_plan_tournament_redraw_v1', p_request_id, v_request_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_apply_tournament_redraw_v1(
  p_batch_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.tournament_redraw_batches%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_receipt record;
  v_move public.tournament_redraw_moves%ROWTYPE;
  v_target_session public.table_sessions%ROWTYPE;
  v_target_tt public.tournament_tables%ROWTYPE;
  v_current_fingerprint text;
  v_request_fingerprint text;
  v_result jsonb;
  v_released_count integer := 0;
  v_planned_count integer := 0;
BEGIN
  IF v_actor IS NULL OR p_batch_id IS NULL OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_request_fingerprint := pg_catalog.jsonb_build_object('batch_id', p_batch_id)::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_apply_tournament_redraw_v1', p_request_id);
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_apply_tournament_redraw_v1', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_request_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_batch FROM public.tournament_redraw_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'redraw_batch_not_found'); END IF;
  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_batch.tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF v_batch.status = 'applied' THEN RETURN v_batch.apply_result; END IF;
  IF v_batch.status <> 'planned' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'redraw_batch_not_pending', 'status', v_batch.status);
  END IF;

  -- One lock order for all current and selected physical tables, then sessions.
  PERFORM 1
  FROM public.game_tables gt
  WHERE gt.id IN (
    SELECT game_table_id FROM public.table_sessions
    WHERE tournament_id = v_tournament.id AND closed_at IS NULL
    UNION
    SELECT pg_catalog.unnest(v_batch.target_game_table_ids)
  )
  ORDER BY gt.id
  FOR UPDATE;
  PERFORM 1
  FROM public.table_sessions session_row
  JOIN public.game_tables gt ON gt.id = session_row.game_table_id
  WHERE session_row.closed_at IS NULL
    AND (session_row.tournament_id = v_tournament.id OR session_row.game_table_id = ANY(v_batch.target_game_table_ids))
  ORDER BY gt.id, session_row.id
  FOR UPDATE;

  v_current_fingerprint := floor_private.floor_redraw_snapshot_fingerprint_v1(
    v_tournament.id, v_batch.target_max_seats, v_batch.target_game_table_ids
  );
  IF v_current_fingerprint IS DISTINCT FROM v_batch.snapshot_fingerprint THEN
    UPDATE public.tournament_redraw_batches
    SET status = 'stale', stale_reason = 'state_changed_after_preview', updated_at = now()
    WHERE id = v_batch.id AND status = 'planned';
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_REDRAW_PLAN', 'batch_id', v_batch.id);
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
    WHERE tt.tournament_id = v_tournament.id
      AND tt.status = 'active'
      AND session_row.closed_at IS NULL
      AND floor_private.floor_table_v3_has_active_hand(v_tournament.id, tt.id, session_row.id)
  ) THEN
    UPDATE public.tournament_redraw_batches
    SET status = 'stale', stale_reason = 'active_hand_started', updated_at = now()
    WHERE id = v_batch.id AND status = 'planned';
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  -- Materialize missing target sessions only after the persisted plan passes
  -- its fingerprint. Current-tournament sessions keep dealer assignments.
  DECLARE
    v_target_game_table_id uuid;
  BEGIN
    FOREACH v_target_game_table_id IN ARRAY v_batch.target_game_table_ids
    LOOP
      SELECT session_row.* INTO v_target_session
      FROM public.table_sessions session_row
      WHERE session_row.game_table_id = v_target_game_table_id
        AND session_row.closed_at IS NULL;
      IF FOUND THEN
        IF v_target_session.session_type <> 'tournament'
           OR v_target_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
          RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'target_table_became_unavailable';
        END IF;
        SELECT tt.* INTO v_target_tt
        FROM public.tournament_tables tt
        WHERE tt.table_session_id = v_target_session.id
          AND tt.tournament_id = v_tournament.id
          AND tt.status = 'active'
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'target_assignment_missing'; END IF;
        UPDATE public.tournament_tables SET max_seats = v_batch.target_max_seats WHERE id = v_target_tt.id;
      ELSE
        INSERT INTO public.table_sessions (
          club_id, game_table_id, session_type, tournament_id,
          control_mode, control_epoch, revision, opened_by, audit_correlation_id
        ) VALUES (
          v_tournament.club_id, v_target_game_table_id, 'tournament', v_tournament.id,
          'manual', 1, 1, v_actor, v_batch.id
        ) RETURNING * INTO v_target_session;
        INSERT INTO public.tournament_tables (
          tournament_id, game_table_id, table_session_id, table_number, max_seats, status
        )
        SELECT v_tournament.id, gt.id, v_target_session.id, gt.table_number, v_batch.target_max_seats, 'active'
        FROM public.game_tables gt WHERE gt.id = v_target_game_table_id
        RETURNING * INTO v_target_tt;
      END IF;
      UPDATE public.tournament_redraw_moves
      SET applied_tournament_table_id = v_target_tt.id,
          applied_table_session_id = v_target_session.id
      WHERE batch_id = v_batch.id AND to_game_table_id = v_target_game_table_id;
    END LOOP;
  END;

  -- Release every old seat before assigning any new seat. This permits swaps and
  -- cyclic redraws without transiently violating the active-seat unique index.
  -- The persisted snapshot is safe to use because the fingerprint above proves
  -- the full active roster is unchanged while all relevant sessions are locked.
  UPDATE public.tournament_seats seat_row
  SET is_active = false, status = 'moved'
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.is_active
    AND EXISTS (
      SELECT 1
      FROM public.tournament_redraw_moves move_row
      WHERE move_row.batch_id = v_batch.id
        AND move_row.entry_id = seat_row.entry_id
        AND move_row.from_tournament_table_id = seat_row.tournament_table_id
        AND move_row.from_table_session_id = seat_row.table_session_id
        AND move_row.from_seat_number = seat_row.seat_number
        AND move_row.player_id = seat_row.player_id
        AND move_row.entry_number = seat_row.entry_number
        AND move_row.chip_count = seat_row.chip_count
    );
  GET DIAGNOSTICS v_released_count = ROW_COUNT;
  SELECT pg_catalog.count(*)::integer INTO v_planned_count
  FROM public.tournament_redraw_moves
  WHERE batch_id = v_batch.id;
  IF v_released_count <> v_planned_count THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_source_changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats seat_row
    WHERE seat_row.tournament_id = v_tournament.id AND seat_row.is_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_source_changed';
  END IF;

  FOR v_move IN
    SELECT * FROM public.tournament_redraw_moves WHERE batch_id = v_batch.id ORDER BY ordinal
  LOOP
    INSERT INTO public.tournament_seats (
      tournament_id, player_id, entry_number, tournament_table_id, table_session_id,
      seat_number, chip_count, is_active, entry_id, status, assigned_by, assigned_at
    ) VALUES (
      v_tournament.id, v_move.player_id, v_move.entry_number,
      v_move.applied_tournament_table_id, v_move.applied_table_session_id,
      v_move.to_seat_number, v_move.chip_count, true, v_move.entry_id,
      'active', v_actor, now()
    );
    INSERT INTO public.seat_assignment_history (
      tournament_id, entry_id, player_id,
      from_table_id, from_table_number, from_seat_number,
      to_table_id, to_table_number, to_seat_number,
      draw_type, reason, actor_user_id, metadata
    ) VALUES (
      v_tournament.id, v_move.entry_id, v_move.player_id,
      v_move.from_game_table_id, v_move.from_table_number, v_move.from_seat_number,
      v_move.to_game_table_id, v_move.to_table_number, v_move.to_seat_number,
      'manual_move', 'floor_redraw_v1', v_actor,
      pg_catalog.jsonb_build_object(
        'redraw_batch_id', v_batch.id,
        'from_tournament_table_id', v_move.from_tournament_table_id,
        'from_table_session_id', v_move.from_table_session_id,
        'to_tournament_table_id', v_move.applied_tournament_table_id,
        'to_table_session_id', v_move.applied_table_session_id,
        'target_max_seats', v_batch.target_max_seats
      )
    );
  END LOOP;

  -- Selected tracker sessions receive a new epoch so every pre-redraw Tracker
  -- request is fenced. New sessions start Manual and require an explicit mode change.
  UPDATE public.table_sessions
  SET revision = revision + 1,
      control_epoch = CASE WHEN control_mode = 'tracker' THEN control_epoch + 1 ELSE control_epoch END,
      updated_at = now()
  WHERE tournament_id = v_tournament.id
    AND closed_at IS NULL
    AND game_table_id = ANY(v_batch.target_game_table_ids);

  UPDATE public.table_session_seat_locks lock_row
  SET unlocked_at = now(), unlocked_by = v_actor, unlock_reason = 'redraw_table_closed'
  FROM public.table_sessions session_row
  WHERE lock_row.table_session_id = session_row.id
    AND session_row.tournament_id = v_tournament.id
    AND session_row.closed_at IS NULL
    AND NOT (session_row.game_table_id = ANY(v_batch.target_game_table_ids))
    AND lock_row.unlocked_at IS NULL;
  UPDATE public.dealer_assignments assignment_row
  SET released_at = COALESCE(assignment_row.released_at, now()),
      status = CASE WHEN assignment_row.status IN ('assigned', 'on_break') THEN 'completed' ELSE assignment_row.status END
  FROM public.table_sessions session_row
  WHERE assignment_row.table_session_id = session_row.id
    AND session_row.tournament_id = v_tournament.id
    AND session_row.closed_at IS NULL
    AND NOT (session_row.game_table_id = ANY(v_batch.target_game_table_ids))
    AND assignment_row.released_at IS NULL;
  UPDATE public.tournament_tables tt
  SET status = 'closed'
  FROM public.table_sessions session_row
  WHERE tt.table_session_id = session_row.id
    AND session_row.tournament_id = v_tournament.id
    AND session_row.closed_at IS NULL
    AND NOT (session_row.game_table_id = ANY(v_batch.target_game_table_ids))
    AND tt.status = 'active';
  UPDATE public.table_sessions
  SET closed_at = now(), closed_by = v_actor, close_reason = 'tournament_redraw',
      revision = revision + 1, updated_at = now()
  WHERE tournament_id = v_tournament.id
    AND closed_at IS NULL
    AND NOT (game_table_id = ANY(v_batch.target_game_table_ids));

  SELECT pg_catalog.jsonb_build_object(
    'ok', true,
    'batch_id', v_batch.id,
    'status', 'applied',
    'target_max_seats', v_batch.target_max_seats,
    'target_table_count', cardinality(v_batch.target_game_table_ids),
    'player_count', pg_catalog.count(*),
    'moved_count', pg_catalog.count(*),
    'moves', COALESCE(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'entry_id', move_row.entry_id,
        'player_name', move_row.player_display_name,
        'from_table_number', move_row.from_table_number,
        'from_seat_number', move_row.from_seat_number,
        'to_table_number', move_row.to_table_number,
        'to_seat_number', move_row.to_seat_number
      ) ORDER BY move_row.ordinal
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.tournament_redraw_moves move_row
  WHERE move_row.batch_id = v_batch.id;

  UPDATE public.tournament_redraw_batches
  SET status = 'applied', applied_by = v_actor, applied_at = now(),
      apply_result = v_result, updated_at = now()
  WHERE id = v_batch.id AND status = 'planned';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_batch_state_changed'; END IF;

  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_apply_tournament_redraw_v1', p_request_id, v_request_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1(
  p_tournament_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT pg_catalog.jsonb_build_object(
      'batch_id', batch_row.id,
      'tournament_name', tournament_row.name,
      'target_max_seats', batch_row.target_max_seats,
      'applied_at', batch_row.applied_at,
      'moves', COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'ordinal', move_row.ordinal,
          'player_name', move_row.player_display_name,
          'from_table_number', move_row.from_table_number,
          'from_seat_number', move_row.from_seat_number,
          'to_table_number', move_row.to_table_number,
          'to_seat_number', move_row.to_seat_number
        ) ORDER BY move_row.ordinal
       ), '[]'::jsonb)
      )
    FROM public.tournament_redraw_batches batch_row
    JOIN public.tournament_redraw_moves move_row ON move_row.batch_id = batch_row.id
    JOIN public.tournaments tournament_row ON tournament_row.id = batch_row.tournament_id
    WHERE batch_row.tournament_id = p_tournament_id
      AND batch_row.status = 'applied'
      AND tournament_row.deleted_at IS NULL
    GROUP BY batch_row.id, batch_row.target_max_seats, batch_row.applied_at, tournament_row.name
    ORDER BY batch_row.applied_at DESC, batch_row.id DESC
    LIMIT 1
  ), pg_catalog.jsonb_build_object('batch_id', NULL, 'moves', '[]'::jsonb));
$$;

ALTER FUNCTION public.get_floor_tournament_table_inventory_v1(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_floor_tournament_table_roster_v4(uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_set_table_seat_lock_v1(uuid, integer, boolean, text, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_assign_entry_to_seat_v4(uuid, uuid, integer, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.move_player_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_restore_busted_player_to_seat_v4(uuid, uuid, integer, bigint, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.close_tournament_table_v4(uuid, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_break_table_v4(uuid, bigint, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.floor_plan_tournament_redraw_v1(uuid, integer, uuid[], uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_apply_tournament_redraw_v1(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_public_tournament_redraw_v1(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_floor_tournament_table_inventory_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_floor_tournament_table_roster_v4(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_set_table_seat_lock_v1(uuid, integer, boolean, text, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_assign_entry_to_seat_v4(uuid, uuid, integer, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.move_player_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_restore_busted_player_to_seat_v4(uuid, uuid, integer, bigint, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_tournament_table_v4(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_break_table_v4(uuid, bigint, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_plan_tournament_redraw_v1(uuid, integer, uuid[], uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.floor_apply_tournament_redraw_v1(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_public_tournament_redraw_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_inventory_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_floor_tournament_table_roster_v4(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_set_table_seat_lock_v1(uuid, integer, boolean, text, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_assign_entry_to_seat_v4(uuid, uuid, integer, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_player_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v4(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_tournament_table_v4(uuid, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_break_table_v4(uuid, bigint, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_plan_tournament_redraw_v1(uuid, integer, uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_apply_tournament_redraw_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_redraw_v1(uuid) TO anon, authenticated;

COMMIT;
