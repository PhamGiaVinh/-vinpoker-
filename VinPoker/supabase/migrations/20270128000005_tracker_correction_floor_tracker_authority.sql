-- Tracker correction UAT: let exact-scoped Floor/Owner/Admin and Tracker
-- operators report a whole hand without impersonating the assigned Dealer.
-- Tracker operators still need the live hand lock; Floor authority does not.
-- Rollback (owner-gated): disable UAT scope rows; restore the helper from
-- migration 00016 and the alert policy/reader from migration 00005; remove
-- this RPC; restore NOT NULL only after proving no whole-hand NULL rows remain.
BEGIN;

DO $precondition$
BEGIN
  IF pg_catalog.to_regprocedure('public.is_club_floor(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.is_club_owner(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.is_club_admin(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public._tracker_correction_uat_context(uuid,uuid,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public._block_tracker_progress_while_correction_pending()') IS NULL
     OR pg_catalog.to_regprocedure('public.list_tracker_floor_alerts(uuid,text)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgname = 'trg_block_tracker_action_while_correction_pending'
         AND tgrelid = 'public.hand_actions'::pg_catalog.regclass
         AND NOT tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
       WHERE tgname = 'trg_block_tracker_hand_progress_while_correction_pending'
         AND tgrelid = 'public.tournament_hands'::pg_catalog.regclass
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'tracker_correction_floor_tracker_authority_precondition_failed';
  END IF;
END;
$precondition$;

ALTER TABLE public.tracker_floor_alerts
  ALTER COLUMN dealer_id DROP NOT NULL,
  ALTER COLUMN assignment_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public._tracker_correction_uat_context(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_hand_id uuid,
  p_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_context record;
  v_assignment_count integer := 0;
  v_is_tracker boolean := false;
  v_is_floor boolean := false;
  v_scope_capability text;
BEGIN
  IF v_actor IS NULL OR p_tournament_id IS NULL OR p_tournament_table_id IS NULL
     OR p_hand_id IS NULL
     OR p_capability NOT IN ('report_wrong_action', 'report_wrong_hand', 'undo_open_hand') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_scope_capability := CASE
    WHEN p_capability = 'report_wrong_hand' THEN 'report_wrong_action'
    ELSE p_capability
  END;

  SELECT t.club_id, tt.game_table_id AS physical_table_id, tt.table_session_id,
         tt.status AS table_status, s.control_mode, s.control_epoch, s.closed_at,
         h.status AS hand_status, h.is_voided, h.source_revision,
         h.locked_by_user_id, h.locked_at
  INTO v_context
  FROM public.tournaments t
  JOIN public.tournament_tables tt
    ON tt.tournament_id = t.id AND tt.id = p_tournament_table_id
  JOIN public.table_sessions s
    ON s.id = tt.table_session_id AND s.tournament_id = t.id
   AND s.game_table_id = tt.game_table_id
  JOIN public.tournament_hands h
    ON h.id = p_hand_id AND h.tournament_id = t.id
   AND h.tournament_table_id = tt.id AND h.table_session_id = s.id
  WHERE t.id = p_tournament_id
  FOR SHARE OF t, tt, s, h;
  IF NOT FOUND OR v_context.table_status <> 'active' OR v_context.control_mode <> 'tracker'
     OR v_context.closed_at IS NOT NULL OR v_context.hand_status <> 'in_progress'
     OR COALESCE(v_context.is_voided, false) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_tracker_context');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tracker_correction_uat_scopes scope_row
    WHERE scope_row.club_id = v_context.club_id
      AND scope_row.tournament_id = p_tournament_id
      AND scope_row.tournament_table_id = p_tournament_table_id
      AND scope_row.user_id = v_actor
      AND scope_row.capability = v_scope_capability
      AND scope_row.enabled IS TRUE
      AND (scope_row.expires_at IS NULL OR scope_row.expires_at > pg_catalog.now())
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'uat_capability_disabled');
  END IF;

  v_is_tracker := COALESCE(public.is_club_tracker(v_actor, v_context.club_id), false);
  v_is_floor := COALESCE(public.is_club_floor(v_actor, v_context.club_id), false)
    OR COALESCE(public.is_club_owner(v_actor, v_context.club_id), false)
    OR COALESCE(public.is_club_admin(v_actor, v_context.club_id), false);
  IF p_capability = 'report_wrong_hand' THEN
    IF NOT v_is_tracker AND NOT v_is_floor THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
    END IF;
    IF v_is_tracker AND NOT v_is_floor AND (
      v_context.locked_by_user_id IS DISTINCT FROM v_actor
      OR v_context.locked_at IS NULL
      OR v_context.locked_at <= pg_catalog.now() - public.tracker_lock_ttl()
    ) THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tracker_lock_not_owned');
    END IF;
  ELSE
    -- Existing action-level report and undo callers keep their original
    -- Tracker + exact Dealer assignment + live lock authority. Floor/Owner
    -- whole-hand reporting must never become edit or undo authority.
    IF NOT v_is_tracker THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
    END IF;
    SELECT pg_catalog.count(*) INTO v_assignment_count
    FROM public.dealers d
    JOIN public.dealer_assignments da ON da.dealer_id = d.id
    JOIN public.dealer_attendance attendance ON attendance.id = da.attendance_id
    WHERE d.user_id = v_actor AND d.club_id = v_context.club_id
      AND d.status = 'active' AND da.table_id = v_context.physical_table_id
      AND da.table_session_id = v_context.table_session_id
      AND da.status = 'assigned' AND da.released_at IS NULL
      AND attendance.status IN ('checked_in', 'overtime')
      AND attendance.check_out_time IS NULL;
    IF v_assignment_count <> 1 THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'dealer_assignment_not_unique');
    END IF;
    IF v_context.locked_by_user_id IS DISTINCT FROM v_actor
       OR v_context.locked_at IS NULL
       OR v_context.locked_at <= pg_catalog.now() - public.tracker_lock_ttl() THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tracker_lock_not_owned');
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'actor_user_id', v_actor, 'club_id', v_context.club_id,
    'physical_table_id', v_context.physical_table_id,
    'table_session_id', v_context.table_session_id,
    'control_epoch', v_context.control_epoch,
    'source_revision', v_context.source_revision,
    'actor_authority', CASE WHEN v_is_floor THEN 'floor' ELSE 'tracker' END,
    'capability', p_capability
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.report_tracker_wrong_hand_v1(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_hand_id uuid,
  p_expected_source_revision bigint,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_prior public.tracker_floor_alerts%ROWTYPE;
  v_alert_id uuid;
  v_payload jsonb;
  v_voice_config_updates integer := 0;
BEGIN
  IF p_expected_source_revision IS NULL OR p_expected_source_revision < 1 OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_payload := pg_catalog.jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id, 'source_revision', p_expected_source_revision,
    'scope', 'whole_hand'
  );

  SELECT * INTO v_prior FROM public.tracker_floor_alerts
  WHERE reported_by = v_actor AND request_id = p_request_id FOR SHARE;
  IF FOUND THEN
    IF v_prior.alert_kind <> 'wrong_action' OR v_prior.hand_id IS DISTINCT FROM p_hand_id
       OR v_prior.source_action_id IS NOT NULL
       OR v_prior.source_revision IS DISTINCT FROM p_expected_source_revision
       OR v_prior.request_payload IS DISTINCT FROM v_payload THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'duplicate', true, 'alert_id', v_prior.id,
      'request_id', p_request_id, 'correction_pending', true,
      'source_revision', v_prior.source_revision, 'scope', 'whole_hand',
      'progression_guard', 'tracker_floor_alert'
    );
  END IF;

  v_context := public._tracker_correction_uat_context(
    p_tournament_id, p_tournament_table_id, p_hand_id, 'report_wrong_hand'
  );
  IF COALESCE((v_context->>'ok')::boolean, false) IS NOT TRUE THEN RETURN v_context; END IF;
  IF (v_context->>'source_revision')::bigint <> p_expected_source_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_source_revision');
  END IF;

  v_alert_id := gen_random_uuid();
  INSERT INTO public.tracker_floor_alerts (
    id, club_id, tournament_id, tournament_table_id, physical_table_id,
    hand_id, dealer_id, assignment_id, reported_by,
    alert_kind, priority, correction_required, title, message,
    request_id, request_payload, source_action_id, source_action_snapshot,
    source_state_fingerprint, source_revision
  ) VALUES (
    v_alert_id, (v_context->>'club_id')::uuid, p_tournament_id,
    p_tournament_table_id, (v_context->>'physical_table_id')::uuid,
    p_hand_id, NULL, NULL, v_actor,
    'wrong_action', 'high', true, 'Bao sai hand',
    'Floor can xem toan bo hand va chon diem bat dau sua.',
    p_request_id, v_payload, NULL, NULL,
    pg_catalog.md5(v_payload::text), p_expected_source_revision
  );

  UPDATE public.tracker_voice_configs
  SET correction_state = 'correction_pending', correction_alert_id = v_alert_id,
      updated_at = pg_catalog.now(), updated_by = v_actor
  WHERE tournament_id = p_tournament_id
    AND tournament_table_id = p_tournament_table_id
    AND table_session_id = (v_context->>'table_session_id')::uuid;
  GET DIAGNOSTICS v_voice_config_updates = ROW_COUNT;

  INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  VALUES ((v_context->>'club_id')::uuid, v_actor, 'tracker_wrong_hand_reported',
    'tracker_floor_alert', v_alert_id,
    v_payload || pg_catalog.jsonb_build_object('request_id', p_request_id,
      'actor_authority', v_context->>'actor_authority',
      'table_session_id', v_context->>'table_session_id'));

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'duplicate', false, 'alert_id', v_alert_id,
    'request_id', p_request_id, 'correction_pending', true,
    'source_revision', p_expected_source_revision, 'scope', 'whole_hand',
    'progression_guard', 'tracker_floor_alert',
    'voice_config_updated', v_voice_config_updates > 0
  );
END;
$$;

-- Direct alert readers and the shared RPC must keep whole-hand reports even
-- though those reports intentionally have no Dealer, assignment, or action.
DROP POLICY IF EXISTS tracker_floor_alerts_select_ops ON public.tracker_floor_alerts;
CREATE POLICY tracker_floor_alerts_select_ops
  ON public.tracker_floor_alerts FOR SELECT TO authenticated
  USING (
    public.is_club_tracker((SELECT auth.uid()), club_id)
    OR public.is_club_floor((SELECT auth.uid()), club_id)
    OR public.is_club_owner((SELECT auth.uid()), club_id)
    OR public.is_club_admin((SELECT auth.uid()), club_id)
    OR (
      reported_by = (SELECT auth.uid())
      AND (
        assignment_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.dealer_assignments da
          WHERE da.id = tracker_floor_alerts.assignment_id
            AND da.status = 'assigned'
            AND da.released_at IS NULL
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.list_tracker_floor_alerts(
  p_tournament_id uuid,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_items jsonb;
BEGIN
  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_actor IS NULL OR NOT (
    COALESCE(public.is_club_floor(v_actor, v_club_id), false)
    OR COALESCE(public.is_club_owner(v_actor, v_club_id), false)
    OR COALESCE(public.is_club_admin(v_actor, v_club_id), false)
    OR COALESCE(public.is_club_tracker(v_actor, v_club_id), false)
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN
    ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_alert_status');
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', a.id, 'tournament_id', a.tournament_id,
    'tournament_table_id', a.tournament_table_id,
    'physical_table_id', a.physical_table_id,
    'hand_id', a.hand_id, 'dealer_id', a.dealer_id,
    'assignment_id', a.assignment_id, 'reported_by', a.reported_by,
    'dealer_name', d.full_name, 'alert_kind', a.alert_kind,
    'priority', a.priority, 'status', a.status, 'version', a.version,
    'correction_required', a.correction_required,
    'title', a.title, 'message', a.message,
    'source_action_id', a.source_action_id,
    'source_action_snapshot', a.source_action_snapshot,
    'source_state_fingerprint', a.source_state_fingerprint,
    'source_revision', a.source_revision,
    'created_at', a.created_at, 'updated_at', a.updated_at
  ) ORDER BY CASE a.priority WHEN 'urgent' THEN 0 ELSE 1 END, a.created_at), '[]'::jsonb)
  INTO v_items
  FROM public.tracker_floor_alerts a
  LEFT JOIN public.dealers d ON d.id = a.dealer_id
  WHERE a.tournament_id = p_tournament_id
    AND (p_status IS NULL OR a.status = p_status);

  RETURN pg_catalog.jsonb_build_object('ok', true, 'alerts', v_items);
END;
$$;

ALTER FUNCTION public._tracker_correction_uat_context(uuid, uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.report_tracker_wrong_hand_v1(uuid, uuid, uuid, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.list_tracker_floor_alerts(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._tracker_correction_uat_context(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_tracker_wrong_hand_v1(uuid, uuid, uuid, bigint, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.report_tracker_wrong_hand_v1(uuid, uuid, uuid, bigint, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.list_tracker_floor_alerts(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_tracker_floor_alerts(uuid, text)
  TO authenticated;

COMMIT;
