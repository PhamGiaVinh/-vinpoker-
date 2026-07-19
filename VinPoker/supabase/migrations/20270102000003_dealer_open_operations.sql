-- ============================================================================
-- P1 Dealer Swing: durable, idempotent mass-open operations.
--
-- SOURCE ONLY. Runtime rollout is disabled and has an empty allowlist. This
-- migration must not be applied outside a controlled owner window.
--
-- ROLLBACK (only while the runtime master is OFF):
--   DROP TRIGGER IF EXISTS trg_dealer_open_assignment_refresh ON public.dealer_assignments;
--   DROP TRIGGER IF EXISTS trg_dealer_open_close_marker ON public.game_tables;
--   DROP TRIGGER IF EXISTS trg_dealer_open_close_refresh ON public.game_tables;
--   DROP FUNCTION IF EXISTS public.operator_open_dealer_tables(uuid,uuid,uuid,uuid[],text);
--   DROP FUNCTION IF EXISTS public.get_dealer_open_operation(uuid,uuid);
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

COMMIT;
