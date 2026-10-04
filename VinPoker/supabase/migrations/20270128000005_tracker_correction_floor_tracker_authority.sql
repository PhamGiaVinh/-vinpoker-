-- Tracker correction UAT: let exact-scoped Floor/Owner/Admin and Tracker
-- operators report a whole hand without impersonating the assigned Dealer.
-- Tracker operators still need the live hand lock; Floor authority does not.
-- Rollback: disable/delete UAT scope rows, revoke report_tracker_wrong_hand_v1,
-- then restore _tracker_correction_uat_context from migration 00016.
BEGIN;

DO $precondition$
BEGIN
  IF pg_catalog.to_regprocedure('public.is_club_floor(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public._tracker_correction_uat_context(uuid,uuid,uuid,text)') IS NULL THEN
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
  v_is_tracker boolean := false;
  v_is_floor boolean := false;
BEGIN
  IF v_actor IS NULL OR p_tournament_id IS NULL OR p_tournament_table_id IS NULL
     OR p_hand_id IS NULL OR p_capability NOT IN ('report_wrong_action', 'undo_open_hand') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

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
      AND scope_row.capability = p_capability
      AND scope_row.enabled IS TRUE
      AND (scope_row.expires_at IS NULL OR scope_row.expires_at > pg_catalog.now())
  ) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'uat_capability_disabled');
  END IF;

  v_is_tracker := COALESCE(public.is_club_tracker(v_actor, v_context.club_id), false);
  v_is_floor := COALESCE(public.is_club_floor(v_actor, v_context.club_id), false)
    OR COALESCE(public.is_club_owner(v_actor, v_context.club_id), false)
    OR COALESCE(public.is_club_admin(v_actor, v_context.club_id), false);
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

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'actor_user_id', v_actor, 'club_id', v_context.club_id,
    'physical_table_id', v_context.physical_table_id,
    'table_session_id', v_context.table_session_id,
    'control_epoch', v_context.control_epoch,
    'source_revision', v_context.source_revision,
    'actor_authority', CASE WHEN v_is_floor THEN 'floor' ELSE 'tracker' END
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
BEGIN
  IF p_expected_source_revision IS NULL OR p_expected_source_revision < 1 OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_payload := pg_catalog.jsonb_build_object(
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
      'source_revision', v_prior.source_revision, 'scope', 'whole_hand'
    );
  END IF;

  v_context := public._tracker_correction_uat_context(
    p_tournament_id, p_tournament_table_id, p_hand_id, 'report_wrong_action'
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
  WHERE tournament_id = p_tournament_id AND tournament_table_id = p_tournament_table_id;

  INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  VALUES ((v_context->>'club_id')::uuid, v_actor, 'tracker_wrong_hand_reported',
    'tracker_floor_alert', v_alert_id,
    v_payload || pg_catalog.jsonb_build_object('request_id', p_request_id,
      'actor_authority', v_context->>'actor_authority'));

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'duplicate', false, 'alert_id', v_alert_id,
    'request_id', p_request_id, 'correction_pending', true,
    'source_revision', p_expected_source_revision, 'scope', 'whole_hand'
  );
END;
$$;

ALTER FUNCTION public._tracker_correction_uat_context(uuid, uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.report_tracker_wrong_hand_v1(uuid, uuid, uuid, bigint, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._tracker_correction_uat_context(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_tracker_wrong_hand_v1(uuid, uuid, uuid, bigint, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.report_tracker_wrong_hand_v1(uuid, uuid, uuid, bigint, uuid)
  TO authenticated;

COMMIT;
