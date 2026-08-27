-- ============================================================================
-- Floor Table Control V3 — caller-bound server contract (SOURCE-ONLY / RED)
-- ============================================================================
-- Depends on: 20270113000002_floor_table_control_v3_foundation.sql
--
-- This migration deliberately does not backfill, repair, delete, deploy Edge,
-- or enable a client feature flag.  It makes the V3 writer contract available
-- only after every historical tournament-table row has an exact explicit
-- game-table/session mapping.  Existing legacy readers and writers remain
-- untouched until the later writer-convergence/cutover PRs.
--
-- ROLLBACK (owner-gated, only before V3 writers are cut over): revoke the V3
-- public functions and restore the exact, catalog-recorded legacy unique
-- constraint after a verified schema/data receipt.  Never recreate it by
-- guessing its historical name.
-- ============================================================================

BEGIN;

-- New V3 rows intentionally leave the mixed-identity legacy table_id columns
-- NULL.  Their authoritative relationships are the explicit V3 columns added
-- by the foundation migration.  Keeping the columns themselves preserves
-- legacy reads during the transition; changing their meaning would not.
ALTER TABLE public.tournament_tables
  ALTER COLUMN table_id DROP NOT NULL;
ALTER TABLE public.tournament_seats
  ALTER COLUMN table_id DROP NOT NULL;
ALTER TABLE public.tournament_hands
  ALTER COLUMN table_id DROP NOT NULL;

-- A V3 assignment is one-to-one with a table session.  The active physical
-- lease is already enforced by table_sessions in the foundation migration.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_tables_one_session_v3
  ON public.tournament_tables (table_session_id)
  WHERE table_session_id IS NOT NULL;

-- The historical UNIQUE(tournament_tables.table_id) makes a physical table
-- unusable for Tour B after it was ever used by Tour A.  Remove only that
-- exact single-column legacy constraint, and only after all rows that would
-- survive the transition have explicit, internally consistent V3 identities.
-- This is catalog-targeted constraint replacement, not a broad quarantine.
DO $$
DECLARE
  v_legacy_constraint text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    LEFT JOIN public.table_sessions session_row
      ON session_row.id = tt.table_session_id
    WHERE tt.table_id IS NOT NULL
      AND (
        tt.game_table_id IS NULL
        OR tt.table_session_id IS NULL
        OR session_row.id IS NULL
        OR session_row.game_table_id IS DISTINCT FROM tt.game_table_id
        OR session_row.tournament_id IS DISTINCT FROM tt.tournament_id
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'floor_table_v3_legacy_assignment_preflight_failed',
      DETAIL = 'Repair exact unmapped tournament-table IDs through the owner-gated V3 runbook before applying this migration.';
  END IF;

  FOR v_legacy_constraint IN
    SELECT c.conname
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.tournament_tables'::regclass
      AND c.contype = 'u'
      AND ARRAY(
        SELECT a.attname
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = c.conrelid
          AND a.attnum = ANY(c.conkey)
        ORDER BY a.attnum
      ) = ARRAY['table_id']
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.tournament_tables DROP CONSTRAINT %I',
      v_legacy_constraint
    );
  END LOOP;
END;
$$;

CREATE SCHEMA IF NOT EXISTS floor_private;
REVOKE ALL ON SCHEMA floor_private FROM PUBLIC, anon, authenticated, service_role;

-- Internal helpers are deliberately not granted to browser roles.  Public V3
-- RPCs derive actor/club server-side and call these helpers transactionally.
CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_actor_is_tournament_operator(
  p_actor_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor_id IS NOT NULL
     AND p_club_id IS NOT NULL
     AND (
       EXISTS (
         SELECT 1
         FROM public.clubs c
         WHERE c.id = p_club_id
           AND c.owner_id = p_actor_id
       )
       OR public.is_club_floor(p_actor_id, p_club_id)
       OR EXISTS (
         SELECT 1
         FROM public.club_cashiers cc
         WHERE cc.club_id = p_club_id
           AND cc.user_id = p_actor_id
       )
       OR public.has_role(p_actor_id, 'super_admin'::public.app_role)
     );
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_actor_is_dealer_operator(
  p_actor_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_actor_id IS NOT NULL
     AND p_club_id IS NOT NULL
     AND (
       EXISTS (
         SELECT 1
         FROM public.clubs c
         WHERE c.id = p_club_id
           AND c.owner_id = p_actor_id
       )
       OR public.is_club_dealer_control(p_actor_id, p_club_id)
       OR public.has_role(p_actor_id, 'super_admin'::public.app_role)
     );
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_lock_receipt(
  p_actor_id uuid,
  p_operation_type text,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor_id IS NULL OR p_operation_type IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'invalid_idempotency_request';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_actor_id::text || ':' || p_operation_type || ':' || p_request_id::text,
      0
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_existing_receipt(
  p_actor_id uuid,
  p_operation_type text,
  p_request_id uuid
)
RETURNS TABLE(request_fingerprint text, result jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT receipt.request_fingerprint, receipt.result
  FROM public.table_operation_receipts receipt
  WHERE receipt.actor_id = p_actor_id
    AND receipt.operation_type = p_operation_type
    AND receipt.request_id = p_request_id;
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_save_receipt(
  p_actor_id uuid,
  p_operation_type text,
  p_request_id uuid,
  p_request_fingerprint text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.table_operation_receipts (
    actor_id,
    operation_type,
    request_id,
    request_fingerprint,
    result
  ) VALUES (
    p_actor_id,
    p_operation_type,
    p_request_id,
    p_request_fingerprint,
    p_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_has_active_hand(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_table_session_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_hands hand_row
    WHERE hand_row.tournament_id = p_tournament_id
      AND hand_row.status = 'in_progress'
      AND (
        hand_row.tournament_table_id = p_tournament_table_id
        OR hand_row.table_session_id = p_table_session_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION floor_private.floor_table_v3_assert_tracker_context(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_table_session_id uuid,
  p_control_epoch bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_tables tt
    JOIN public.table_sessions session_row
      ON session_row.id = tt.table_session_id
    WHERE tt.id = p_tournament_table_id
      AND tt.tournament_id = p_tournament_id
      AND tt.table_session_id = p_table_session_id
      AND tt.status = 'active'
      AND session_row.closed_at IS NULL
      AND session_row.session_type = 'tournament'
      AND session_row.control_mode = 'tracker'
      AND session_row.control_epoch = p_control_epoch
  );
$$;

ALTER FUNCTION floor_private.floor_table_v3_actor_is_tournament_operator(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_table_v3_actor_is_dealer_operator(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_table_v3_lock_receipt(uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_table_v3_existing_receipt(uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_table_v3_save_receipt(uuid, text, uuid, text, jsonb) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_table_v3_has_active_hand(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION floor_private.floor_table_v3_assert_tracker_context(uuid, uuid, uuid, bigint) OWNER TO postgres;

REVOKE ALL ON FUNCTION floor_private.floor_table_v3_actor_is_tournament_operator(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.floor_table_v3_actor_is_dealer_operator(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.floor_table_v3_lock_receipt(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.floor_table_v3_existing_receipt(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.floor_table_v3_save_receipt(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.floor_table_v3_has_active_hand(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.floor_table_v3_assert_tracker_context(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Shared Floor/Dealer Swing inventory.  This read does not expose a route to
-- mutate game_tables directly; availability is derived from operational state
-- and an active session lease.
CREATE OR REPLACE FUNCTION public.get_club_table_inventory(
  p_club_id uuid
)
RETURNS TABLE(
  game_table_id uuid,
  table_number integer,
  table_name text,
  operational_status text,
  availability_status text,
  table_session_id uuid,
  session_type text,
  control_mode text,
  control_epoch bigint,
  revision bigint,
  tournament_id uuid,
  tournament_table_id uuid,
  tournament_table_status text,
  active_dealer_assignment_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NOT (
    floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, p_club_id)
    OR floor_private.floor_table_v3_actor_is_dealer_operator(v_actor, p_club_id)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    gt.id,
    gt.table_number,
    gt.table_name,
    gt.operational_status,
    CASE
      WHEN gt.operational_status IS NULL THEN 'preflight_required'
      WHEN gt.operational_status <> 'available' THEN gt.operational_status
      WHEN session_row.id IS NOT NULL THEN 'in_use'
      ELSE 'available'
    END,
    session_row.id,
    session_row.session_type,
    session_row.control_mode,
    session_row.control_epoch,
    session_row.revision,
    session_row.tournament_id,
    tt.id,
    tt.status,
    dealer_assignment.id
  FROM public.game_tables gt
  LEFT JOIN LATERAL (
    SELECT session_item.*
    FROM public.table_sessions session_item
    WHERE session_item.game_table_id = gt.id
      AND session_item.closed_at IS NULL
    ORDER BY session_item.opened_at DESC, session_item.id DESC
    LIMIT 1
  ) session_row ON true
  LEFT JOIN LATERAL (
    SELECT assignment_item.*
    FROM public.tournament_tables assignment_item
    WHERE assignment_item.table_session_id = session_row.id
    ORDER BY assignment_item.created_at DESC, assignment_item.id DESC
    LIMIT 1
  ) tt ON true
  LEFT JOIN LATERAL (
    SELECT da.id
    FROM public.dealer_assignments da
    WHERE da.table_session_id = session_row.id
      AND da.released_at IS NULL
      AND da.status IN ('assigned', 'on_break')
    ORDER BY da.assigned_at DESC, da.id DESC
    LIMIT 1
  ) dealer_assignment ON true
  WHERE gt.club_id = p_club_id
  ORDER BY gt.table_number NULLS LAST, gt.table_name, gt.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_open_tournament_table_v3(
  p_tournament_id uuid,
  p_game_table_id uuid,
  p_control_mode text,
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
  v_game_table public.game_tables%ROWTYPE;
  v_session_id uuid;
  v_tournament_table_id uuid;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_tournament_id IS NULL
     OR p_game_table_id IS NULL
     OR p_request_id IS NULL
     OR p_control_mode NOT IN ('manual', 'tracker') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_id', p_tournament_id,
    'game_table_id', p_game_table_id,
    'control_mode', p_control_mode
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_open_tournament_table_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_open_tournament_table_v3', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'tournament_not_open', 'status', v_tournament.status
    );
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT * INTO v_game_table
  FROM public.game_tables
  WHERE id = p_game_table_id
    AND club_id = v_tournament.club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  IF v_game_table.operational_status IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_preflight_required');
  END IF;
  IF v_game_table.operational_status <> 'available' THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'game_table_not_available',
      'operational_status', v_game_table.operational_status
    );
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.table_sessions active_session
    WHERE active_session.game_table_id = v_game_table.id
      AND active_session.closed_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_in_use');
  END IF;

  BEGIN
    INSERT INTO public.table_sessions (
      club_id,
      game_table_id,
      session_type,
      tournament_id,
      control_mode,
      control_epoch,
      revision,
      opened_by
    ) VALUES (
      v_tournament.club_id,
      v_game_table.id,
      'tournament',
      v_tournament.id,
      p_control_mode,
      1,
      1,
      v_actor
    )
    RETURNING id INTO v_session_id;

    INSERT INTO public.tournament_tables (
      tournament_id,
      game_table_id,
      table_session_id,
      table_number,
      max_seats,
      status
    ) VALUES (
      v_tournament.id,
      v_game_table.id,
      v_session_id,
      v_game_table.table_number,
      9,
      'active'
    )
    RETURNING id INTO v_tournament_table_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_in_use');
  END;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'tournament_id', v_tournament.id,
    'tournament_table_id', v_tournament_table_id,
    'table_session_id', v_session_id,
    'game_table_id', v_game_table.id,
    'table_number', v_game_table.table_number,
    'control_mode', p_control_mode,
    'control_epoch', 1,
    'revision', 1
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_open_tournament_table_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

-- Dealer Swing opens Cash/VIP through the same physical-table lease.  A
-- tournament session is intentionally excluded here: it must be opened by
-- floor_open_tournament_table_v3 with a concrete tournament.
CREATE OR REPLACE FUNCTION public.operator_open_club_tables_v2(
  p_game_table_ids uuid[],
  p_session_type text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_table_ids uuid[];
  v_club_id uuid;
  v_distinct_clubs integer;
  v_locked_count integer;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_request_id IS NULL
     OR p_session_type NOT IN ('cash', 'vip')
     OR p_game_table_ids IS NULL
     OR pg_catalog.cardinality(p_game_table_ids) IS NULL
     OR pg_catalog.cardinality(p_game_table_ids) = 0
     OR pg_catalog.cardinality(p_game_table_ids) > 50
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_game_table_ids) item WHERE item IS NULL) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT pg_catalog.array_agg(DISTINCT item ORDER BY item)
  INTO v_table_ids
  FROM pg_catalog.unnest(p_game_table_ids) item;
  IF pg_catalog.cardinality(v_table_ids) <> pg_catalog.cardinality(p_game_table_ids) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'duplicate_game_table_id');
  END IF;

  SELECT
    pg_catalog.count(DISTINCT gt.club_id),
    (pg_catalog.array_agg(DISTINCT gt.club_id))[1]
  INTO v_distinct_clubs, v_club_id
  FROM public.game_tables gt
  WHERE gt.id = ANY(v_table_ids);
  IF v_distinct_clubs <> 1
     OR (SELECT pg_catalog.count(*) FROM public.game_tables gt WHERE gt.id = ANY(v_table_ids))
        <> pg_catalog.cardinality(v_table_ids) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_dealer_operator(v_actor, v_club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'game_table_ids', pg_catalog.to_jsonb(v_table_ids),
    'session_type', p_session_type
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'operator_open_club_tables_v2', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'operator_open_club_tables_v2', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  -- Canonical physical-table lock order prevents A:5→6 versus B:6→5 cycles.
  PERFORM 1
  FROM public.game_tables gt
  WHERE gt.id = ANY(v_table_ids)
  ORDER BY gt.id
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_count = ROW_COUNT;
  IF v_locked_count <> pg_catalog.cardinality(v_table_ids) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.game_tables gt
    WHERE gt.id = ANY(v_table_ids)
      AND gt.operational_status IS DISTINCT FROM 'available'
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_not_available');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.table_sessions session_row
    WHERE session_row.game_table_id = ANY(v_table_ids)
      AND session_row.closed_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_in_use');
  END IF;

  BEGIN
    WITH opened AS (
      INSERT INTO public.table_sessions (
        club_id,
        game_table_id,
        session_type,
        control_mode,
        control_epoch,
        revision,
        opened_by
      )
      SELECT
        v_club_id,
        gt.id,
        p_session_type,
        'manual',
        1,
        1,
        v_actor
      FROM public.game_tables gt
      WHERE gt.id = ANY(v_table_ids)
      ORDER BY gt.id
      RETURNING id, game_table_id, session_type, control_mode, control_epoch, revision
    )
    SELECT pg_catalog.jsonb_build_object(
      'ok', true,
      'club_id', v_club_id,
      'sessions', pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'table_session_id', opened.id,
          'game_table_id', opened.game_table_id,
          'session_type', opened.session_type,
          'control_mode', opened.control_mode,
          'control_epoch', opened.control_epoch,
          'revision', opened.revision
        ) ORDER BY opened.game_table_id
      )
    )
    INTO v_result
    FROM opened;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_in_use');
  END;

  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'operator_open_club_tables_v2', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

-- Cash/VIP sessions have no tournament assignment to close, but they still
-- hold the same physical-table lease. Dealer Swing therefore releases them
-- through this caller-bound companion rather than updating game_tables.
CREATE OR REPLACE FUNCTION public.operator_close_club_table_v2(
  p_table_session_id uuid,
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
  v_session public.table_sessions%ROWTYPE;
  v_game_table public.game_tables%ROWTYPE;
  v_game_table_id uuid;
  v_club_id uuid;
  v_next_revision bigint;
  v_released_dealers integer := 0;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_table_session_id IS NULL
     OR p_expected_revision IS NULL
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'table_session_id', p_table_session_id,
    'expected_revision', p_expected_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'operator_close_club_table_v2', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'operator_close_club_table_v2', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  -- Resolve the immutable session identity without locking it, then acquire
  -- the physical table before its session row to preserve the global lock
  -- order: physical table -> session.
  SELECT session_row.game_table_id, session_row.club_id
  INTO v_game_table_id, v_club_id
  FROM public.table_sessions session_row
  WHERE session_row.id = p_table_session_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active');
  END IF;
  SELECT * INTO v_game_table
  FROM public.game_tables gt
  WHERE gt.id = v_game_table_id
    AND gt.club_id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  SELECT * INTO v_session
  FROM public.table_sessions session_row
  WHERE session_row.id = p_table_session_id
  FOR UPDATE;
  IF NOT FOUND OR v_session.closed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active');
  END IF;
  IF v_session.game_table_id IS DISTINCT FROM v_game_table.id
     OR v_session.club_id IS DISTINCT FROM v_game_table.club_id
     OR v_session.session_type NOT IN ('cash', 'vip')
     OR v_session.tournament_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'operator_session_type_required');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_dealer_operator(v_actor, v_game_table.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF v_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'STALE_STATE', 'current_revision', v_session.revision
    );
  END IF;

  UPDATE public.dealer_assignments
  SET released_at = COALESCE(released_at, pg_catalog.now()),
      status = CASE WHEN status IN ('assigned', 'on_break') THEN 'completed' ELSE status END
  WHERE table_session_id = v_session.id
    AND released_at IS NULL;
  GET DIAGNOSTICS v_released_dealers = ROW_COUNT;

  UPDATE public.table_sessions
  SET closed_at = pg_catalog.now(),
      closed_by = v_actor,
      revision = revision + 1
  WHERE id = v_session.id
    AND closed_at IS NULL
    AND revision = p_expected_revision
  RETURNING revision INTO v_next_revision;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'closed', true,
    'table_session_id', v_session.id,
    'game_table_id', v_game_table.id,
    'dealer_assignments_released', v_released_dealers,
    'revision', v_next_revision
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'operator_close_club_table_v2', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

-- The entry picker never creates a name/player.  It only returns existing,
-- registered entries for this tournament that do not already own an active
-- seat.  The active V3 seat is authoritative for current placement.
CREATE OR REPLACE FUNCTION public.get_floor_seatable_entries(
  p_tournament_id uuid
)
RETURNS TABLE(
  entry_id uuid,
  player_id uuid,
  entry_no integer,
  display_name text,
  current_stack integer,
  registration_id uuid
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
  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND
     OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    entry_row.id,
    entry_row.player_id,
    entry_row.entry_no,
    COALESCE(profile_row.display_name, entry_row.player_id::text),
    entry_row.current_stack,
    entry_row.registration_id
  FROM public.tournament_entries entry_row
  LEFT JOIN public.profiles profile_row
    ON profile_row.user_id = entry_row.player_id
  WHERE entry_row.tournament_id = p_tournament_id
    AND entry_row.status = 'registered'
    AND entry_row.registration_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.tournament_seats active_seat
      WHERE active_seat.entry_id = entry_row.id
        AND active_seat.tournament_id = entry_row.tournament_id
        AND active_seat.is_active
    )
  ORDER BY entry_row.entry_no, entry_row.id;
END;
$$;

-- This is a read/validation seam for the future Tracker writer convergence.
-- The writer PR must call the private assertion in its same DB transaction;
-- merely reading this context never authorizes a stale write.
CREATE OR REPLACE FUNCTION public.validate_tracker_table_writer_context_v3(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_table_session_id uuid,
  p_control_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_allowed boolean;
BEGIN
  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND OR v_actor IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT (
    floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_club_id)
    OR EXISTS (
      SELECT 1
      FROM public.club_trackers tracker_member
      WHERE tracker_member.club_id = v_club_id
        AND tracker_member.user_id = v_actor
    )
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF NOT floor_private.floor_table_v3_assert_tracker_context(
    p_tournament_id,
    p_tournament_table_id,
    p_table_session_id,
    p_control_epoch
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_TRACKER_CONTEXT');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'table_session_id', p_table_session_id,
    'control_epoch', p_control_epoch
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_assign_entry_to_seat(
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
  v_entry_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_game_table_id uuid;
  v_session public.table_sessions%ROWTYPE;
  v_tournament_table public.tournament_tables%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_seat_id uuid;
  v_next_revision bigint;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_entry_id IS NULL
     OR p_tournament_table_id IS NULL
     OR p_seat_number IS NULL
     OR p_expected_revision IS NULL
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT entry_row.tournament_id INTO v_entry_tournament_id
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'entry_id', p_entry_id,
    'tournament_table_id', p_tournament_table_id,
    'seat_number', p_seat_number,
    'expected_revision', p_expected_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_assign_entry_to_seat', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'floor_assign_entry_to_seat', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = v_entry_tournament_id
  FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT tt.game_table_id INTO v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tournament.id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  PERFORM 1
  FROM public.game_tables gt
  WHERE gt.id = v_game_table_id
    AND gt.club_id = v_tournament.club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  SELECT * INTO v_session
  FROM public.table_sessions session_row
  WHERE session_row.game_table_id = v_game_table_id
    AND session_row.closed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active');
  END IF;
  SELECT * INTO v_tournament_table
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tournament.id
    AND tt.game_table_id = v_game_table_id
    AND tt.table_session_id = v_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  IF v_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'STALE_STATE', 'current_revision', v_session.revision
    );
  END IF;
  IF p_seat_number < 1 OR p_seat_number > 9 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_tournament_table.id, v_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  IF v_entry.status <> 'registered' OR v_entry.registration_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_seatable');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_seats active_seat
    WHERE active_seat.tournament_id = v_tournament.id
      AND active_seat.entry_id = v_entry.id
      AND active_seat.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_already_seated');
  END IF;

  BEGIN
    UPDATE public.table_sessions
    SET revision = revision + 1
    WHERE id = v_session.id
      AND revision = p_expected_revision
    RETURNING revision INTO v_next_revision;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
    END IF;

    INSERT INTO public.tournament_seats (
      tournament_id,
      player_id,
      entry_number,
      tournament_table_id,
      table_session_id,
      seat_number,
      chip_count,
      is_active,
      entry_id,
      status,
      assigned_by,
      assigned_at
    ) VALUES (
      v_tournament.id,
      v_entry.player_id,
      v_entry.entry_no,
      v_tournament_table.id,
      v_session.id,
      p_seat_number,
      v_entry.current_stack,
      true,
      v_entry.id,
      'active',
      v_actor,
      pg_catalog.now()
    )
    RETURNING id INTO v_seat_id;

    UPDATE public.tournament_entries
    SET status = 'seated',
        seated_at = COALESCE(seated_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
    WHERE id = v_entry.id
      AND status = 'registered';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entry_state_changed';
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'entry_id', v_entry.id,
    'seat_id', v_seat_id,
    'tournament_table_id', v_tournament_table.id,
    'table_session_id', v_session.id,
    'seat_number', p_seat_number,
    'revision', v_next_revision
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_assign_entry_to_seat', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_set_table_control_mode_v3(
  p_tournament_table_id uuid,
  p_control_mode text,
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
  v_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_game_table_id uuid;
  v_session public.table_sessions%ROWTYPE;
  v_tournament_table public.tournament_tables%ROWTYPE;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_tournament_table_id IS NULL
     OR p_expected_revision IS NULL
     OR p_request_id IS NULL
     OR p_control_mode NOT IN ('manual', 'tracker') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT tt.tournament_id, tt.game_table_id
  INTO v_tournament_id, v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_table_id', p_tournament_table_id,
    'control_mode', p_control_mode,
    'expected_revision', p_expected_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_set_table_control_mode_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'floor_set_table_control_mode_v3', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = v_game_table_id AND gt.club_id = v_tournament.club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  SELECT * INTO v_session FROM public.table_sessions session_row
  WHERE session_row.game_table_id = v_game_table_id AND session_row.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active');
  END IF;
  SELECT * INTO v_tournament_table FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tournament.id
    AND tt.table_session_id = v_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  IF v_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE', 'current_revision', v_session.revision);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats seat_row
    WHERE seat_row.tournament_table_id = v_tournament_table.id
      AND seat_row.table_session_id = v_session.id
      AND seat_row.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_empty');
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_tournament_table.id, v_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  IF v_session.control_mode = p_control_mode THEN
    v_result := pg_catalog.jsonb_build_object(
      'ok', true, 'unchanged', true,
      'tournament_table_id', v_tournament_table.id,
      'table_session_id', v_session.id,
      'control_mode', v_session.control_mode,
      'control_epoch', v_session.control_epoch,
      'revision', v_session.revision
    );
  ELSE
    UPDATE public.table_sessions
    SET control_mode = p_control_mode,
        control_epoch = control_epoch + 1,
        revision = revision + 1
    WHERE id = v_session.id
      AND revision = p_expected_revision
    RETURNING control_epoch, revision INTO v_session.control_epoch, v_session.revision;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
    END IF;
    v_result := pg_catalog.jsonb_build_object(
      'ok', true,
      'tournament_table_id', v_tournament_table.id,
      'table_session_id', v_session.id,
      'control_mode', p_control_mode,
      'control_epoch', v_session.control_epoch,
      'revision', v_session.revision
    );
  END IF;

  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_set_table_control_mode_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_player_seat_v2(
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
  v_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_source_seat public.tournament_seats%ROWTYPE;
  v_source_table public.tournament_tables%ROWTYPE;
  v_destination_table public.tournament_tables%ROWTYPE;
  v_source_session public.table_sessions%ROWTYPE;
  v_destination_session public.table_sessions%ROWTYPE;
  v_new_seat_id uuid;
  v_source_revision bigint;
  v_destination_revision bigint;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_entry_id IS NULL
     OR p_to_tournament_table_id IS NULL
     OR p_to_seat_number IS NULL
     OR p_expected_source_revision IS NULL
     OR p_expected_destination_revision IS NULL
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT entry_row.tournament_id INTO v_tournament_id
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'entry_id', p_entry_id,
    'to_tournament_table_id', p_to_tournament_table_id,
    'to_seat_number', p_to_seat_number,
    'expected_source_revision', p_expected_source_revision,
    'expected_destination_revision', p_expected_destination_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'move_player_seat_v2', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'move_player_seat_v2', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Discovery reads stay unlocked until the deterministic physical/session
  -- locks below are held; the entry and seat are locked and revalidated last.
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id;
  IF NOT FOUND OR v_entry.status <> 'seated' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_seated');
  END IF;
  SELECT * INTO v_source_seat
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.entry_id = v_entry.id
    AND seat_row.is_active
    AND seat_row.tournament_table_id IS NOT NULL
    AND seat_row.table_session_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_seat');
  END IF;

  SELECT * INTO v_source_table
  FROM public.tournament_tables tt
  WHERE tt.id = v_source_seat.tournament_table_id
    AND tt.tournament_id = v_tournament.id;
  SELECT * INTO v_destination_table
  FROM public.tournament_tables tt
  WHERE tt.id = p_to_tournament_table_id
    AND tt.tournament_id = v_tournament.id;
  IF NOT FOUND OR v_source_table.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;

  -- Lock physical inventory in deterministic UUID order before the session,
  -- assignment, entry and seat rows that follow.
  PERFORM 1
  FROM public.game_tables gt
  WHERE gt.id IN (v_source_table.game_table_id, v_destination_table.game_table_id)
    AND gt.club_id = v_tournament.club_id
  ORDER BY gt.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  -- All involved sessions are locked only after their physical tables, and
  -- in that same physical-table order.  This avoids A:5->6 / B:6->5 cycles.
  PERFORM 1
  FROM public.table_sessions session_row
  JOIN public.game_tables gt ON gt.id = session_row.game_table_id
  WHERE session_row.id IN (v_source_seat.table_session_id, v_destination_table.table_session_id)
  ORDER BY gt.id, session_row.id
  FOR UPDATE;
  SELECT * INTO v_source_session
  FROM public.table_sessions session_row
  WHERE session_row.id = v_source_seat.table_session_id;
  SELECT * INTO v_destination_session
  FROM public.table_sessions session_row
  WHERE session_row.id = v_destination_table.table_session_id;
  IF v_source_session.id IS NULL
     OR v_destination_session.id IS NULL
     OR v_source_session.closed_at IS NOT NULL
     OR v_destination_session.closed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active');
  END IF;
  SELECT * INTO v_source_table
  FROM public.tournament_tables tt
  WHERE tt.id = v_source_table.id
    AND tt.table_session_id = v_source_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  SELECT * INTO v_destination_table
  FROM public.tournament_tables tt
  WHERE tt.id = v_destination_table.id
    AND tt.table_session_id = v_destination_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  IF v_source_table.id IS NULL OR v_destination_table.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  -- Entry/seat locks are deliberately last in the documented lock order.
  -- Re-read after inventory/session/assignment locks so a concurrent move or
  -- bust cannot turn the earlier discovery read into a stale mutation.
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id
  FOR UPDATE;
  IF NOT FOUND OR v_entry.status <> 'seated' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_seated');
  END IF;
  SELECT * INTO v_source_seat
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.entry_id = v_entry.id
    AND seat_row.is_active
    AND seat_row.tournament_table_id = v_source_table.id
    AND seat_row.table_session_id = v_source_session.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_seat');
  END IF;
  IF p_to_seat_number < 1 OR p_to_seat_number > 9 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF v_source_session.revision <> p_expected_source_revision
     OR v_destination_session.revision <> p_expected_destination_revision THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'STALE_STATE',
      'source_revision', v_source_session.revision,
      'destination_revision', v_destination_session.revision
    );
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_source_table.id, v_source_session.id)
     OR floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_destination_table.id, v_destination_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;
  IF v_source_table.id = v_destination_table.id
     AND v_source_seat.seat_number = p_to_seat_number THEN
    v_result := pg_catalog.jsonb_build_object(
      'ok', true, 'already_there', true,
      'entry_id', v_entry.id,
      'tournament_table_id', v_source_table.id,
      'table_session_id', v_source_session.id,
      'seat_number', v_source_seat.seat_number,
      'revision', v_source_session.revision
    );
    PERFORM floor_private.floor_table_v3_save_receipt(
      v_actor, 'move_player_seat_v2', p_request_id, v_fingerprint, v_result
    );
    RETURN v_result;
  END IF;

  BEGIN
    IF v_source_session.id = v_destination_session.id THEN
      UPDATE public.table_sessions
      SET revision = revision + 1
      WHERE id = v_source_session.id
        AND revision = p_expected_source_revision
      RETURNING revision INTO v_source_revision;
      IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
      END IF;
      v_destination_revision := v_source_revision;
    ELSE
      UPDATE public.table_sessions
      SET revision = revision + 1
      WHERE id = v_source_session.id
        AND revision = p_expected_source_revision
      RETURNING revision INTO v_source_revision;
      IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
      END IF;
      UPDATE public.table_sessions
      SET revision = revision + 1
      WHERE id = v_destination_session.id
        AND revision = p_expected_destination_revision
      RETURNING revision INTO v_destination_revision;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE';
      END IF;
    END IF;

    UPDATE public.tournament_seats
    SET is_active = false,
        status = 'moved'
    WHERE id = v_source_seat.id
      AND is_active;
    INSERT INTO public.tournament_seats (
      tournament_id,
      player_id,
      entry_number,
      tournament_table_id,
      table_session_id,
      seat_number,
      chip_count,
      is_active,
      entry_id,
      status,
      assigned_by,
      assigned_at
    ) VALUES (
      v_tournament.id,
      v_entry.player_id,
      v_entry.entry_no,
      v_destination_table.id,
      v_destination_session.id,
      p_to_seat_number,
      v_source_seat.chip_count,
      true,
      v_entry.id,
      'active',
      v_actor,
      pg_catalog.now()
    )
    RETURNING id INTO v_new_seat_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'entry_id', v_entry.id,
    'from_tournament_table_id', v_source_table.id,
    'from_table_session_id', v_source_session.id,
    'from_seat_number', v_source_seat.seat_number,
    'to_tournament_table_id', v_destination_table.id,
    'to_table_session_id', v_destination_session.id,
    'to_seat_number', p_to_seat_number,
    'seat_id', v_new_seat_id,
    'source_revision', v_source_revision,
    'destination_revision', v_destination_revision
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'move_player_seat_v2', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

-- Close is intentionally narrow: it only succeeds for an empty V3 table with
-- no active hand.  "Đóng & chuyển người" is floor_break_table_v3 below so
-- capacity, all moves, dealer release and session close are one transaction.
CREATE OR REPLACE FUNCTION public.close_tournament_table_v3(
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
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_game_table_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
  v_tournament_table public.tournament_tables%ROWTYPE;
  v_released_dealers integer := 0;
  v_next_revision bigint;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_tournament_table_id IS NULL
     OR p_expected_revision IS NULL
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT tt.tournament_id, tt.game_table_id
  INTO v_tournament_id, v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_table_id', p_tournament_table_id,
    'expected_revision', p_expected_revision
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'close_tournament_table_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'close_tournament_table_v3', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = v_game_table_id AND gt.club_id = v_tournament.club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  SELECT * INTO v_session FROM public.table_sessions session_row
  WHERE session_row.game_table_id = v_game_table_id AND session_row.closed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_not_active');
  END IF;
  SELECT * INTO v_tournament_table FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tournament.id
    AND tt.table_session_id = v_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  IF NOT FOUND OR v_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  IF v_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE', 'current_revision', v_session.revision);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats seat_row
    WHERE seat_row.tournament_table_id = v_tournament_table.id
      AND seat_row.table_session_id = v_session.id
      AND seat_row.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_empty');
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_tournament_table.id, v_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  UPDATE public.dealer_assignments
  SET released_at = COALESCE(released_at, pg_catalog.now()),
      status = CASE WHEN status IN ('assigned', 'on_break') THEN 'completed' ELSE status END
  WHERE table_session_id = v_session.id
    AND released_at IS NULL;
  GET DIAGNOSTICS v_released_dealers = ROW_COUNT;

  UPDATE public.tournament_tables
  SET status = 'closed'
  WHERE id = v_tournament_table.id
    AND status = 'active';
  UPDATE public.table_sessions
  SET closed_at = pg_catalog.now(),
      closed_by = v_actor,
      revision = revision + 1
  WHERE id = v_session.id
    AND revision = p_expected_revision
    AND closed_at IS NULL
  RETURNING revision INTO v_next_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE';
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'closed', true,
    'tournament_table_id', v_tournament_table.id,
    'table_session_id', v_session.id,
    'game_table_id', v_game_table_id,
    'revision', v_next_revision,
    'dealer_assignments_released', v_released_dealers
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'close_tournament_table_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_break_table_v3(
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
  v_game_table_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_source_table public.tournament_tables%ROWTYPE;
  v_source_session public.table_sessions%ROWTYPE;
  v_game_table_ids uuid[];
  v_session_ids uuid[];
  v_need integer := 0;
  v_capacity integer := 0;
  v_moved integer := 0;
  v_released_dealers integer := 0;
  v_source_seat public.tournament_seats%ROWTYPE;
  v_destination_table_id uuid;
  v_destination_session_id uuid;
  v_destination_seat_number integer;
  v_next_revision bigint;
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
  SELECT tt.tournament_id, tt.game_table_id
  INTO v_tournament_id, v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'tournament_table_id', p_tournament_table_id,
    'expected_revision', p_expected_revision,
    'draw_mode', p_draw_mode
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_break_table_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'floor_break_table_v3', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- Establish one canonical lock order for every active V3 table in the
  -- tournament before capacity calculation or any seat change.
  SELECT
    pg_catalog.array_agg(tt.game_table_id ORDER BY tt.game_table_id),
    pg_catalog.array_agg(tt.table_session_id ORDER BY tt.table_session_id)
  INTO v_game_table_ids, v_session_ids
  FROM public.tournament_tables tt
  JOIN public.table_sessions session_row ON session_row.id = tt.table_session_id
  WHERE tt.tournament_id = v_tournament.id
    AND tt.status = 'active'
    AND tt.game_table_id IS NOT NULL
    AND tt.table_session_id IS NOT NULL
    AND session_row.closed_at IS NULL;
  IF v_game_table_ids IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_tables');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = ANY(v_game_table_ids)
    AND gt.club_id = v_tournament.club_id
  ORDER BY gt.id FOR UPDATE;
  PERFORM 1 FROM public.table_sessions session_row
  WHERE session_row.id = ANY(v_session_ids)
  ORDER BY session_row.id FOR UPDATE;

  SELECT * INTO v_source_table
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = v_tournament.id
    AND tt.status = 'active'
  FOR UPDATE;
  SELECT * INTO v_source_session
  FROM public.table_sessions session_row
  WHERE session_row.id = v_source_table.table_session_id
    AND session_row.closed_at IS NULL
  FOR UPDATE;
  IF v_source_table.id IS NULL
     OR v_source_session.id IS NULL
     OR v_source_session.game_table_id IS DISTINCT FROM v_source_table.game_table_id
     OR v_source_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  IF v_source_session.revision <> p_expected_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE', 'current_revision', v_source_session.revision);
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_source_table.id, v_source_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  SELECT pg_catalog.count(*)::integer INTO v_need
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.tournament_table_id = v_source_table.id
    AND seat_row.table_session_id = v_source_session.id
    AND seat_row.is_active;
  SELECT COALESCE(pg_catalog.sum(9 - occupied.count_active), 0)::integer
  INTO v_capacity
  FROM (
    SELECT
      target.id,
      pg_catalog.count(active_seat.id)::integer AS count_active
    FROM public.tournament_tables target
    JOIN public.table_sessions target_session ON target_session.id = target.table_session_id
    LEFT JOIN public.tournament_seats active_seat
      ON active_seat.tournament_table_id = target.id
      AND active_seat.table_session_id = target_session.id
      AND active_seat.is_active
    WHERE target.tournament_id = v_tournament.id
      AND target.status = 'active'
      AND target.id <> v_source_table.id
      AND target_session.closed_at IS NULL
    GROUP BY target.id
  ) occupied;
  IF v_capacity < v_need THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'insufficient_capacity', 'need', v_need, 'have', v_capacity
    );
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_tables target
    JOIN public.table_sessions target_session ON target_session.id = target.table_session_id
    WHERE target.tournament_id = v_tournament.id
      AND target.status = 'active'
      AND target.id <> v_source_table.id
      AND target_session.closed_at IS NULL
      AND floor_private.floor_table_v3_has_active_hand(v_tournament.id, target.id, target_session.id)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'destination_table_has_active_hand');
  END IF;

  FOR v_source_seat IN
    SELECT *
    FROM public.tournament_seats seat_row
    WHERE seat_row.tournament_table_id = v_source_table.id
      AND seat_row.table_session_id = v_source_session.id
      AND seat_row.is_active
    ORDER BY seat_row.seat_number, seat_row.id
    FOR UPDATE
  LOOP
    SELECT target.id, target.table_session_id, candidate.seat_number
    INTO v_destination_table_id, v_destination_session_id, v_destination_seat_number
    FROM public.tournament_tables target
    JOIN public.table_sessions target_session ON target_session.id = target.table_session_id
    CROSS JOIN LATERAL pg_catalog.generate_series(1, 9) candidate(seat_number)
    WHERE target.tournament_id = v_tournament.id
      AND target.status = 'active'
      AND target.id <> v_source_table.id
      AND target_session.closed_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.tournament_seats occupied_seat
        WHERE occupied_seat.tournament_table_id = target.id
          AND occupied_seat.table_session_id = target_session.id
          AND occupied_seat.seat_number = candidate.seat_number
          AND occupied_seat.is_active
      )
    ORDER BY
      CASE WHEN p_draw_mode = 'fill_lowest_table' THEN target.table_number END ASC NULLS LAST,
      (
        SELECT pg_catalog.count(*)
        FROM public.tournament_seats occupied_count
        WHERE occupied_count.tournament_table_id = target.id
          AND occupied_count.table_session_id = target_session.id
          AND occupied_count.is_active
      ) ASC,
      CASE WHEN p_draw_mode = 'redraw_balanced' THEN pg_catalog.random() END,
      target.id,
      candidate.seat_number
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'break_capacity_changed';
    END IF;

    UPDATE public.tournament_seats
    SET is_active = false,
        status = 'moved'
    WHERE id = v_source_seat.id
      AND is_active;
    INSERT INTO public.tournament_seats (
      tournament_id,
      player_id,
      entry_number,
      tournament_table_id,
      table_session_id,
      seat_number,
      chip_count,
      is_active,
      entry_id,
      status,
      assigned_by,
      assigned_at
    ) VALUES (
      v_tournament.id,
      v_source_seat.player_id,
      v_source_seat.entry_number,
      v_destination_table_id,
      v_destination_session_id,
      v_destination_seat_number,
      v_source_seat.chip_count,
      true,
      v_source_seat.entry_id,
      'active',
      v_actor,
      pg_catalog.now()
    );
    UPDATE public.table_sessions
    SET revision = revision + 1
    WHERE id = v_destination_session_id
      AND closed_at IS NULL;
    v_moved := v_moved + 1;
  END LOOP;

  UPDATE public.dealer_assignments
  SET released_at = COALESCE(released_at, pg_catalog.now()),
      status = CASE WHEN status IN ('assigned', 'on_break') THEN 'completed' ELSE status END
  WHERE table_session_id = v_source_session.id
    AND released_at IS NULL;
  GET DIAGNOSTICS v_released_dealers = ROW_COUNT;
  UPDATE public.tournament_tables SET status = 'closed'
  WHERE id = v_source_table.id AND status = 'active';
  UPDATE public.table_sessions
  SET closed_at = pg_catalog.now(),
      closed_by = v_actor,
      revision = revision + 1
  WHERE id = v_source_session.id
    AND revision = p_expected_revision
    AND closed_at IS NULL
  RETURNING revision INTO v_next_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE';
  END IF;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'closed', true,
    'tournament_table_id', v_source_table.id,
    'table_session_id', v_source_session.id,
    'moved_count', v_moved,
    'dealer_assignments_released', v_released_dealers,
    'revision', v_next_revision
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_break_table_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_bust_player_v3(
  p_entry_id uuid,
  p_expected_revision bigint,
  p_expected_control_epoch bigint,
  p_expected_chip_count integer,
  p_request_id uuid,
  p_reason text DEFAULT 'floor_bust'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_seat public.tournament_seats%ROWTYPE;
  v_tournament_table public.tournament_tables%ROWTYPE;
  v_session public.table_sessions%ROWTYPE;
  v_game_table_id uuid;
  v_tracker_chip_count integer;
  v_next_revision bigint;
  v_remaining integer;
  v_manual_nonzero_override boolean := false;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_entry_id IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_control_epoch IS NULL
     OR p_expected_chip_count IS NULL
     OR p_expected_chip_count < 0
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT entry_row.tournament_id INTO v_tournament_id
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'entry_id', p_entry_id,
    'expected_revision', p_expected_revision,
    'expected_control_epoch', p_expected_control_epoch,
    'expected_chip_count', p_expected_chip_count,
    'reason', COALESCE(p_reason, '')
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_bust_player_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(v_actor, 'floor_bust_player_v3', p_request_id);
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  -- Discover the current placement without locking it.  The immutable
  -- physical table is then locked before session, assignment, entry and seat.
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id;
  IF NOT FOUND OR v_entry.status <> 'seated' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_seated');
  END IF;
  SELECT * INTO v_seat
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.entry_id = v_entry.id
    AND seat_row.is_active
    AND seat_row.tournament_table_id IS NOT NULL
    AND seat_row.table_session_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_seat');
  END IF;
  SELECT tt.game_table_id INTO v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = v_seat.tournament_table_id
    AND tt.tournament_id = v_tournament.id;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = v_game_table_id AND gt.club_id = v_tournament.club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  SELECT * INTO v_session FROM public.table_sessions session_row
  WHERE session_row.id = v_seat.table_session_id
    AND session_row.closed_at IS NULL
  FOR UPDATE;
  SELECT * INTO v_tournament_table FROM public.tournament_tables tt
  WHERE tt.id = v_seat.tournament_table_id
    AND tt.table_session_id = v_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  IF v_session.id IS NULL
     OR v_tournament_table.id IS NULL
     OR v_session.tournament_id IS DISTINCT FROM v_tournament.id
     OR v_session.game_table_id IS DISTINCT FROM v_game_table_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id
  FOR UPDATE;
  IF NOT FOUND OR v_entry.status <> 'seated' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_seated');
  END IF;
  SELECT * INTO v_seat
  FROM public.tournament_seats seat_row
  WHERE seat_row.tournament_id = v_tournament.id
    AND seat_row.entry_id = v_entry.id
    AND seat_row.is_active
    AND seat_row.tournament_table_id = v_tournament_table.id
    AND seat_row.table_session_id = v_session.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'no_active_v3_seat');
  END IF;
  IF v_seat.chip_count IS DISTINCT FROM p_expected_chip_count THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'STALE_STATE', 'current_chip_count', v_seat.chip_count
    );
  END IF;
  IF v_session.revision <> p_expected_revision
     OR v_session.control_epoch <> p_expected_control_epoch THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'STALE_STATE',
      'current_revision', v_session.revision,
      'current_control_epoch', v_session.control_epoch
    );
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_tournament_table.id, v_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'player_in_active_hand');
  END IF;
  IF v_session.control_mode = 'tracker' THEN
    SELECT chip_row.chip_count INTO v_tracker_chip_count
    FROM public.tournament_chip_counts chip_row
    WHERE chip_row.tournament_id = v_tournament.id
      AND chip_row.player_id = v_entry.player_id
      AND chip_row.entry_number = v_entry.entry_no
    FOR UPDATE;
    IF NOT FOUND OR v_tracker_chip_count IS DISTINCT FROM v_seat.chip_count THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tracker_chip_state_mismatch');
    END IF;
    IF v_tracker_chip_count <> 0 THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'player_has_chips');
    END IF;
  ELSE
    v_manual_nonzero_override := v_seat.chip_count <> 0;
  END IF;

  UPDATE public.table_sessions
  SET revision = revision + 1
  WHERE id = v_session.id
    AND revision = p_expected_revision
  RETURNING revision INTO v_next_revision;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
  END IF;
  UPDATE public.tournament_seats
  SET is_active = false,
      status = 'busted'
  WHERE id = v_seat.id
    AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'STALE_STATE';
  END IF;
  UPDATE public.tournament_entries
  SET status = 'busted',
      current_stack = 0,
      busted_at = COALESCE(busted_at, pg_catalog.now()),
      updated_at = pg_catalog.now()
  WHERE id = v_entry.id
    AND status = 'seated';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entry_state_changed';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_remaining
  FROM public.tournament_seats active_seat
  WHERE active_seat.tournament_id = v_tournament.id
    AND active_seat.is_active;
  UPDATE public.tournaments
  SET players_remaining = v_remaining
  WHERE id = v_tournament.id;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'entry_id', v_entry.id,
    'seat_id', v_seat.id,
    'table_session_id', v_session.id,
    'players_remaining', v_remaining,
    'revision', v_next_revision,
    'manual_nonzero_chip_override', v_manual_nonzero_override,
    'payout_applied', false
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_bust_player_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.floor_restore_busted_player_to_seat_v3(
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
  v_tournament_id uuid;
  v_tournament public.tournaments%ROWTYPE;
  v_entry public.tournament_entries%ROWTYPE;
  v_busted_seat public.tournament_seats%ROWTYPE;
  v_destination_table public.tournament_tables%ROWTYPE;
  v_destination_session public.table_sessions%ROWTYPE;
  v_game_table_id uuid;
  v_stack integer;
  v_new_seat_id uuid;
  v_next_revision bigint;
  v_fingerprint text;
  v_receipt record;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL
     OR p_entry_id IS NULL
     OR p_to_tournament_table_id IS NULL
     OR p_to_seat_number IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_control_epoch IS NULL
     OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  SELECT entry_row.tournament_id INTO v_tournament_id
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_found');
  END IF;
  v_fingerprint := pg_catalog.jsonb_build_object(
    'entry_id', p_entry_id,
    'to_tournament_table_id', p_to_tournament_table_id,
    'to_seat_number', p_to_seat_number,
    'expected_revision', p_expected_revision,
    'expected_control_epoch', p_expected_control_epoch
  )::text;
  PERFORM floor_private.floor_table_v3_lock_receipt(v_actor, 'floor_restore_busted_player_to_seat_v3', p_request_id);
  SELECT * INTO v_receipt
  FROM floor_private.floor_table_v3_existing_receipt(
    v_actor, 'floor_restore_busted_player_to_seat_v3', p_request_id
  );
  IF FOUND THEN
    IF v_receipt.request_fingerprint <> v_fingerprint THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN v_receipt.result;
  END IF;

  SELECT * INTO v_tournament FROM public.tournaments WHERE id = v_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_tournament.status IN ('completed', 'cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF NOT floor_private.floor_table_v3_actor_is_tournament_operator(v_actor, v_tournament.club_id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id;
  IF NOT FOUND OR v_entry.status <> 'busted' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_busted');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats active_seat
    WHERE active_seat.tournament_id = v_tournament.id
      AND active_seat.entry_id = v_entry.id
      AND active_seat.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_already_seated');
  END IF;
  SELECT * INTO v_busted_seat
  FROM public.tournament_seats busted_seat
  WHERE busted_seat.tournament_id = v_tournament.id
    AND busted_seat.entry_id = v_entry.id
    AND busted_seat.status = 'busted'
  ORDER BY busted_seat.assigned_at DESC NULLS LAST, busted_seat.id DESC
  LIMIT 1;
  v_stack := COALESCE(v_busted_seat.chip_count, v_entry.current_stack, 0);

  SELECT tt.game_table_id INTO v_game_table_id
  FROM public.tournament_tables tt
  WHERE tt.id = p_to_tournament_table_id
    AND tt.tournament_id = v_tournament.id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_destination_table');
  END IF;
  PERFORM 1 FROM public.game_tables gt
  WHERE gt.id = v_game_table_id AND gt.club_id = v_tournament.club_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'game_table_scope_mismatch');
  END IF;
  SELECT * INTO v_destination_session FROM public.table_sessions session_row
  WHERE session_row.game_table_id = v_game_table_id AND session_row.closed_at IS NULL FOR UPDATE;
  SELECT * INTO v_destination_table FROM public.tournament_tables tt
  WHERE tt.id = p_to_tournament_table_id
    AND tt.table_session_id = v_destination_session.id
    AND tt.status = 'active'
  FOR UPDATE;
  IF v_destination_session.id IS NULL
     OR v_destination_table.id IS NULL
     OR v_destination_session.tournament_id IS DISTINCT FROM v_tournament.id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_session_mismatch');
  END IF;
  SELECT * INTO v_entry
  FROM public.tournament_entries entry_row
  WHERE entry_row.id = p_entry_id
    AND entry_row.tournament_id = v_tournament.id
  FOR UPDATE;
  IF NOT FOUND OR v_entry.status <> 'busted' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_not_busted');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_seats active_seat
    WHERE active_seat.tournament_id = v_tournament.id
      AND active_seat.entry_id = v_entry.id
      AND active_seat.is_active
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'entry_already_seated');
  END IF;
  SELECT * INTO v_busted_seat
  FROM public.tournament_seats busted_seat
  WHERE busted_seat.tournament_id = v_tournament.id
    AND busted_seat.entry_id = v_entry.id
    AND busted_seat.status = 'busted'
  ORDER BY busted_seat.assigned_at DESC NULLS LAST, busted_seat.id DESC
  LIMIT 1
  FOR UPDATE;
  v_stack := COALESCE(v_busted_seat.chip_count, v_entry.current_stack, 0);
  IF p_to_seat_number < 1 OR p_to_seat_number > 9 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_seat_number');
  END IF;
  IF v_destination_session.revision <> p_expected_revision
     OR v_destination_session.control_epoch <> p_expected_control_epoch THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'STALE_STATE',
      'current_revision', v_destination_session.revision,
      'current_control_epoch', v_destination_session.control_epoch
    );
  END IF;
  IF floor_private.floor_table_v3_has_active_hand(v_tournament.id, v_destination_table.id, v_destination_session.id) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'table_has_active_hand');
  END IF;

  BEGIN
    UPDATE public.table_sessions
    SET revision = revision + 1
    WHERE id = v_destination_session.id
      AND revision = p_expected_revision
    RETURNING revision INTO v_next_revision;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'STALE_STATE');
    END IF;
    INSERT INTO public.tournament_seats (
      tournament_id,
      player_id,
      entry_number,
      tournament_table_id,
      table_session_id,
      seat_number,
      chip_count,
      is_active,
      entry_id,
      status,
      assigned_by,
      assigned_at
    ) VALUES (
      v_tournament.id,
      v_entry.player_id,
      v_entry.entry_no,
      v_destination_table.id,
      v_destination_session.id,
      p_to_seat_number,
      v_stack,
      true,
      v_entry.id,
      'active',
      v_actor,
      pg_catalog.now()
    )
    RETURNING id INTO v_new_seat_id;
    UPDATE public.tournament_entries
    SET status = 'seated',
        current_stack = v_stack,
        busted_at = NULL,
        updated_at = pg_catalog.now()
    WHERE id = v_entry.id
      AND status = 'busted';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'entry_state_changed';
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'seat_occupied');
  END;

  v_result := pg_catalog.jsonb_build_object(
    'ok', true,
    'entry_id', v_entry.id,
    'seat_id', v_new_seat_id,
    'tournament_table_id', v_destination_table.id,
    'table_session_id', v_destination_session.id,
    'seat_number', p_to_seat_number,
    'chip_count', v_stack,
    'revision', v_next_revision,
    'payout_applied', false
  );
  PERFORM floor_private.floor_table_v3_save_receipt(
    v_actor, 'floor_restore_busted_player_to_seat_v3', p_request_id, v_fingerprint, v_result
  );
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.get_club_table_inventory(uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid) OWNER TO postgres;
ALTER FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_floor_seatable_entries(uuid) OWNER TO postgres;
ALTER FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint) OWNER TO postgres;
ALTER FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_club_table_inventory(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_floor_seatable_entries(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.get_club_table_inventory(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_floor_seatable_entries(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;

COMMIT;
