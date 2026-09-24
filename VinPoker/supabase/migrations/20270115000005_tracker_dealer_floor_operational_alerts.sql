-- Dealer Floor requests are operational alerts, not poker-state mutations.
-- Rollback: revoke the new RPC; retain alert columns and rows for audit.
BEGIN;

ALTER TABLE public.tracker_floor_alerts
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS request_payload jsonb,
  ADD COLUMN IF NOT EXISTS source_action_id uuid,
  ADD COLUMN IF NOT EXISTS source_action_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS source_state_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tracker_floor_alerts_dealer_request
  ON public.tracker_floor_alerts (reported_by, request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.tracker_floor_alerts
  DROP CONSTRAINT IF EXISTS tracker_floor_alerts_alert_kind_check;
ALTER TABLE public.tracker_floor_alerts
  ADD CONSTRAINT tracker_floor_alerts_alert_kind_check
  CHECK (alert_kind IN ('wrong_action', 'call_floor', 'display_issue'));

CREATE OR REPLACE FUNCTION public.report_tracker_floor_operational_alert(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_hand_id uuid,
  p_action_id uuid,
  p_kind text,
  p_message text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_context record;
  v_assignment record;
  v_assignment_count integer;
  v_hand public.tournament_hands%ROWTYPE;
  v_action public.hand_actions%ROWTYPE;
  v_prior public.tracker_floor_alerts%ROWTYPE;
  v_payload jsonb;
  v_alert_id uuid;
  v_fingerprint text;
  v_message text := pg_catalog.btrim(COALESCE(p_message, ''));
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR p_tournament_id IS NULL
     OR p_tournament_table_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('call_floor', 'display_issue')
     OR (p_action_id IS NOT NULL AND p_hand_id IS NULL)
     OR pg_catalog.char_length(v_message) > 500 THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id,
    'action_id', p_action_id,
    'kind', p_kind,
    'message', v_message
  );

  SELECT * INTO v_prior
  FROM public.tracker_floor_alerts
  WHERE reported_by = v_actor AND request_id = p_request_id
  FOR SHARE;
  IF FOUND AND v_prior.request_payload IS DISTINCT FROM v_payload THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
  END IF;

  SELECT t.club_id, tt.game_table_id AS physical_table_id,
         tt.table_session_id, tt.status AS table_status,
         s.control_mode, s.closed_at
  INTO v_context
  FROM public.tournaments t
  JOIN public.tournament_tables tt
    ON tt.tournament_id = t.id AND tt.id = p_tournament_table_id
  JOIN public.table_sessions s
    ON s.id = tt.table_session_id
   AND s.tournament_id = t.id
   AND s.game_table_id = tt.game_table_id
  WHERE t.id = p_tournament_id
  FOR SHARE OF t, tt, s;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_tracker_context');
  END IF;
  IF v_context.control_mode <> 'tracker' OR v_context.table_status <> 'active'
     OR v_context.closed_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_tracker_context');
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
  SELECT d.id AS dealer_id, da.id AS assignment_id INTO v_assignment
  FROM public.dealers d
  JOIN public.dealer_assignments da ON da.dealer_id = d.id
  JOIN public.dealer_attendance attendance ON attendance.id = da.attendance_id
  WHERE d.user_id = v_actor AND d.club_id = v_context.club_id
    AND d.status = 'active' AND da.table_id = v_context.physical_table_id
    AND da.table_session_id = v_context.table_session_id
    AND da.status = 'assigned' AND da.released_at IS NULL
    AND attendance.status IN ('checked_in', 'overtime')
    AND attendance.check_out_time IS NULL
  FOR SHARE OF d, da, attendance;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'dealer_assignment_changed');
  END IF;

  IF v_prior.id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'alert_id', v_prior.id, 'request_id', p_request_id,
      'kind', v_prior.alert_kind, 'hand_id', v_prior.hand_id,
      'action_id', v_prior.source_action_id,
      'source_state_fingerprint', v_prior.source_state_fingerprint
    );
  END IF;

  IF p_hand_id IS NOT NULL THEN
    SELECT * INTO v_hand
    FROM public.tournament_hands h
    WHERE h.id = p_hand_id AND h.tournament_id = p_tournament_id
      AND h.tournament_table_id = p_tournament_table_id
      AND h.table_session_id = v_context.table_session_id
    FOR SHARE;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'hand_context_mismatch');
    END IF;
  END IF;
  IF p_action_id IS NOT NULL THEN
    SELECT * INTO v_action
    FROM public.hand_actions a
    WHERE a.id = p_action_id AND a.hand_id = p_hand_id
    FOR SHARE;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'action_context_mismatch');
    END IF;
  END IF;

  IF p_hand_id IS NOT NULL THEN
    SELECT pg_catalog.md5(
      pg_catalog.to_jsonb(v_hand)::text || ':' ||
      COALESCE(pg_catalog.string_agg(pg_catalog.to_jsonb(a)::text,
        ',' ORDER BY a.action_order, a.id), '')
    ) INTO v_fingerprint
    FROM public.hand_actions a
    WHERE a.hand_id = p_hand_id;
  END IF;

  INSERT INTO public.tracker_floor_alerts (
    club_id, tournament_id, tournament_table_id, physical_table_id,
    hand_id, dealer_id, assignment_id, reported_by,
    alert_kind, priority, correction_required, title, message,
    request_id, request_payload, source_action_id,
    source_action_snapshot, source_state_fingerprint
  ) VALUES (
    v_context.club_id, p_tournament_id, p_tournament_table_id,
    v_context.physical_table_id, p_hand_id,
    v_assignment.dealer_id, v_assignment.assignment_id, v_actor,
    p_kind, CASE WHEN p_kind = 'call_floor' THEN 'urgent' ELSE 'high' END,
    false,
    CASE WHEN p_kind = 'call_floor' THEN 'Dealer goi Floor' ELSE 'Van de hien thi Tracker' END,
    NULLIF(v_message, ''), p_request_id, v_payload, p_action_id,
    CASE WHEN p_action_id IS NULL THEN NULL ELSE pg_catalog.to_jsonb(v_action) END,
    v_fingerprint
  ) ON CONFLICT (reported_by, request_id) WHERE request_id IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_alert_id;

  IF v_alert_id IS NULL THEN
    SELECT * INTO v_prior FROM public.tracker_floor_alerts
    WHERE reported_by = v_actor AND request_id = p_request_id;
    IF v_prior.request_payload IS DISTINCT FROM v_payload THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
    END IF;
    v_alert_id := v_prior.id;
    v_fingerprint := v_prior.source_state_fingerprint;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'alert_id', v_alert_id, 'request_id', p_request_id,
    'kind', p_kind, 'hand_id', p_hand_id, 'action_id', p_action_id,
    'source_state_fingerprint', v_fingerprint
  );
END;
$$;

REVOKE ALL ON FUNCTION public.report_tracker_floor_operational_alert(
  uuid, uuid, uuid, uuid, text, text, uuid
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.report_tracker_floor_operational_alert(
  uuid, uuid, uuid, uuid, text, text, uuid
) TO authenticated;

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
  SELECT t.club_id INTO v_club_id FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_actor IS NULL OR NOT (
    public.is_club_floor(v_actor, v_club_id)
    OR public.is_club_tracker(v_actor, v_club_id)
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
    'dealer_name', d.full_name, 'alert_kind', a.alert_kind,
    'priority', a.priority, 'status', a.status, 'version', a.version,
    'correction_required', a.correction_required,
    'title', a.title, 'message', a.message,
    'source_action_id', a.source_action_id,
    'source_action_snapshot', a.source_action_snapshot,
    'source_state_fingerprint', a.source_state_fingerprint,
    'created_at', a.created_at, 'updated_at', a.updated_at
  ) ORDER BY CASE a.priority WHEN 'urgent' THEN 0 ELSE 1 END, a.created_at), '[]'::jsonb)
  INTO v_items
  FROM public.tracker_floor_alerts a
  JOIN public.dealers d ON d.id = a.dealer_id
  WHERE a.tournament_id = p_tournament_id
    AND (p_status IS NULL OR a.status = p_status);

  RETURN pg_catalog.jsonb_build_object('ok', true, 'alerts', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.list_tracker_floor_alerts(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_tracker_floor_alerts(uuid, text)
  TO authenticated;

COMMIT;
