-- Tracker Voice Floor V3 authority. This migration stays source-only until a
-- separately owner-gated, exact-file rollout. Runtime defaults deny-by-default.
BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.app_settings') IS NULL
     OR pg_catalog.to_regclass('public.table_sessions') IS NULL
     OR pg_catalog.to_regclass('public.tracker_voice_configs') IS NULL
     OR pg_catalog.to_regprocedure('floor_private.floor_table_v3_assert_tracker_context(uuid,uuid,uuid,bigint)') IS NULL
  THEN
    RAISE EXCEPTION 'tracker_voice_floor_v3_dependency_missing' USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

ALTER TABLE public.tracker_voice_configs
  ADD COLUMN IF NOT EXISTS table_session_id UUID,
  ADD COLUMN IF NOT EXISTS control_epoch BIGINT;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tracker_voice_configs'::regclass
      AND conname = 'tracker_voice_configs_table_session_id_fkey'
  ) THEN
    ALTER TABLE public.tracker_voice_configs
      ADD CONSTRAINT tracker_voice_configs_table_session_id_fkey
      FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tracker_voice_configs'::regclass
      AND conname = 'tracker_voice_configs_session_tournament_fkey'
  ) THEN
    ALTER TABLE public.tracker_voice_configs
      ADD CONSTRAINT tracker_voice_configs_session_tournament_fkey
      FOREIGN KEY (table_session_id, tournament_id)
      REFERENCES public.table_sessions(id, tournament_id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tracker_voice_configs'::regclass
      AND conname = 'tracker_voice_configs_session_game_table_fkey'
  ) THEN
    ALTER TABLE public.tracker_voice_configs
      ADD CONSTRAINT tracker_voice_configs_session_game_table_fkey
      FOREIGN KEY (table_session_id, physical_table_id)
      REFERENCES public.table_sessions(id, game_table_id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tracker_voice_configs'::regclass
      AND conname = 'tracker_voice_configs_enabled_session_check'
  ) THEN
    ALTER TABLE public.tracker_voice_configs
      ADD CONSTRAINT tracker_voice_configs_enabled_session_check
      CHECK (
        enabled IS FALSE
        OR (table_session_id IS NOT NULL AND control_epoch IS NOT NULL AND control_epoch >= 1)
      ) NOT VALID;
  END IF;
END;
$constraints$;

CREATE INDEX IF NOT EXISTS idx_tracker_voice_configs_session_epoch
  ON public.tracker_voice_configs(table_session_id, control_epoch)
  WHERE table_session_id IS NOT NULL;

-- Existing configurations pre-date session binding. They cannot retain an
-- enabled state because a missing session/epoch is never a runtime authority.
UPDATE public.tracker_voice_configs
SET enabled = FALSE
WHERE enabled IS TRUE
  AND (table_session_id IS NULL OR control_epoch IS NULL);

INSERT INTO public.app_settings(key, value)
VALUES
  ('tracker_voice_global_enabled', 'false'::JSONB),
  ('tracker_voice_auto_provision_enabled', 'false'::JSONB)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = pg_catalog.now(),
    updated_by = NULL;

-- app_settings has a legacy media-management policy. The two Voice gates are
-- operational safety controls, so only super-admin access is permitted.
DROP POLICY IF EXISTS tracker_voice_runtime_settings_super_admin_only ON public.app_settings;
CREATE POLICY tracker_voice_runtime_settings_super_admin_only
  ON public.app_settings AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (
    key NOT IN ('tracker_voice_global_enabled', 'tracker_voice_auto_provision_enabled')
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  WITH CHECK (
    key NOT IN ('tracker_voice_global_enabled', 'tracker_voice_auto_provision_enabled')
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- This is the only Floor-to-Voice configuration seam. It is local database
-- work only, so it can safely run in the Floor transaction without Edge or
-- provider dependencies. A disabled row remains useful as an exact binding;
-- runtime authority still additionally checks global/session/assignment state.
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

  SELECT
    count(*)::INTEGER,
    count(*) FILTER (
      WHERE dealer_row.status = 'active'
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

  IF v_session.closed_at IS NOT NULL
     OR v_session.tournament_table_status <> 'active'
     OR v_session.control_mode <> 'tracker'
     OR v_active_assignment_count <> 1
     OR v_usable_assignment_count <> 1
     OR COALESCE(v_global_enabled, FALSE) IS NOT TRUE
     OR (
       COALESCE(v_auto_provision_enabled, FALSE) IS NOT TRUE
       AND p_reconcile IS NOT TRUE
     )
  THEN
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

CREATE OR REPLACE FUNCTION floor_private.sync_tracker_voice_session_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- Floor Manual/close is the operational kill path. Runtime re-checks the
  -- session independently, and a best-effort sync must never block Floor.
  BEGIN
    PERFORM floor_private.sync_tracker_voice_config(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION floor_private.sync_tracker_voice_tournament_table_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  BEGIN
    IF NEW.table_session_id IS NOT NULL THEN
      PERFORM floor_private.sync_tracker_voice_config(NEW.table_session_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION floor_private.sync_tracker_voice_assignment_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.table_session_id IS DISTINCT FROM NEW.table_session_id
       AND OLD.table_session_id IS NOT NULL THEN
      PERFORM floor_private.sync_tracker_voice_config(OLD.table_session_id);
    END IF;
    IF NEW.table_session_id IS NOT NULL THEN
      PERFORM floor_private.sync_tracker_voice_config(NEW.table_session_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION floor_private.sync_tracker_voice_dealer_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_session_id UUID;
BEGIN
  BEGIN
    FOR v_session_id IN
      SELECT DISTINCT assignment_row.table_session_id
      FROM public.dealer_assignments assignment_row
      WHERE assignment_row.dealer_id = NEW.id
        AND assignment_row.table_session_id IS NOT NULL
        AND assignment_row.released_at IS NULL
    LOOP
      PERFORM floor_private.sync_tracker_voice_config(v_session_id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_tracker_voice_sync_table_session ON public.table_sessions;
CREATE TRIGGER trg_tracker_voice_sync_table_session
  AFTER UPDATE OF control_mode, control_epoch, closed_at ON public.table_sessions
  FOR EACH ROW EXECUTE FUNCTION floor_private.sync_tracker_voice_session_trigger();

DROP TRIGGER IF EXISTS trg_tracker_voice_sync_tournament_table ON public.tournament_tables;
CREATE TRIGGER trg_tracker_voice_sync_tournament_table
  AFTER INSERT OR UPDATE OF table_session_id, status ON public.tournament_tables
  FOR EACH ROW EXECUTE FUNCTION floor_private.sync_tracker_voice_tournament_table_trigger();

DROP TRIGGER IF EXISTS trg_tracker_voice_sync_dealer_assignment ON public.dealer_assignments;
CREATE TRIGGER trg_tracker_voice_sync_dealer_assignment
  AFTER INSERT OR UPDATE OF table_session_id, dealer_id, status, released_at ON public.dealer_assignments
  FOR EACH ROW EXECUTE FUNCTION floor_private.sync_tracker_voice_assignment_trigger();

DROP TRIGGER IF EXISTS trg_tracker_voice_sync_dealer ON public.dealers;
CREATE TRIGGER trg_tracker_voice_sync_dealer
  AFTER UPDATE OF user_id, status ON public.dealers
  FOR EACH ROW EXECUTE FUNCTION floor_private.sync_tracker_voice_dealer_trigger();

-- The global/session/config/assignment decision is centralized here. Every
-- existing Voice writer already calls this function, which keeps Manual/closed
-- tables denied even if a stale config row survives a best-effort Floor sync.
CREATE OR REPLACE FUNCTION public._tracker_voice_assignment_context(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tour RECORD;
  v_table_session RECORD;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_assignment_count INTEGER := 0;
  v_assignment RECORD;
  v_global_enabled BOOLEAN := FALSE;
BEGIN
  IF p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT tournament_row.id, tournament_row.club_id, tournament_row.name
  INTO v_tour
  FROM public.tournaments tournament_row
  WHERE tournament_row.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
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
    RETURN jsonb_build_object(
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
    RETURN jsonb_build_object('ok', false, 'error', 'voice_table_session_not_tracker');
  END IF;

  SELECT settings.value = 'true'::JSONB
  INTO v_global_enabled
  FROM public.app_settings settings
  WHERE settings.key = 'tracker_voice_global_enabled'
  FOR SHARE;
  IF COALESCE(v_global_enabled, FALSE) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_global_disabled');
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs config_row
  WHERE config_row.tournament_id = v_tour.id
    AND config_row.tournament_table_id = v_table_session.tournament_table_id
  FOR SHARE;
  IF NOT FOUND
     OR v_config.club_id IS DISTINCT FROM v_tour.club_id
     OR v_config.physical_table_id IS DISTINCT FROM v_table_session.physical_table_id
     OR v_config.table_session_id IS DISTINCT FROM v_table_session.table_session_id
     OR v_config.control_epoch IS DISTINCT FROM v_table_session.control_epoch THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_config_stale');
  END IF;

  PERFORM 1
  FROM public.dealers dealer_row
  JOIN public.dealer_assignments assignment_row
    ON assignment_row.dealer_id = dealer_row.id
  WHERE dealer_row.user_id = p_actor
    AND dealer_row.club_id = v_tour.club_id
    AND dealer_row.status = 'active'
    AND assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL
  FOR SHARE OF dealer_row, assignment_row;

  SELECT count(*)::INTEGER INTO v_assignment_count
  FROM public.dealers dealer_row
  JOIN public.dealer_assignments assignment_row
    ON assignment_row.dealer_id = dealer_row.id
  WHERE dealer_row.user_id = p_actor
    AND dealer_row.club_id = v_tour.club_id
    AND dealer_row.status = 'active'
    AND assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL;
  IF v_assignment_count <> 1 THEN
    RETURN jsonb_build_object(
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

  SELECT assignment_row.id AS assignment_id, dealer_row.id AS dealer_id
  INTO v_assignment
  FROM public.dealers dealer_row
  JOIN public.dealer_assignments assignment_row
    ON assignment_row.dealer_id = dealer_row.id
  WHERE dealer_row.user_id = p_actor
    AND dealer_row.club_id = v_tour.club_id
    AND dealer_row.status = 'active'
    AND assignment_row.table_id = v_table_session.physical_table_id
    AND assignment_row.table_session_id = v_table_session.table_session_id
    AND assignment_row.status = 'assigned'
    AND assignment_row.released_at IS NULL
  ORDER BY assignment_row.assigned_at DESC, assignment_row.id
  LIMIT 1;

  RETURN jsonb_build_object(
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

-- Browser reads use the same V3 session binding as every service-only writer.
CREATE OR REPLACE FUNCTION public.get_tracker_voice_runtime_context(
  p_tournament_id UUID,
  p_tournament_table_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_assignment JSONB;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_hand RECORD;
  v_state_version TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, v_actor
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_assignment || jsonb_build_object('can_mint_session', false, 'read_only', true);
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs config_row
  WHERE config_row.tournament_id = p_tournament_id
    AND config_row.tournament_table_id = p_tournament_table_id
    AND config_row.table_session_id = (v_assignment->>'table_session_id')::UUID
    AND config_row.control_epoch = (v_assignment->>'control_epoch')::BIGINT;

  SELECT hand_row.id, hand_row.hand_number, hand_row.status
  INTO v_hand
  FROM public.tournament_hands hand_row
  WHERE hand_row.tournament_id = p_tournament_id
    AND hand_row.tournament_table_id = p_tournament_table_id
    AND hand_row.table_session_id = (v_assignment->>'table_session_id')::UUID
    AND hand_row.status = 'in_progress'
  ORDER BY hand_row.hand_time DESC, hand_row.created_at DESC, hand_row.id
  LIMIT 1;

  IF FOUND THEN
    v_state_version := public._tracker_voice_hand_state_version(v_hand.id);
  END IF;

  RETURN v_assignment || jsonb_build_object(
    'ok', true,
    'can_mint_session', COALESCE(v_config.enabled, false),
    'read_only', NOT COALESCE(v_config.enabled, false),
    'config', jsonb_build_object(
      'enabled', COALESCE(v_config.enabled, false),
      'configured_mode', COALESCE(v_config.configured_mode, 'shadow'),
      'provider_model', COALESCE(v_config.provider_model, 'gpt-live-transcribe'),
      'spoken_amount_unit', COALESCE(v_config.spoken_amount_unit, 1),
      'amount_unit_confirmed', COALESCE(v_config.amount_unit_confirmed, false),
      'provider_confidence_threshold', v_config.provider_confidence_threshold,
      'server_auto_allowed', COALESCE(v_config.server_auto_allowed, false),
      'correction_state', COALESCE(v_config.correction_state, 'ready')
    ),
    'active_hand', CASE WHEN v_hand.id IS NULL THEN NULL ELSE jsonb_build_object(
      'hand_id', v_hand.id,
      'hand_number', v_hand.hand_number,
      'status', v_hand.status,
      'state_version', v_state_version
    ) END,
    'correction_pending', COALESCE(v_config.correction_state = 'correction_pending', false)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_tracker_voice_validation_snapshot(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_hand_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_assignment JSONB;
  v_hand RECORD;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_state_version TEXT;
  v_players JSONB;
  v_actions JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, v_actor
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_assignment;
  END IF;

  SELECT hand_row.id, hand_row.button_seat, hand_row.status, hand_row.is_voided,
         hand_row.community_cards, hand_row.locked_by_user_id, hand_row.locked_at
  INTO v_hand
  FROM public.tournament_hands hand_row
  WHERE hand_row.id = p_hand_id
    AND hand_row.tournament_id = p_tournament_id
    AND hand_row.tournament_table_id = p_tournament_table_id
    AND hand_row.table_session_id = (v_assignment->>'table_session_id')::UUID;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_in_progress');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_lost');
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs config_row
  WHERE config_row.tournament_id = p_tournament_id
    AND config_row.tournament_table_id = p_tournament_table_id
    AND config_row.table_session_id = (v_assignment->>'table_session_id')::UUID
    AND config_row.control_epoch = (v_assignment->>'control_epoch')::BIGINT;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_not_enabled');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', hand_player.player_id,
    'entry_number', hand_player.entry_number,
    'seat_number', hand_player.seat_number,
    'starting_stack', hand_player.starting_stack
  ) ORDER BY hand_player.seat_number, hand_player.player_id, hand_player.entry_number), '[]'::JSONB)
  INTO v_players
  FROM public.hand_players hand_player
  WHERE hand_player.hand_id = p_hand_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', hand_action.player_id,
    'entry_number', hand_action.entry_number,
    'street', COALESCE(hand_action.street, 'preflop'),
    'action_type', hand_action.action_type,
    'action_amount', COALESCE(hand_action.action_amount, 0),
    'action_order', hand_action.action_order
  ) ORDER BY hand_action.action_order, hand_action.id), '[]'::JSONB)
  INTO v_actions
  FROM public.hand_actions hand_action
  WHERE hand_action.hand_id = p_hand_id;

  v_state_version := public._tracker_voice_hand_state_version(p_hand_id);
  RETURN v_assignment || jsonb_build_object(
    'ok', true,
    'hand_id', p_hand_id,
    'button_seat', v_hand.button_seat,
    'community_cards', COALESCE(v_hand.community_cards, '[]'::JSONB),
    'state_version', v_state_version,
    'correction_pending', v_config.correction_state = 'correction_pending',
    'configured_mode', v_config.configured_mode,
    'provider_model', v_config.provider_model,
    'spoken_amount_unit', v_config.spoken_amount_unit,
    'amount_unit_confirmed', v_config.amount_unit_confirmed,
    'players', v_players,
    'actions', v_actions
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_tracker_voice_floor_configs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session RECORD;
  v_reconciled INTEGER := 0;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;

  FOR v_session IN
    SELECT session_row.id
    FROM public.table_sessions session_row
    JOIN public.tournament_tables table_row
      ON table_row.table_session_id = session_row.id
    WHERE session_row.session_type = 'tournament'
      AND session_row.closed_at IS NULL
      AND session_row.control_mode = 'tracker'
      AND table_row.status = 'active'
  LOOP
    PERFORM floor_private.sync_tracker_voice_config(v_session.id, TRUE);
    v_reconciled := v_reconciled + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'reconciled_table_sessions', v_reconciled);
END;
$function$;

-- Canary enablement is deliberately narrower than the all-table reconciler.
-- Only the Edge service role can select this one exact active tracker session.
CREATE OR REPLACE FUNCTION public.reconcile_tracker_voice_floor_config(
  p_table_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_session RECORD;
  v_config_enabled BOOLEAN := FALSE;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;

  SELECT session_row.id
  INTO v_session
  FROM public.table_sessions session_row
  JOIN public.tournament_tables table_row
    ON table_row.table_session_id = session_row.id
  WHERE session_row.id = p_table_session_id
    AND session_row.session_type = 'tournament'
    AND session_row.closed_at IS NULL
    AND session_row.control_mode = 'tracker'
    AND table_row.status = 'active'
  FOR SHARE OF session_row, table_row;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_table_session_not_tracker');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.app_settings settings
    WHERE settings.key = 'tracker_voice_global_enabled'
      AND settings.value = 'true'::JSONB
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_global_disabled');
  END IF;

  PERFORM floor_private.sync_tracker_voice_config(p_table_session_id, TRUE);

  SELECT config_row.enabled
  INTO v_config_enabled
  FROM public.tracker_voice_configs config_row
  JOIN public.tournament_tables table_row
    ON table_row.id = config_row.tournament_table_id
  JOIN public.table_sessions session_row
    ON session_row.id = table_row.table_session_id
  WHERE config_row.table_session_id = p_table_session_id
    AND config_row.control_epoch = session_row.control_epoch
  FOR SHARE OF config_row, table_row, session_row;

  RETURN jsonb_build_object(
    'ok', COALESCE(v_config_enabled, FALSE),
    'table_session_id', p_table_session_id,
    'voice_enabled', COALESCE(v_config_enabled, FALSE)
  );
END;
$function$;

ALTER FUNCTION floor_private.sync_tracker_voice_config(UUID, BOOLEAN) OWNER TO postgres;
ALTER FUNCTION floor_private.sync_tracker_voice_session_trigger() OWNER TO postgres;
ALTER FUNCTION floor_private.sync_tracker_voice_tournament_table_trigger() OWNER TO postgres;
ALTER FUNCTION floor_private.sync_tracker_voice_assignment_trigger() OWNER TO postgres;
ALTER FUNCTION floor_private.sync_tracker_voice_dealer_trigger() OWNER TO postgres;
ALTER FUNCTION public._tracker_voice_assignment_context(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.get_tracker_voice_runtime_context(UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.get_tracker_voice_validation_snapshot(UUID, UUID, UUID) OWNER TO postgres;
ALTER FUNCTION public.reconcile_tracker_voice_floor_configs() OWNER TO postgres;
ALTER FUNCTION public.reconcile_tracker_voice_floor_config(UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION floor_private.sync_tracker_voice_config(UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.sync_tracker_voice_session_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.sync_tracker_voice_tournament_table_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.sync_tracker_voice_assignment_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION floor_private.sync_tracker_voice_dealer_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._tracker_voice_assignment_context(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tracker_voice_runtime_context(UUID, UUID)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_tracker_voice_validation_snapshot(UUID, UUID, UUID)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.reconcile_tracker_voice_floor_configs()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_tracker_voice_floor_config(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tracker_voice_runtime_context(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tracker_voice_validation_snapshot(UUID, UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_tracker_voice_floor_configs()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_tracker_voice_floor_config(UUID)
  TO service_role;

COMMIT;
