-- Tracker Voice: preserve an approved session capability across Dealer handoff,
-- while re-checking the sole current Dealer on every runtime/write request.
--
-- Source-only owner gate. This migration does not reconcile a table, enable a
-- flag, deploy Edge/frontend code, or change production data by itself.
-- Rollback: ship a forward migration restoring the prior two function bodies;
-- do not edit or replay an already-recorded migration.

BEGIN;

DO $precondition$
BEGIN
  IF pg_catalog.to_regprocedure('floor_private.sync_tracker_voice_config(uuid,boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public._tracker_voice_assignment_context(uuid,uuid,uuid)') IS NULL
     OR pg_catalog.to_regclass('public.tracker_voice_configs') IS NULL
     OR pg_catalog.to_regclass('public.dealer_assignments') IS NULL THEN
    RAISE EXCEPTION 'tracker_voice_dealer_handoff_authority_precondition_failed';
  END IF;
END;
$precondition$;

-- A config row is the reviewed capability for one exact session/epoch. Dealer
-- assignments are transient runtime eligibility and must not silently revoke
-- that capability during the release/assign gap of a legitimate handoff.
CREATE OR REPLACE FUNCTION floor_private.sync_tracker_voice_config(
  p_table_session_id UUID,
  p_reconcile BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_session RECORD;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_config_exists BOOLEAN := FALSE;
  v_config_exact BOOLEAN := FALSE;
  v_global_enabled BOOLEAN := FALSE;
  v_auto_provision_enabled BOOLEAN := FALSE;
  v_active_assignment_count INTEGER := 0;
  v_usable_assignment_count INTEGER := 0;
BEGIN
  SELECT
    session_row.id AS table_session_id,
    session_row.club_id,
    session_row.game_table_id,
    session_row.tournament_id,
    session_row.control_mode,
    session_row.control_epoch,
    session_row.closed_at,
    table_row.id AS tournament_table_id,
    table_row.status AS tournament_table_status
  INTO v_session
  FROM public.table_sessions session_row
  JOIN public.tournament_tables table_row
    ON table_row.table_session_id = session_row.id
  WHERE session_row.id = p_table_session_id
    AND session_row.session_type = 'tournament'
  FOR SHARE OF session_row, table_row;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT settings.value = 'true'::JSONB
  INTO v_global_enabled
  FROM public.app_settings settings
  WHERE settings.key = 'tracker_voice_global_enabled'
  FOR SHARE;

  SELECT settings.value = 'true'::JSONB
  INTO v_auto_provision_enabled
  FROM public.app_settings settings
  WHERE settings.key = 'tracker_voice_auto_provision_enabled'
  FOR SHARE;

  SELECT *
  INTO v_config
  FROM public.tracker_voice_configs config_row
  WHERE config_row.tournament_id = v_session.tournament_id
    AND config_row.tournament_table_id = v_session.tournament_table_id
  FOR UPDATE;
  v_config_exists := FOUND;
  v_config_exact := v_config_exists
    AND v_config.club_id IS NOT DISTINCT FROM v_session.club_id
    AND v_config.physical_table_id IS NOT DISTINCT FROM v_session.game_table_id
    AND v_config.table_session_id IS NOT DISTINCT FROM v_session.table_session_id
    AND v_config.control_epoch IS NOT DISTINCT FROM v_session.control_epoch;

  -- Session/global kill paths still revoke the capability and never auto-revive
  -- it. A deliberate service-role reconcile is required after such a revoke.
  IF v_session.closed_at IS NOT NULL
     OR v_session.tournament_table_status <> 'active'
     OR v_session.control_mode <> 'tracker'
     OR COALESCE(v_global_enabled, FALSE) IS NOT TRUE THEN
    UPDATE public.tracker_voice_configs config_row
    SET enabled = FALSE,
        table_session_id = v_session.table_session_id,
        control_epoch = v_session.control_epoch,
        physical_table_id = v_session.game_table_id,
        updated_at = pg_catalog.now()
    WHERE config_row.tournament_id = v_session.tournament_id
      AND config_row.tournament_table_id = v_session.tournament_table_id;
    RETURN;
  END IF;

  -- Preserve only an already-approved exact capability. Runtime authority below
  -- independently denies zero, multiple, invalid, or wrong-user assignments.
  IF v_config_exact AND v_config.enabled IS TRUE THEN
    RETURN;
  END IF;

  -- Auto-provision may create a never-reviewed row, but it must not resurrect a
  -- row that an administrator or a session/global kill path disabled.
  IF v_config_exists AND p_reconcile IS NOT TRUE THEN
    UPDATE public.tracker_voice_configs config_row
    SET enabled = FALSE,
        table_session_id = v_session.table_session_id,
        control_epoch = v_session.control_epoch,
        physical_table_id = v_session.game_table_id,
        updated_at = pg_catalog.now()
    WHERE config_row.tournament_id = v_session.tournament_id
      AND config_row.tournament_table_id = v_session.tournament_table_id;
    RETURN;
  END IF;

  IF NOT v_config_exists
     AND COALESCE(v_auto_provision_enabled, FALSE) IS NOT TRUE
     AND p_reconcile IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Lock and count the whole exact session, not rows belonging to one actor.
  PERFORM 1
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_session_id = v_session.table_session_id
    AND assignment_row.table_id = v_session.game_table_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL
  FOR SHARE OF assignment_row, dealer_row;

  SELECT
    pg_catalog.count(*)::INTEGER,
    pg_catalog.count(*) FILTER (
      WHERE dealer_row.club_id = v_session.club_id
        AND dealer_row.status = 'active'
        AND dealer_row.user_id IS NOT NULL
    )::INTEGER
  INTO v_active_assignment_count, v_usable_assignment_count
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_session_id = v_session.table_session_id
    AND assignment_row.table_id = v_session.game_table_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL;

  IF v_active_assignment_count <> 1 OR v_usable_assignment_count <> 1 THEN
    RETURN;
  END IF;

  INSERT INTO public.tracker_voice_configs (
    club_id,
    tournament_id,
    tournament_table_id,
    physical_table_id,
    table_session_id,
    control_epoch,
    enabled,
    configured_mode,
    provider_model,
    spoken_amount_unit,
    amount_unit_confirmed,
    server_auto_allowed,
    auto_turn_order_compatible,
    correction_state
  ) VALUES (
    v_session.club_id,
    v_session.tournament_id,
    v_session.tournament_table_id,
    v_session.game_table_id,
    v_session.table_session_id,
    v_session.control_epoch,
    TRUE,
    'assist',
    'gemini-3.5-transcribe-live',
    1,
    FALSE,
    FALSE,
    FALSE,
    'ready'
  )
  ON CONFLICT (tournament_id, tournament_table_id) DO UPDATE
  SET club_id = EXCLUDED.club_id,
      physical_table_id = EXCLUDED.physical_table_id,
      table_session_id = EXCLUDED.table_session_id,
      control_epoch = EXCLUDED.control_epoch,
      enabled = TRUE,
      configured_mode = 'assist',
      provider_model = 'gemini-3.5-transcribe-live',
      server_auto_allowed = FALSE,
      auto_turn_order_compatible = FALSE,
      auto_capability_version = NULL,
      updated_at = pg_catalog.now();
END;
$function$;

-- This single authority seam is called by session minting, validation, and all
-- commit paths. It counts every assignment on the exact session first, then
-- verifies that the sole usable assignment belongs to the caller.
CREATE OR REPLACE FUNCTION public._tracker_voice_assignment_context(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_tour RECORD;
  v_table_session RECORD;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_assignment_count INTEGER := 0;
  v_usable_assignment_count INTEGER := 0;
  v_assignment RECORD;
  v_global_enabled BOOLEAN := FALSE;
BEGIN
  IF p_actor IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT tournament_row.id, tournament_row.club_id, tournament_row.name
  INTO v_tour
  FROM public.tournaments tournament_row
  WHERE tournament_row.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT
    table_row.id AS tournament_table_id,
    table_row.table_name,
    table_row.status AS table_status,
    table_row.game_table_id AS physical_table_id,
    session_row.id AS table_session_id,
    session_row.control_epoch
  INTO v_table_session
  FROM public.tournament_tables table_row
  JOIN public.table_sessions session_row
    ON session_row.id = table_row.table_session_id
  WHERE table_row.id = p_tournament_table_id
    AND table_row.tournament_id = p_tournament_id
    AND table_row.status = 'active'
    AND table_row.game_table_id IS NOT NULL
    AND session_row.closed_at IS NULL
    AND session_row.session_type = 'tournament'
    AND session_row.control_mode = 'tracker'
    AND session_row.club_id = v_tour.club_id
    AND session_row.tournament_id = v_tour.id
    AND session_row.game_table_id = table_row.game_table_id
  FOR SHARE OF table_row, session_row;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'voice_table_session_not_tracker',
      'tournament_id', v_tour.id,
      'tournament_table_id', p_tournament_table_id
    );
  END IF;

  IF NOT floor_private.floor_table_v3_assert_tracker_context(
    p_tournament_id,
    p_tournament_table_id,
    v_table_session.table_session_id,
    v_table_session.control_epoch
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_table_session_not_tracker');
  END IF;

  SELECT settings.value = 'true'::JSONB
  INTO v_global_enabled
  FROM public.app_settings settings
  WHERE settings.key = 'tracker_voice_global_enabled'
  FOR SHARE;
  IF COALESCE(v_global_enabled, FALSE) IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_global_disabled');
  END IF;

  SELECT *
  INTO v_config
  FROM public.tracker_voice_configs config_row
  WHERE config_row.tournament_id = v_tour.id
    AND config_row.tournament_table_id = v_table_session.tournament_table_id
  FOR SHARE;
  IF NOT FOUND
     OR v_config.club_id IS DISTINCT FROM v_tour.club_id
     OR v_config.physical_table_id IS DISTINCT FROM v_table_session.physical_table_id
     OR v_config.table_session_id IS DISTINCT FROM v_table_session.table_session_id
     OR v_config.control_epoch IS DISTINCT FROM v_table_session.control_epoch THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_config_stale');
  END IF;
  IF v_config.enabled IS NOT TRUE THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'voice_config_disabled');
  END IF;

  PERFORM 1
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL
  FOR SHARE OF assignment_row, dealer_row;

  SELECT
    pg_catalog.count(*)::INTEGER,
    pg_catalog.count(*) FILTER (
      WHERE dealer_row.club_id = v_tour.club_id
        AND dealer_row.status = 'active'
        AND dealer_row.user_id IS NOT NULL
    )::INTEGER
  INTO v_assignment_count, v_usable_assignment_count
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL;

  IF v_assignment_count <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', CASE WHEN v_assignment_count = 0 THEN 'dealer_assignment_missing' ELSE 'dealer_assignment_ambiguous' END,
      'assignment_count', v_assignment_count,
      'tournament_id', v_tour.id,
      'tournament_table_id', v_table_session.tournament_table_id,
      'physical_table_id', v_table_session.physical_table_id,
      'table_session_id', v_table_session.table_session_id,
      'club_id', v_tour.club_id
    );
  END IF;

  IF v_usable_assignment_count <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'dealer_assignment_invalid',
      'assignment_count', v_assignment_count,
      'tournament_id', v_tour.id,
      'tournament_table_id', v_table_session.tournament_table_id,
      'physical_table_id', v_table_session.physical_table_id,
      'table_session_id', v_table_session.table_session_id,
      'club_id', v_tour.club_id
    );
  END IF;

  SELECT
    assignment_row.id AS assignment_id,
    dealer_row.id AS dealer_id,
    dealer_row.user_id
  INTO v_assignment
  FROM public.dealer_assignments assignment_row
  JOIN public.dealers dealer_row
    ON dealer_row.id = assignment_row.dealer_id
  WHERE assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL
  LIMIT 1;

  IF v_assignment.user_id IS DISTINCT FROM p_actor THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'dealer_assignment_missing',
      'assignment_count', v_assignment_count,
      'tournament_id', v_tour.id,
      'tournament_table_id', v_table_session.tournament_table_id,
      'physical_table_id', v_table_session.physical_table_id,
      'table_session_id', v_table_session.table_session_id,
      'club_id', v_tour.club_id
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'club_id', v_tour.club_id,
    'tournament_id', v_tour.id,
    'tournament_name', v_tour.name,
    'tournament_table_id', v_table_session.tournament_table_id,
    'physical_table_id', v_table_session.physical_table_id,
    'table_session_id', v_table_session.table_session_id,
    'control_epoch', v_table_session.control_epoch,
    'table_name', v_table_session.table_name,
    'table_status', v_table_session.table_status,
    'dealer_id', v_assignment.dealer_id,
    'assignment_id', v_assignment.assignment_id
  );
END;
$function$;

ALTER FUNCTION floor_private.sync_tracker_voice_config(UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION public._tracker_voice_assignment_context(UUID, UUID, UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION floor_private.sync_tracker_voice_config(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._tracker_voice_assignment_context(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
