-- Redraw owns a short table/session hold and the tournament clock pause.
-- Pending source only. Depends on centerpoint_tournament_ops_release_v1 and
-- floor_redraw_seat_lock_v1. Never apply this file directly to production.
--
-- ROLLBACK: forward-only repair. Disable the shared release gate first, then
-- ship a reviewed migration which releases active holds and revokes the new
-- Continue RPC. Keep redraw snapshots and receipts as audit history.

BEGIN;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS clock_control_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.tournament_redraw_batches
  ADD COLUMN IF NOT EXISTS redraw_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clock_was_running boolean,
  ADD COLUMN IF NOT EXISTS clock_revision_after_pause bigint,
  ADD COLUMN IF NOT EXISTS pause_owner uuid,
  ADD COLUMN IF NOT EXISTS pause_reason text,
  ADD COLUMN IF NOT EXISTS presentation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_completed_by uuid;

ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS redraw_hold_batch_id uuid,
  ADD COLUMN IF NOT EXISTS redraw_hold_revision bigint,
  ADD COLUMN IF NOT EXISTS redraw_hold_at timestamptz;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.table_sessions'::regclass
      AND conname = 'table_sessions_redraw_hold_batch_v1_fkey'
  ) THEN
    ALTER TABLE public.table_sessions
      ADD CONSTRAINT table_sessions_redraw_hold_batch_v1_fkey
      FOREIGN KEY (redraw_hold_batch_id)
      REFERENCES public.tournament_redraw_batches(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.table_sessions'::regclass
      AND conname = 'table_sessions_redraw_hold_fields_v1_check'
  ) THEN
    ALTER TABLE public.table_sessions
      ADD CONSTRAINT table_sessions_redraw_hold_fields_v1_check CHECK (
        (redraw_hold_batch_id IS NULL AND redraw_hold_revision IS NULL AND redraw_hold_at IS NULL)
        OR (redraw_hold_batch_id IS NOT NULL AND redraw_hold_revision IS NOT NULL AND redraw_hold_at IS NOT NULL)
      );
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_table_sessions_active_redraw_hold_v1
  ON public.table_sessions (tournament_id, redraw_hold_batch_id)
  WHERE redraw_hold_batch_id IS NOT NULL AND closed_at IS NULL;

CREATE OR REPLACE FUNCTION floor_private.floor_redraw_clock_revision_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- UPDATE OF fires even when a manual pause request is a no-op. That revision
  -- prevents a later Continue from resuming a clock after a separate TD intent.
  NEW.clock_control_revision := OLD.clock_control_revision + 1;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.floor_redraw_clock_revision_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.floor_redraw_clock_revision_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_floor_redraw_clock_revision_v1 ON public.tournaments;
CREATE TRIGGER trg_floor_redraw_clock_revision_v1
BEFORE UPDATE OF clock_started_at, clock_paused_at, pause_accumulated,
  current_level, current_blinds, current_level_id
ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_redraw_clock_revision_v1();

CREATE OR REPLACE FUNCTION floor_private.floor_redraw_gate_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_club_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT tournament_row.club_id INTO v_club_id
    FROM public.tournaments tournament_row
    WHERE tournament_row.id = NEW.tournament_id;
    IF v_club_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_tournament_not_found';
    END IF;
    PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_club_id);
    IF EXISTS (
      SELECT 1 FROM public.table_sessions session_row
      WHERE session_row.tournament_id = NEW.tournament_id
        AND session_row.closed_at IS NULL
        AND session_row.redraw_hold_batch_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_already_on_hold';
    END IF;
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'applied' THEN
    SELECT tournament_row.club_id INTO v_club_id
    FROM public.tournaments tournament_row
    WHERE tournament_row.id = NEW.tournament_id;
    IF v_club_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_tournament_not_found';
    END IF;
    PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_club_id);
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.floor_redraw_gate_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.floor_redraw_gate_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_floor_redraw_gate_v1 ON public.tournament_redraw_batches;
CREATE TRIGGER trg_floor_redraw_gate_v1
BEFORE INSERT OR UPDATE ON public.tournament_redraw_batches
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_redraw_gate_v1();

CREATE OR REPLACE FUNCTION floor_private.floor_redraw_apply_clock_hold_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status text;
  v_clock_started_at timestamptz;
  v_clock_paused_at timestamptz;
  v_clock_was_running boolean;
  v_clock_revision bigint;
  v_hold_count integer;
BEGIN
  IF OLD.status IS DISTINCT FROM 'applied' AND NEW.status = 'applied' THEN
    SELECT tournament_row.status, tournament_row.clock_started_at,
           tournament_row.clock_paused_at
      INTO v_status, v_clock_started_at, v_clock_paused_at
    FROM public.tournaments tournament_row
    WHERE tournament_row.id = NEW.tournament_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_tournament_not_found';
    END IF;

    v_clock_was_running := v_status IN ('live', 'final_table')
      AND v_clock_started_at IS NOT NULL
      AND v_clock_paused_at IS NULL;

    UPDATE public.tournaments tournament_row
    SET clock_paused_at = CASE
      WHEN v_status IN ('live', 'final_table') AND v_clock_started_at IS NOT NULL
        THEN COALESCE(tournament_row.clock_paused_at, pg_catalog.now())
      ELSE tournament_row.clock_paused_at
    END
    WHERE tournament_row.id = NEW.tournament_id
    RETURNING tournament_row.clock_control_revision INTO v_clock_revision;

    UPDATE public.table_sessions session_row
    SET redraw_hold_batch_id = NEW.id,
        redraw_hold_revision = session_row.revision,
        redraw_hold_at = pg_catalog.now()
    WHERE session_row.tournament_id = NEW.tournament_id
      AND session_row.game_table_id = ANY(NEW.target_game_table_ids)
      AND session_row.closed_at IS NULL;
    GET DIAGNOSTICS v_hold_count = ROW_COUNT;
    IF v_hold_count <> cardinality(NEW.target_game_table_ids) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_hold_session_mismatch';
    END IF;

    UPDATE public.tournament_redraw_batches batch_row
    SET redraw_revision = OLD.redraw_revision + 1,
        clock_was_running = v_clock_was_running,
        clock_revision_after_pause = v_clock_revision,
        pause_owner = NEW.applied_by,
        pause_reason = 'redraw',
        presentation_started_at = NEW.applied_at
    WHERE batch_row.id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

ALTER FUNCTION floor_private.floor_redraw_apply_clock_hold_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.floor_redraw_apply_clock_hold_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_floor_redraw_apply_clock_hold_v1 ON public.tournament_redraw_batches;
CREATE TRIGGER trg_floor_redraw_apply_clock_hold_v1
AFTER UPDATE OF status ON public.tournament_redraw_batches
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_redraw_apply_clock_hold_v1();

CREATE OR REPLACE FUNCTION floor_private.floor_redraw_start_hand_fence_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tournament_id uuid := NEW.tournament_id;
  v_game_table_id uuid;
  v_table_session_id uuid;
  v_has_v3_assignment boolean;
BEGIN
  -- start_hand voids an expired hand before inserting the replacement. Fence
  -- that cleanup write too, otherwise the eventual INSERT guard would reject
  -- the new hand only after an unrelated hand-state mutation had occurred.
  IF TG_OP = 'UPDATE' AND NOT (
    OLD.status = 'in_progress' AND NEW.status = 'voided'
  ) THEN
    RETURN NEW;
  END IF;

  -- Floor apply locks the tournament before physical tables. Take the same
  -- first fence here, then re-read the active assignment so start_hand cannot
  -- pass using a pre-redraw table mapping after waiting on the lock.
  PERFORM 1 FROM public.tournaments tournament_row
  WHERE tournament_row.id = v_tournament_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_tournament_not_found';
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(table_row.game_table_id, table_row.table_id), table_row.table_session_id
    INTO v_game_table_id, v_table_session_id
  FROM public.tournament_tables table_row
  WHERE table_row.tournament_id = NEW.tournament_id
    AND (table_row.id = NEW.table_id
         OR table_row.table_id = NEW.table_id
         OR table_row.game_table_id = NEW.table_id)
    AND table_row.status = 'active'
  ORDER BY CASE WHEN table_row.id = NEW.table_id THEN 0 ELSE 1 END
  LIMIT 1;
  IF NOT FOUND THEN
    -- Preserve the explicitly supported legacy/history-only hand path. A V3
    -- assignment that redraw has closed is distinguishable by its retained
    -- session/physical-table identity and must not accept a new hand.
    SELECT EXISTS (
      SELECT 1 FROM public.tournament_tables table_row
      WHERE table_row.tournament_id = NEW.tournament_id
        AND (table_row.id = NEW.table_id
             OR table_row.table_id = NEW.table_id
             OR table_row.game_table_id = NEW.table_id)
        AND (table_row.game_table_id IS NOT NULL OR table_row.table_session_id IS NOT NULL)
    ) INTO v_has_v3_assignment;
    IF TG_OP = 'INSERT' AND v_has_v3_assignment THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_table_not_active';
    END IF;
    RETURN NEW;
  END IF;
  IF v_game_table_id IS NULL OR v_table_session_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Same lock order as Floor apply: physical game table, then table session.
  PERFORM 1 FROM public.game_tables game_table
  WHERE game_table.id = v_game_table_id
  FOR UPDATE;
  PERFORM 1 FROM public.table_sessions session_row
  WHERE session_row.id = v_table_session_id
    AND session_row.closed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.table_sessions session_row
    WHERE session_row.id = v_table_session_id
      AND session_row.redraw_hold_batch_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_table_hold_active';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.floor_redraw_start_hand_fence_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.floor_redraw_start_hand_fence_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_floor_redraw_start_hand_fence_v1 ON public.tournament_hands;
CREATE TRIGGER trg_floor_redraw_start_hand_fence_v1
BEFORE INSERT ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_redraw_start_hand_fence_v1();

DROP TRIGGER IF EXISTS trg_floor_redraw_stale_hand_cleanup_fence_v1 ON public.tournament_hands;
CREATE TRIGGER trg_floor_redraw_stale_hand_cleanup_fence_v1
BEFORE UPDATE OF status ON public.tournament_hands
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_redraw_start_hand_fence_v1();

CREATE OR REPLACE FUNCTION floor_private.floor_redraw_clock_resume_fence_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hold_batch_id uuid;
BEGIN
  IF NEW.clock_paused_at IS NULL AND NEW.clock_started_at IS NOT NULL THEN
    SELECT session_row.redraw_hold_batch_id INTO v_hold_batch_id
    FROM public.table_sessions session_row
    WHERE session_row.tournament_id = NEW.id
      AND session_row.closed_at IS NULL
      AND session_row.redraw_hold_batch_id IS NOT NULL
    ORDER BY session_row.redraw_hold_at, session_row.id
    LIMIT 1;
    IF v_hold_batch_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'redraw_table_hold_active';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION floor_private.floor_redraw_clock_resume_fence_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION floor_private.floor_redraw_clock_resume_fence_v1() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_floor_redraw_clock_resume_fence_v1 ON public.tournaments;
CREATE TRIGGER trg_floor_redraw_clock_resume_fence_v1
BEFORE UPDATE OF clock_started_at, clock_paused_at ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION floor_private.floor_redraw_clock_resume_fence_v1();

CREATE OR REPLACE FUNCTION public.floor_continue_tournament_redraw_v1(
  p_batch_id uuid,
  p_expected_redraw_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_batch public.tournament_redraw_batches%ROWTYPE;
  v_tournament public.tournaments%ROWTYPE;
  v_receipt record;
  v_fingerprint text;
  v_result jsonb;
  v_session_count integer;
BEGIN
  IF v_actor IS NULL OR p_batch_id IS NULL OR p_expected_redraw_revision IS NULL OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
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

  v_fingerprint := pg_catalog.jsonb_build_object(
    'batch_id', p_batch_id,
    'expected_redraw_revision', p_expected_redraw_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_continue_tournament_redraw_v1', p_request_id);
  SELECT * INTO v_receipt FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_continue_tournament_redraw_v1', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  PERFORM centerpoint_private.assert_tournament_ops_release_v1(v_tournament.club_id);
  IF v_batch.status <> 'applied' OR v_batch.redraw_revision <> p_expected_redraw_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_REDRAW_REVISION');
  END IF;

  -- Match Floor apply and start_hand row-lock order; no lock survives this RPC.
  PERFORM 1 FROM public.game_tables game_table
  WHERE game_table.id IN (
    SELECT session_row.game_table_id FROM public.table_sessions session_row
    WHERE session_row.tournament_id = v_tournament.id
      AND session_row.redraw_hold_batch_id = v_batch.id
      AND session_row.closed_at IS NULL
  )
  ORDER BY game_table.id FOR UPDATE;
  PERFORM 1 FROM public.table_sessions session_row
  JOIN public.game_tables game_table ON game_table.id = session_row.game_table_id
  WHERE session_row.tournament_id = v_tournament.id
    AND session_row.redraw_hold_batch_id = v_batch.id
    AND session_row.closed_at IS NULL
  ORDER BY game_table.id, session_row.id FOR UPDATE OF session_row;
  GET DIAGNOSTICS v_session_count = ROW_COUNT;
  IF v_session_count = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'REDRAW_HOLD_NOT_ACTIVE');
  END IF;

  UPDATE public.table_sessions session_row
  SET redraw_hold_batch_id = NULL,
      redraw_hold_revision = NULL,
      redraw_hold_at = NULL,
      revision = session_row.revision + 1,
      updated_at = pg_catalog.now()
  WHERE session_row.tournament_id = v_tournament.id
    AND session_row.redraw_hold_batch_id = v_batch.id
    AND session_row.closed_at IS NULL;
  IF FOUND AND v_batch.clock_was_running
     AND v_batch.clock_revision_after_pause = v_tournament.clock_control_revision
     AND v_tournament.clock_paused_at IS NOT NULL THEN
    UPDATE public.tournaments tournament_row
    SET pause_accumulated = COALESCE(tournament_row.pause_accumulated, 0)
          + GREATEST(0, floor(EXTRACT(EPOCH FROM (pg_catalog.now() - tournament_row.clock_paused_at)))::integer),
        clock_paused_at = NULL
    WHERE tournament_row.id = v_tournament.id
      AND tournament_row.clock_control_revision = v_batch.clock_revision_after_pause
      AND tournament_row.clock_paused_at IS NOT NULL;
  END IF;

  UPDATE public.tournament_redraw_batches
  SET hold_completed_at = pg_catalog.now(), hold_completed_by = v_actor,
      redraw_revision = redraw_revision + 1,
      updated_at = pg_catalog.now()
  WHERE id = v_batch.id AND hold_completed_at IS NULL;
  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'batch_id', v_batch.id,
    'redraw_revision', v_batch.redraw_revision + 1,
    'clock_resumed', v_batch.clock_was_running
      AND v_batch.clock_revision_after_pause = v_tournament.clock_control_revision
      AND v_tournament.clock_paused_at IS NOT NULL
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_continue_tournament_redraw_v1', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$function$;

ALTER FUNCTION public.floor_continue_tournament_redraw_v1(uuid, bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.floor_continue_tournament_redraw_v1(uuid, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.floor_continue_tournament_redraw_v1(uuid, bigint, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_public_tournament_redraw_v1(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE((
    SELECT pg_catalog.jsonb_build_object(
      'batch_id', batch_row.id,
      'redraw_revision', batch_row.redraw_revision,
      'tournament_name', tournament_row.name,
      'target_max_seats', batch_row.target_max_seats,
      'applied_at', batch_row.presentation_started_at,
      'moves', COALESCE(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'ordinal', move_row.ordinal,
          'player_name', move_row.player_display_name,
          'from_table_number', move_row.from_table_number,
          'from_seat_number', move_row.from_seat_number,
          'to_table_number', move_row.to_table_number,
          'to_seat_number', move_row.to_seat_number
        ) ORDER BY move_row.to_table_number, move_row.ordinal
      ), '[]'::jsonb)
    )
    FROM public.tournament_redraw_batches batch_row
    JOIN public.tournament_redraw_moves move_row ON move_row.batch_id = batch_row.id
    JOIN public.tournaments tournament_row ON tournament_row.id = batch_row.tournament_id
    WHERE batch_row.tournament_id = p_tournament_id
      AND batch_row.status = 'applied'
      AND batch_row.hold_completed_at IS NULL
      AND tournament_row.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.table_sessions hold_row
        WHERE hold_row.tournament_id = batch_row.tournament_id
          AND hold_row.redraw_hold_batch_id = batch_row.id
          AND hold_row.closed_at IS NULL
      )
    GROUP BY batch_row.id, tournament_row.name
    ORDER BY batch_row.presentation_started_at DESC, batch_row.id DESC
    LIMIT 1
  ), pg_catalog.jsonb_build_object('batch_id', NULL, 'moves', '[]'::jsonb));
$function$;

ALTER FUNCTION public.get_public_tournament_redraw_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_public_tournament_redraw_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_tournament_redraw_v1(uuid) TO anon, authenticated;

-- Forward-correct the audit discriminator without editing the frozen base
-- migration. The live seat_assignment_history CHECK allows manual_move for
-- seat changes; the implementation marker remains in reason.
CREATE OR REPLACE FUNCTION public.floor_apply_tournament_redraw_v1(
  p_batch_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $apply$
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
$apply$;

COMMIT;
