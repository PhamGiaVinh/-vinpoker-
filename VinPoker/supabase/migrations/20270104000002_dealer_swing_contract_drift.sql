-- ============================================================================
-- 20270104000002_dealer_swing_contract_drift.sql
-- P1 Dealer Swing: forward-only DB/Edge compatibility repair.
--
-- This forward migration intentionally supersedes the unapplied historical
-- migrations 20270102000002 and 20270102000003. It combines the reviewed,
-- additive durable mass-open contract with a per-club cron dispatcher and a
-- transport-only observer. The historical files remain immutable and MUST NOT
-- be replayed against production.
--
-- SOURCE ONLY. Runtime mass-open rollout is disabled with an empty allowlist.
-- Applying this file, deploying Edge functions, or enabling rollout requires a
-- separate controlled owner window and the target-aware contract probe from
-- PR-ControlPlane #923.
--
-- ROLLBACK (only while the runtime master is OFF):
--   DROP TRIGGER IF EXISTS trg_dealer_open_assignment_refresh ON public.dealer_assignments;
--   DROP TRIGGER IF EXISTS trg_dealer_open_close_marker ON public.game_tables;
--   DROP TRIGGER IF EXISTS trg_dealer_open_close_refresh ON public.game_tables;
--   DROP FUNCTION IF EXISTS public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text);
--   DROP FUNCTION IF EXISTS public.get_dealer_open_operation(uuid,uuid);
--   SELECT cron.unschedule('process-swing-observer');
--   Recreate the reviewed prior process-swing dispatcher before removing any
--   dispatch objects. Never restore an 8-second timeout or response scan to the
--   business dispatcher.
-- Keep operation history unless the owner explicitly approves destructive cleanup.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.dealer_mass_open_rollout (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled           boolean NOT NULL DEFAULT false,
  all_clubs_enabled boolean NOT NULL DEFAULT false,
  allowed_club_ids  uuid[] NOT NULL DEFAULT '{}'::uuid[],
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

INSERT INTO public.dealer_mass_open_rollout (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dealer_mass_open_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_mass_open_rollout FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.dealer_mass_open_rollout TO service_role;

CREATE TABLE IF NOT EXISTS public.dealer_open_operations (
  id                  uuid PRIMARY KEY,
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  shift_id            uuid REFERENCES public.dealer_shifts(id) ON DELETE SET NULL,
  requested_by        uuid NOT NULL,
  table_type          text NOT NULL CHECK (table_type IN ('cash', 'tournament', 'vip')),
  request_fingerprint text NOT NULL,
  requested_count     integer NOT NULL CHECK (requested_count BETWEEN 1 AND 50),
  assigned_count      integer NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
  remaining_count     integer NOT NULL CHECK (remaining_count >= 0),
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'running', 'waiting_for_dealer',
                        'completed', 'cancelled', 'expired', 'failed'
                      )),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  completed_at        timestamptz,
  last_error_code     text
);

CREATE INDEX IF NOT EXISTS idx_dealer_open_operations_active
  ON public.dealer_open_operations (club_id, expires_at, created_at)
  WHERE status IN ('pending', 'running', 'waiting_for_dealer');

ALTER TABLE public.dealer_open_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_open_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dealer_open_operations TO service_role;

ALTER TABLE public.game_tables
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS dealer_open_operation_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.game_tables'::regclass
      AND conname = 'game_tables_dealer_open_operation_id_fkey'
  ) THEN
    ALTER TABLE public.game_tables
      ADD CONSTRAINT game_tables_dealer_open_operation_id_fkey
      FOREIGN KEY (dealer_open_operation_id)
      REFERENCES public.dealer_open_operations(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_game_tables_dealer_open_operation
  ON public.game_tables (dealer_open_operation_id, opened_at)
  WHERE dealer_open_operation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dealer_open_operation_targets (
  operation_id      uuid NOT NULL REFERENCES public.dealer_open_operations(id) ON DELETE CASCADE,
  table_id          uuid NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  initial_status    text NOT NULL,
  target_state      text NOT NULL DEFAULT 'pending' CHECK (target_state IN (
                      'pending', 'already_staffed', 'assigned', 'closed',
                      'expired', 'conflict', 'failed'
                    )),
  assignment_id     uuid REFERENCES public.dealer_assignments(id) ON DELETE SET NULL,
  outcome_code      text NOT NULL DEFAULT 'pending',
  assigned_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_dealer_open_targets_pending
  ON public.dealer_open_operation_targets (operation_id, table_id)
  WHERE target_state = 'pending';

ALTER TABLE public.dealer_open_operation_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_open_operation_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dealer_open_operation_targets TO service_role;

CREATE OR REPLACE FUNCTION public._dealer_mass_open_actor_allowed(
  p_actor_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_actor_id IS NOT NULL
     AND p_club_id IS NOT NULL
     AND public.is_club_dealer_control(p_actor_id, p_club_id);
$$;

REVOKE ALL ON FUNCTION public._dealer_mass_open_actor_allowed(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._dealer_mass_open_runtime_allowed(
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(r.enabled, false)
     AND (
       COALESCE(r.all_clubs_enabled, false)
       OR p_club_id = ANY(COALESCE(r.allowed_club_ids, '{}'::uuid[]))
     )
  FROM public.dealer_mass_open_rollout r
  WHERE r.id;
$$;

REVOKE ALL ON FUNCTION public._dealer_mass_open_runtime_allowed(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_dealer_mass_open_rollout(
  p_expected_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public._dealer_mass_open_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'actor_not_allowed');
  END IF;

  IF public._dealer_mass_open_runtime_allowed(p_expected_club_id) THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'allowed');
  END IF;

  RETURN jsonb_build_object('allowed', false, 'reason', 'rollout_disabled');
END;
$$;

REVOKE ALL ON FUNCTION public.get_dealer_mass_open_rollout(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dealer_mass_open_rollout(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._dealer_open_operation_result(
  p_operation_id uuid,
  p_idempotent_replay boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'outcome', CASE
      WHEN op.status = 'completed' THEN 'completed'
      WHEN op.status = 'waiting_for_dealer' THEN 'waiting_for_dealer'
      ELSE op.status
    END,
    'operation_id', op.id,
    'club_id', op.club_id,
    'shift_id', op.shift_id,
    'requested', op.requested_count,
    'assigned', op.assigned_count,
    'remaining', op.remaining_count,
    'operation_status', op.status,
    'expires_at', op.expires_at,
    'idempotent_replay', p_idempotent_replay,
    'targets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table_id', target.table_id,
        'state', target.target_state,
        'code', target.outcome_code,
        'assignment_id', target.assignment_id
      ) ORDER BY target.table_id)
      FROM public.dealer_open_operation_targets target
      WHERE target.operation_id = op.id
    ), '[]'::jsonb)
  )
  FROM public.dealer_open_operations op
  WHERE op.id = p_operation_id;
$$;

REVOKE ALL ON FUNCTION public._dealer_open_operation_result(uuid, boolean)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._refresh_dealer_open_operation(
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_operation public.dealer_open_operations%ROWTYPE;
  v_assigned  integer;
  v_closed    integer;
BEGIN
  SELECT * INTO v_operation
  FROM public.dealer_open_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_operation.expires_at <= now() THEN
    IF v_operation.status IN ('pending', 'running', 'waiting_for_dealer') THEN
      UPDATE public.dealer_open_operations
      SET status = 'expired',
          remaining_count = greatest(requested_count - assigned_count, 0),
          updated_at = now(),
          last_error_code = 'session_expired'
      WHERE id = p_operation_id;

      UPDATE public.dealer_open_operation_targets
      SET target_state = 'expired',
          outcome_code = 'session_expired',
          updated_at = now()
      WHERE operation_id = p_operation_id
        AND target_state = 'pending';
    END IF;

    UPDATE public.game_tables
    SET dealer_open_operation_id = NULL,
        opened_at = NULL
    WHERE dealer_open_operation_id = p_operation_id;

    RETURN public._dealer_open_operation_result(p_operation_id, false);
  END IF;

  IF v_operation.status IN ('completed', 'cancelled', 'expired', 'failed') THEN
    RETURN public._dealer_open_operation_result(p_operation_id, false);
  END IF;

  UPDATE public.dealer_open_operation_targets AS target
  SET target_state = CASE
        WHEN gt.status <> 'active' THEN 'closed'
        WHEN active_assignment.id IS NOT NULL
             AND target.target_state = 'already_staffed' THEN 'already_staffed'
        WHEN active_assignment.id IS NOT NULL THEN 'assigned'
        ELSE 'pending'
      END,
      assignment_id = active_assignment.id,
      outcome_code = CASE
        WHEN gt.status <> 'active' THEN 'table_closed'
        WHEN active_assignment.id IS NOT NULL
             AND target.target_state = 'already_staffed' THEN 'already_staffed'
        WHEN active_assignment.id IS NOT NULL THEN 'assigned'
        ELSE 'waiting_for_dealer'
      END,
      assigned_at = CASE
        WHEN active_assignment.id IS NOT NULL
          THEN COALESCE(target.assigned_at, active_assignment.assigned_at)
        ELSE NULL
      END,
      updated_at = now()
  FROM public.game_tables gt
  LEFT JOIN LATERAL (
    SELECT assignment.id, assignment.assigned_at
    FROM public.dealer_assignments assignment
    WHERE assignment.table_id = gt.id
      AND assignment.status = 'assigned'
      AND assignment.released_at IS NULL
    ORDER BY assignment.assigned_at DESC, assignment.id
    LIMIT 1
  ) active_assignment ON true
  WHERE target.operation_id = p_operation_id
    AND gt.id = target.table_id;

  SELECT
    count(*) FILTER (WHERE target_state IN ('assigned', 'already_staffed')),
    count(*) FILTER (WHERE target_state = 'closed')
  INTO v_assigned, v_closed
  FROM public.dealer_open_operation_targets
  WHERE operation_id = p_operation_id;

  UPDATE public.dealer_open_operations
  SET assigned_count = v_assigned,
      remaining_count = greatest(requested_count - v_assigned, 0),
      status = CASE
        WHEN v_closed > 0 THEN 'cancelled'
        WHEN v_assigned = requested_count THEN 'completed'
        ELSE 'waiting_for_dealer'
      END,
      completed_at = CASE
        WHEN v_assigned = requested_count THEN COALESCE(completed_at, now())
        ELSE NULL
      END,
      last_error_code = CASE WHEN v_closed > 0 THEN 'table_closed' ELSE NULL END,
      updated_at = now()
  WHERE id = p_operation_id;

  RETURN public._dealer_open_operation_result(p_operation_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public._refresh_dealer_open_operation(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refresh_dealer_open_operation(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_dealer_open_operation(
  p_operation_id uuid,
  p_expected_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF p_operation_id IS NULL
     OR NOT public._dealer_mass_open_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.dealer_open_operations
    WHERE id = p_operation_id
      AND club_id = p_expected_club_id
  ) THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  RETURN public._refresh_dealer_open_operation(p_operation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_dealer_open_operation(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dealer_open_operation(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.operator_open_dealer_tables(
  p_request_id uuid,
  p_expected_club_id uuid,
  p_shift_id uuid,
  p_table_ids uuid[],
  p_table_type text DEFAULT 'tournament'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_actor          uuid := auth.uid();
  v_table_ids      uuid[];
  v_count          integer;
  v_scope_count    integer;
  v_fingerprint    text;
  v_existing       public.dealer_open_operations%ROWTYPE;
  v_claimed        uuid;
BEGIN
  IF v_actor IS NULL
     OR p_request_id IS NULL
     OR p_expected_club_id IS NULL
     OR p_table_ids IS NULL
     OR array_length(p_table_ids, 1) IS NULL
     OR p_table_type NOT IN ('cash', 'tournament', 'vip') THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  IF NOT public._dealer_mass_open_actor_allowed(v_actor, p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'actor_not_allowed');
  END IF;

  IF NOT public._dealer_mass_open_runtime_allowed(p_expected_club_id) THEN
    RETURN jsonb_build_object('outcome', 'rollout_disabled');
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_table_ids) id WHERE id IS NULL) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'null_table_id');
  END IF;

  SELECT array_agg(DISTINCT id ORDER BY id), count(DISTINCT id)
    INTO v_table_ids, v_count
  FROM unnest(p_table_ids) id;

  IF cardinality(p_table_ids) > 50 THEN
    RETURN jsonb_build_object('outcome', 'batch_too_large', 'limit', 50);
  END IF;

  IF v_count <> cardinality(p_table_ids) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'duplicate_table');
  END IF;

  IF p_shift_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.dealer_shifts shift
    WHERE shift.id = p_shift_id
      AND shift.club_id = p_expected_club_id
      AND shift.closed_at IS NULL
      AND shift.archived_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'shift_not_active');
  END IF;

  v_fingerprint := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'club_id', p_expected_club_id,
        'shift_id', p_shift_id,
        'table_ids', to_jsonb(v_table_ids),
        'table_type', p_table_type
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  SELECT * INTO v_existing
  FROM public.dealer_open_operations
  WHERE id = p_request_id;

  IF FOUND THEN
    IF v_existing.requested_by <> v_actor
       OR v_existing.club_id <> p_expected_club_id
       OR v_existing.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object('outcome', 'idempotency_conflict');
    END IF;
    PERFORM public._refresh_dealer_open_operation(p_request_id);
    RETURN public._dealer_open_operation_result(p_request_id, true);
  END IF;

  -- Lock every requested table in canonical UUID order before validating or
  -- mutating any table. Input ordering therefore cannot create a lock cycle.
  PERFORM 1
  FROM public.game_tables table_row
  WHERE table_row.id = ANY(v_table_ids)
    AND table_row.club_id = p_expected_club_id
  ORDER BY table_row.id
  FOR UPDATE;
  GET DIAGNOSTICS v_scope_count = ROW_COUNT;

  IF v_scope_count <> v_count THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'reason', 'table_scope_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.game_tables table_row
    WHERE table_row.id = ANY(v_table_ids)
      AND table_row.status = 'maintenance'
  ) THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'table_in_maintenance');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.game_tables table_row
    JOIN public.dealer_open_operations old_operation
      ON old_operation.id = table_row.dealer_open_operation_id
    WHERE table_row.id = ANY(v_table_ids)
      AND old_operation.id <> p_request_id
      AND old_operation.status IN ('pending', 'running', 'waiting_for_dealer')
      AND old_operation.expires_at > now()
      AND table_row.opened_at >= now() - interval '24 hours'
  ) THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'table_in_open_operation');
  END IF;

  INSERT INTO public.dealer_open_operations (
    id, club_id, shift_id, requested_by, table_type, request_fingerprint,
    requested_count, remaining_count
  ) VALUES (
    p_request_id, p_expected_club_id, p_shift_id, v_actor, p_table_type,
    v_fingerprint, v_count, v_count
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_claimed;

  IF v_claimed IS NULL THEN
    SELECT * INTO v_existing
    FROM public.dealer_open_operations
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_existing.requested_by <> v_actor
       OR v_existing.club_id <> p_expected_club_id
       OR v_existing.request_fingerprint <> v_fingerprint THEN
      RETURN jsonb_build_object('outcome', 'idempotency_conflict');
    END IF;

    PERFORM public._refresh_dealer_open_operation(p_request_id);
    RETURN public._dealer_open_operation_result(p_request_id, true);
  END IF;

  INSERT INTO public.dealer_open_operation_targets (
    operation_id, table_id, initial_status, target_state, assignment_id,
    outcome_code, assigned_at
  )
  SELECT
    p_request_id,
    table_row.id,
    table_row.status,
    CASE WHEN active_assignment.id IS NULL THEN 'pending' ELSE 'already_staffed' END,
    active_assignment.id,
    CASE WHEN active_assignment.id IS NULL THEN 'waiting_for_dealer' ELSE 'already_staffed' END,
    active_assignment.assigned_at
  FROM public.game_tables table_row
  LEFT JOIN LATERAL (
    SELECT assignment.id, assignment.assigned_at
    FROM public.dealer_assignments assignment
    WHERE assignment.table_id = table_row.id
      AND assignment.status = 'assigned'
      AND assignment.released_at IS NULL
    ORDER BY assignment.assigned_at DESC, assignment.id
    LIMIT 1
  ) active_assignment ON true
  WHERE table_row.id = ANY(v_table_ids)
  ORDER BY table_row.id;

  UPDATE public.game_tables AS table_row
  SET status = CASE WHEN target.target_state = 'already_staffed' THEN table_row.status ELSE 'active' END,
      shift_id = CASE WHEN target.target_state = 'already_staffed' THEN table_row.shift_id ELSE p_shift_id END,
      table_type = CASE WHEN target.target_state = 'already_staffed' THEN table_row.table_type ELSE p_table_type END,
      opened_at = now(),
      dealer_open_operation_id = p_request_id
  FROM public.dealer_open_operation_targets target
  WHERE target.operation_id = p_request_id
    AND target.table_id = table_row.id;

  INSERT INTO public.swing_audit_logs (
    club_id, shift_id, action, details, triggered_by
  ) VALUES (
    p_expected_club_id,
    p_shift_id,
    'dealer_tables_open_operation',
    jsonb_build_object(
      'operation_id', p_request_id,
      'table_ids', to_jsonb(v_table_ids),
      'requested', v_count,
      'table_type', p_table_type
    ),
    v_actor::text
  );

  RETURN public._refresh_dealer_open_operation(p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.operator_open_dealer_tables(uuid, uuid, uuid, uuid[], text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_open_dealer_tables(uuid, uuid, uuid, uuid[], text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public._dealer_open_assignment_refresh_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_operation_id uuid;
BEGIN
  SELECT dealer_open_operation_id INTO v_operation_id
  FROM public.game_tables
  WHERE id = COALESCE(NEW.table_id, OLD.table_id);

  IF v_operation_id IS NOT NULL THEN
    PERFORM public._refresh_dealer_open_operation(v_operation_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public._dealer_open_assignment_refresh_trigger()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dealer_open_assignment_refresh ON public.dealer_assignments;
CREATE TRIGGER trg_dealer_open_assignment_refresh
AFTER INSERT OR UPDATE OF status, released_at ON public.dealer_assignments
FOR EACH ROW
EXECUTE FUNCTION public._dealer_open_assignment_refresh_trigger();

CREATE OR REPLACE FUNCTION public._dealer_open_close_marker_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    NEW.dealer_open_operation_id := NULL;
    NEW.opened_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._dealer_open_close_marker_trigger()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dealer_open_close_marker ON public.game_tables;
CREATE TRIGGER trg_dealer_open_close_marker
BEFORE UPDATE OF status ON public.game_tables
FOR EACH ROW
EXECUTE FUNCTION public._dealer_open_close_marker_trigger();

CREATE OR REPLACE FUNCTION public._dealer_open_close_refresh_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.dealer_open_operation_id IS NOT NULL
     AND NEW.dealer_open_operation_id IS NULL THEN
    PERFORM public._refresh_dealer_open_operation(OLD.dealer_open_operation_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._dealer_open_close_refresh_trigger()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dealer_open_close_refresh ON public.game_tables;
CREATE TRIGGER trg_dealer_open_close_refresh
AFTER UPDATE OF status, dealer_open_operation_id ON public.game_tables
FOR EACH ROW
EXECUTE FUNCTION public._dealer_open_close_refresh_trigger();

-- The canonical Pass R helper exists in source migration 20261223000000 but is
-- absent from the current live schema. Re-declare it here so this exact forward
-- migration closes that dependency without replaying historical migrations.
CREATE OR REPLACE FUNCTION public.end_breaks_on_demand(
  p_club_id          uuid,
  p_min_rest_minutes integer DEFAULT 15,
  p_max_count        integer DEFAULT 1
)
RETURNS TABLE(
  attendance_id  uuid,
  dealer_name    text,
  break_id       uuid,
  break_start    timestamptz,
  rested_minutes integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF p_club_id IS NULL OR COALESCE(p_max_count, 0) <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT DISTINCT ON (att.id)
      db.id          AS c_break_id,
      att.id         AS c_att_id,
      d.full_name    AS c_dealer_name,
      db.break_start AS c_break_start
    FROM public.dealer_breaks db
    LEFT JOIN public.dealer_assignments da ON da.id = db.assignment_id
    JOIN public.dealer_attendance att
      ON att.id = COALESCE(db.attendance_id, da.attendance_id)
    JOIN public.dealers d ON d.id = att.dealer_id
    WHERE d.club_id = p_club_id
      AND att.current_state = 'on_break'
      AND att.status = 'checked_in'
      AND db.break_end IS NULL
      AND db.reason = 'auto_break_on_swing'
      AND db.break_start <= v_now
        - (GREATEST(p_min_rest_minutes, 0) || ' minutes')::interval
      AND NOT EXISTS (
        SELECT 1
        FROM public.dealer_meal_breaks mb
        WHERE mb.attendance_id = att.id
          AND mb.status = 'active'
      )
    ORDER BY att.id, db.break_start ASC
  ),
  picked AS (
    SELECT c.c_break_id, c.c_att_id, c.c_dealer_name, c.c_break_start
    FROM candidate c
    JOIN public.dealer_breaks db ON db.id = c.c_break_id
    ORDER BY c.c_break_start ASC
    LIMIT LEAST(p_max_count, 20)
    FOR UPDATE OF db SKIP LOCKED
  ),
  closed AS (
    UPDATE public.dealer_breaks db
    SET break_end = v_now
    FROM picked p
    WHERE db.id = p.c_break_id
      AND db.break_end IS NULL
    RETURNING p.c_att_id AS att_id,
              p.c_dealer_name AS dealer_name,
              db.id AS break_id,
              p.c_break_start AS break_start
  )
  UPDATE public.dealer_attendance att
  SET current_state                   = 'available',
      priority_break_flag             = false,
      worked_minutes_since_last_break = 0,
      pool_entered_at                 = v_now,
      updated_at                      = v_now
  FROM closed c
  WHERE att.id = c.att_id
    AND att.current_state = 'on_break'
  RETURNING
    att.id,
    c.dealer_name,
    c.break_id,
    c.break_start,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_now - c.break_start)) / 60))::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.end_breaks_on_demand(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_breaks_on_demand(uuid, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.end_breaks_on_demand(uuid, integer, integer) IS
  'Dealer Swing Pass R: end eligible automatic compensation breaks after the rest floor. '
  'Never ends manual or meal breaks and never force-releases a seated dealer.';

-- ---------------------------------------------------------------------------
-- Per-club process-swing transport and business correlation.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.process_swing_dispatch_runs (
  run_id                 uuid PRIMARY KEY,
  request_id             uuid NOT NULL UNIQUE,
  club_id                uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tick_at                timestamptz NOT NULL,
  request_fingerprint    text NOT NULL UNIQUE,
  net_request_id         bigint UNIQUE,
  requested_at           timestamptz NOT NULL DEFAULT now(),
  enqueued_at            timestamptz,
  timeout_ms             integer NOT NULL DEFAULT 55000
                           CHECK (timeout_ms BETWEEN 55000 AND 300000),
  lease_token            uuid NOT NULL,
  lease_expires_at       timestamptz NOT NULL,
  enqueue_state          text NOT NULL DEFAULT 'pending'
                           CHECK (enqueue_state IN (
                             'pending', 'enqueued', 'skipped_secret_missing',
                             'enqueue_error'
                           )),
  transport_state        text NOT NULL DEFAULT 'pending'
                           CHECK (transport_state IN (
                             'pending', 'succeeded', 'failed', 'timed_out'
                           )),
  response_status        integer,
  response_observed_at   timestamptz,
  transport_error_code   text,
  business_state         text CHECK (business_state IS NULL OR business_state IN (
                           'received', 'started', 'completed', 'partial',
                           'locked', 'dependency_unavailable', 'business_failed'
                         )),
  business_error_code    text,
  business_diagnostics   jsonb,
  received_at            timestamptz,
  started_at             timestamptz,
  business_completed_at  timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_process_swing_dispatch_pending_transport
  ON public.process_swing_dispatch_runs (requested_at, net_request_id)
  WHERE transport_state = 'pending';

CREATE INDEX IF NOT EXISTS idx_process_swing_dispatch_club_lease
  ON public.process_swing_dispatch_runs (club_id, lease_expires_at DESC)
  WHERE business_state IS NULL OR business_state IN ('received', 'started');

CREATE INDEX IF NOT EXISTS idx_process_swing_dispatch_club_requested
  ON public.process_swing_dispatch_runs (club_id, requested_at DESC);

ALTER TABLE public.process_swing_dispatch_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.process_swing_dispatch_runs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.process_swing_dispatch_runs TO service_role;

CREATE TABLE IF NOT EXISTS public.process_swing_dispatch_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id      uuid NOT NULL REFERENCES public.process_swing_dispatch_runs(run_id) ON DELETE CASCADE,
  request_id  uuid NOT NULL,
  club_id     uuid NOT NULL,
  state       text NOT NULL CHECK (state IN (
                'received', 'started', 'completed', 'partial', 'locked',
                'duplicate', 'dependency_unavailable', 'business_failed'
              )),
  error_code  text,
  diagnostics jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, state)
);

CREATE INDEX IF NOT EXISTS idx_process_swing_dispatch_events_club_created
  ON public.process_swing_dispatch_events (club_id, created_at DESC);

ALTER TABLE public.process_swing_dispatch_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.process_swing_dispatch_events
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.process_swing_dispatch_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_process_swing_dispatch(
  p_run_id uuid,
  p_request_id uuid,
  p_club_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_run public.process_swing_dispatch_runs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL OR p_request_id IS NULL OR p_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO v_run
  FROM public.process_swing_dispatch_runs
  WHERE run_id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'unknown_request');
  END IF;

  IF v_run.request_id <> p_request_id OR v_run.club_id <> p_club_id THEN
    RETURN jsonb_build_object('outcome', 'scope_mismatch');
  END IF;

  IF v_run.business_state IN (
    'started', 'completed', 'partial', 'locked',
    'dependency_unavailable', 'business_failed'
  ) THEN
    INSERT INTO public.process_swing_dispatch_events (
      run_id, request_id, club_id, state, error_code,
      diagnostics
    ) VALUES (
      p_run_id, p_request_id, p_club_id, 'duplicate', 'idempotent_replay',
      jsonb_build_object('existing_state', v_run.business_state)
    ) ON CONFLICT (run_id, state) DO NOTHING;

    RETURN jsonb_build_object(
      'outcome', 'duplicate',
      'business_state', v_run.business_state,
      'business_error_code', v_run.business_error_code
    );
  END IF;

  IF v_run.lease_expires_at <= now() THEN
    UPDATE public.process_swing_dispatch_runs
    SET business_state = 'business_failed',
        business_error_code = 'dispatch_lease_expired',
        business_completed_at = now(),
        updated_at = now()
    WHERE run_id = p_run_id;

    INSERT INTO public.process_swing_dispatch_events (
      run_id, request_id, club_id, state, error_code
    ) VALUES (
      p_run_id, p_request_id, p_club_id,
      'business_failed', 'dispatch_lease_expired'
    ) ON CONFLICT (run_id, state) DO NOTHING;

    RETURN jsonb_build_object('outcome', 'lease_expired');
  END IF;

  UPDATE public.process_swing_dispatch_runs
  SET business_state = 'started',
      received_at = COALESCE(received_at, now()),
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE run_id = p_run_id;

  INSERT INTO public.process_swing_dispatch_events (
    run_id, request_id, club_id, state
  ) VALUES
    (p_run_id, p_request_id, p_club_id, 'received'),
    (p_run_id, p_request_id, p_club_id, 'started')
  ON CONFLICT (run_id, state) DO NOTHING;

  RETURN jsonb_build_object(
    'outcome', 'claimed',
    'lease_token', v_run.lease_token,
    'lease_expires_at', v_run.lease_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_process_swing_dispatch(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_process_swing_dispatch(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_process_swing_dispatch(
  p_run_id uuid,
  p_request_id uuid,
  p_club_id uuid,
  p_business_state text,
  p_error_code text DEFAULT NULL,
  p_diagnostics jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_run public.process_swing_dispatch_runs%ROWTYPE;
BEGIN
  IF p_business_state NOT IN (
    'completed', 'partial', 'locked',
    'dependency_unavailable', 'business_failed'
  ) THEN
    RETURN jsonb_build_object('outcome', 'invalid_state');
  END IF;

  SELECT * INTO v_run
  FROM public.process_swing_dispatch_runs
  WHERE run_id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'unknown_request');
  END IF;

  IF v_run.request_id <> p_request_id OR v_run.club_id <> p_club_id THEN
    RETURN jsonb_build_object('outcome', 'scope_mismatch');
  END IF;

  IF v_run.business_state IN (
    'completed', 'partial', 'locked',
    'dependency_unavailable', 'business_failed'
  ) THEN
    IF v_run.business_state = p_business_state
       AND v_run.business_error_code IS NOT DISTINCT FROM p_error_code THEN
      RETURN jsonb_build_object(
        'outcome', 'idempotent_replay',
        'business_state', v_run.business_state
      );
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'idempotency_conflict',
      'business_state', v_run.business_state
    );
  END IF;

  UPDATE public.process_swing_dispatch_runs
  SET business_state = p_business_state,
      business_error_code = p_error_code,
      business_diagnostics = CASE
        WHEN p_diagnostics IS NULL THEN NULL
        WHEN pg_column_size(p_diagnostics) <= 65536 THEN p_diagnostics
        ELSE jsonb_build_object('truncated', true)
      END,
      business_completed_at = now(),
      lease_expires_at = now(),
      updated_at = now()
  WHERE run_id = p_run_id;

  INSERT INTO public.process_swing_dispatch_events (
    run_id, request_id, club_id, state, error_code, diagnostics
  ) VALUES (
    p_run_id, p_request_id, p_club_id, p_business_state, p_error_code,
    CASE
      WHEN p_diagnostics IS NULL THEN NULL
      WHEN pg_column_size(p_diagnostics) <= 65536 THEN p_diagnostics
      ELSE jsonb_build_object('truncated', true)
    END
  ) ON CONFLICT (run_id, state) DO NOTHING;

  RETURN jsonb_build_object(
    'outcome', 'recorded',
    'business_state', p_business_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finish_process_swing_dispatch(
  uuid, uuid, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_process_swing_dispatch(
  uuid, uuid, uuid, text, text, jsonb
) TO service_role;

-- Preserve the live due-work predicate from 20270103000001 exactly. The
-- dispatcher below changes only transport shape and scheduling behavior.
CREATE OR REPLACE FUNCTION public.get_process_swing_due_club_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(array_agg(c.id ORDER BY c.id), '{}'::uuid[])
  FROM public.clubs AS c
  JOIN public.club_settings AS cs
    ON cs.club_id = c.id
   AND cs.auto_swing_enabled = true
  WHERE c.status = 'approved'
    AND (
      EXISTS (
        SELECT 1
        FROM public.dealer_assignments AS a
        JOIN public.game_tables AS t ON t.id = a.table_id
        WHERE t.club_id = c.id
          AND t.status = 'active'
          AND a.status = 'assigned'
          AND a.released_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.dealer_attendance AS attendance
        JOIN public.dealers AS d ON d.id = attendance.dealer_id
        WHERE d.club_id = c.id
          AND attendance.status = 'checked_in'
          AND attendance.check_out_time IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.dealer_rotation_schedule AS rotation
        WHERE rotation.club_id = c.id
          AND rotation.status IN ('predicted', 'announced', 'executing')
      )
    );
$$;

REVOKE ALL ON FUNCTION public.get_process_swing_due_club_ids()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_process_swing_due_club_ids()
  TO service_role;

CREATE OR REPLACE FUNCTION public.run_process_swing_cron()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, net, vault
AS $$
DECLARE
  v_url                 text;
  v_secret              text;
  v_due_club_ids        uuid[];
  v_club_id             uuid;
  v_tick_at             timestamptz := date_trunc('minute', clock_timestamp());
  v_run_id              uuid;
  v_request_uuid        uuid;
  v_lease_token         uuid;
  v_fingerprint         text;
  v_net_request_id      bigint;
  v_first_request_id    bigint;
  v_inserted_run_id     uuid;
  v_timeout_ms constant integer := 55000;
BEGIN
  v_due_club_ids := public.get_process_swing_due_club_ids();
  IF cardinality(v_due_club_ids) = 0 THEN
    RETURN NULL;
  END IF;

  v_url := COALESCE(
    NULLIF(current_setting('app.supabase_url', true), ''),
    'https://orlesggcjamwuknxwcpk.supabase.co'
  );

  BEGIN
    SELECT decrypted_secret
      INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'PROCESS_SWING_INTERNAL_SECRET';
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  FOR v_club_id IN
    SELECT due.club_id
    FROM unnest(v_due_club_ids) AS due(club_id)
    LEFT JOIN LATERAL (
      SELECT max(r.requested_at) AS last_dispatched_at
      FROM public.process_swing_dispatch_runs r
      WHERE r.club_id = due.club_id
    ) last_run ON true
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.process_swing_dispatch_runs active_run
      WHERE active_run.club_id = due.club_id
        AND active_run.lease_expires_at > clock_timestamp()
        AND (
          active_run.business_state IS NULL
          OR active_run.business_state IN ('received', 'started')
        )
    )
    ORDER BY last_run.last_dispatched_at NULLS FIRST, due.club_id
    LIMIT 10
  LOOP
    BEGIN
    -- Serialize overlapping cron ticks for this club without locking other
    -- clubs. The request fingerprint also makes same-minute replay idempotent.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('process-swing:' || v_club_id::text, 0)
    );

    IF EXISTS (
      SELECT 1
      FROM public.process_swing_dispatch_runs active_run
      WHERE active_run.club_id = v_club_id
        AND active_run.lease_expires_at > clock_timestamp()
        AND (
          active_run.business_state IS NULL
          OR active_run.business_state IN ('received', 'started')
        )
    ) THEN
      CONTINUE;
    END IF;

    v_run_id := gen_random_uuid();
    v_request_uuid := gen_random_uuid();
    v_lease_token := gen_random_uuid();
    v_inserted_run_id := NULL;
    v_fingerprint := encode(
      digest(
        convert_to(v_club_id::text || ':' || v_tick_at::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

    INSERT INTO public.process_swing_dispatch_runs (
      run_id, request_id, club_id, tick_at, request_fingerprint,
      timeout_ms, lease_token, lease_expires_at
    ) VALUES (
      v_run_id, v_request_uuid, v_club_id, v_tick_at, v_fingerprint,
      v_timeout_ms, v_lease_token,
      clock_timestamp() + ((v_timeout_ms + 60000)::text || ' milliseconds')::interval
    )
    ON CONFLICT (request_fingerprint) DO NOTHING
    RETURNING run_id INTO v_inserted_run_id;

    IF v_inserted_run_id IS NULL THEN
      CONTINUE;
    END IF;

    IF v_secret IS NULL OR btrim(v_secret) = '' THEN
      UPDATE public.process_swing_dispatch_runs
      SET enqueue_state = 'skipped_secret_missing',
          transport_state = 'failed',
          transport_error_code = 'vault_secret_missing',
          response_observed_at = clock_timestamp(),
          lease_expires_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE run_id = v_run_id;
      RAISE LOG 'run_process_swing_cron: Vault secret missing; club request skipped';
      CONTINUE;
    END IF;

    BEGIN
      SELECT net.http_post(
        url := v_url || '/functions/v1/process-swing',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_secret
        ),
        body := jsonb_build_object(
          'club_id', v_club_id,
          'run_id', v_run_id,
          'request_id', v_request_uuid,
          'tick_at', v_tick_at
        ),
        timeout_milliseconds := v_timeout_ms
      ) INTO v_net_request_id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.process_swing_dispatch_runs
      SET enqueue_state = 'enqueue_error',
          transport_state = 'failed',
          transport_error_code = 'enqueue_exception',
          response_observed_at = clock_timestamp(),
          lease_expires_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE run_id = v_run_id;
      RAISE LOG 'run_process_swing_cron: pg_net enqueue exception for club %', v_club_id;
      CONTINUE;
    END;

    IF v_net_request_id IS NULL THEN
      UPDATE public.process_swing_dispatch_runs
      SET enqueue_state = 'enqueue_error',
          transport_state = 'failed',
          transport_error_code = 'enqueue_no_request_id',
          response_observed_at = clock_timestamp(),
          lease_expires_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE run_id = v_run_id;
      CONTINUE;
    END IF;

    UPDATE public.process_swing_dispatch_runs
    SET net_request_id = v_net_request_id,
        enqueue_state = 'enqueued',
        enqueued_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE run_id = v_run_id;

      v_first_request_id := COALESCE(v_first_request_id, v_net_request_id);
    EXCEPTION WHEN OTHERS THEN
      -- A concurrent club delete or unexpected per-club data error must not
      -- prevent unrelated clubs from being enqueued in this tick.
      RAISE LOG 'run_process_swing_cron: isolated dispatch error for club %', v_club_id;
    END;
  END LOOP;

  RETURN v_first_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.run_process_swing_cron()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_process_swing_cron()
  TO service_role;

CREATE OR REPLACE FUNCTION public.observe_process_swing_cron(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, net
SET statement_timeout = '1s'
AS $$
DECLARE
  v_limit       integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_timed_out   integer := 0;
  v_observed    integer := 0;
BEGIN
  -- Expire only the bounded application ledger. This step never touches the
  -- pg_net response table and never changes business_state.
  WITH expired AS MATERIALIZED (
    SELECT run_id
    FROM public.process_swing_dispatch_runs
    WHERE transport_state = 'pending'
      AND requested_at
          + ((timeout_ms + 30000)::text || ' milliseconds')::interval
          < clock_timestamp()
    ORDER BY requested_at, run_id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.process_swing_dispatch_runs AS r
  SET transport_state = 'timed_out',
      transport_error_code = 'transport_timeout',
      response_observed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  FROM expired
  WHERE r.run_id = expired.run_id;
  GET DIAGNOSTICS v_timed_out = ROW_COUNT;

  -- Restrict the internal pg_net read by application ids, a ten-minute created
  -- window, and a hard row limit. Transport outcome is deliberately independent
  -- from the Edge function's business outcome.
  WITH pending AS MATERIALIZED (
    SELECT run_id, net_request_id
    FROM public.process_swing_dispatch_runs
    WHERE transport_state = 'pending'
      AND requested_at >= clock_timestamp() - interval '10 minutes'
      AND net_request_id IS NOT NULL
    ORDER BY requested_at, run_id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ), observed AS MATERIALIZED (
    SELECT pending.run_id, response.status_code, response.timed_out
    FROM pending
    JOIN net._http_response AS response
      ON response.id = pending.net_request_id
     AND response.created >= clock_timestamp() - interval '10 minutes'
  )
  UPDATE public.process_swing_dispatch_runs AS r
  SET response_status = observed.status_code,
      response_observed_at = clock_timestamp(),
      transport_state = CASE
        WHEN observed.timed_out OR observed.status_code IS NULL THEN 'timed_out'
        WHEN observed.status_code BETWEEN 200 AND 299 THEN 'succeeded'
        ELSE 'failed'
      END,
      transport_error_code = CASE
        WHEN observed.timed_out OR observed.status_code IS NULL THEN 'transport_timeout'
        WHEN observed.status_code = 401 THEN 'http_401'
        WHEN observed.status_code = 403 THEN 'http_403'
        WHEN observed.status_code BETWEEN 400 AND 499 THEN 'http_4xx'
        WHEN observed.status_code BETWEEN 500 AND 599 THEN 'http_5xx'
        WHEN observed.status_code BETWEEN 200 AND 299 THEN NULL
        ELSE 'http_non_2xx'
      END,
      updated_at = clock_timestamp()
  FROM observed
  WHERE r.run_id = observed.run_id;
  GET DIAGNOSTICS v_observed = ROW_COUNT;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'observed', v_observed,
    'timed_out', v_timed_out
  );
END;
$$;

REVOKE ALL ON FUNCTION public.observe_process_swing_cron(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.observe_process_swing_cron(integer)
  TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing') THEN
    PERFORM cron.unschedule('process-swing');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing-auto') THEN
    PERFORM cron.unschedule('process-swing-auto');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-swing-observer') THEN
    PERFORM cron.unschedule('process-swing-observer');
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-swing',
  '* * * * *',
  $$SELECT public.run_process_swing_cron();$$
);

SELECT cron.schedule(
  'process-swing-observer',
  '* * * * *',
  $$SELECT public.observe_process_swing_cron(100);$$
);

COMMIT;
