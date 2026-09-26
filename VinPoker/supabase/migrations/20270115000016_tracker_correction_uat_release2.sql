-- Tracker correction Release 2: exact-scope UAT gate, wrong-action pause, and
-- durable single-step undo. No scope rows are seeded by this migration.
-- Rollback: disable/delete UAT scope rows, then revoke the three public RPCs.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tracker_correction_uat_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  capability text NOT NULL CHECK (capability IN ('report_wrong_action', 'undo_open_hand')),
  enabled boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, tournament_table_id, user_id, capability)
);

ALTER TABLE public.tracker_correction_uat_scopes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tracker_correction_uat_scopes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tracker_correction_uat_scopes TO service_role;

CREATE TABLE IF NOT EXISTS public.tracker_correction_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
  tournament_table_id uuid NOT NULL REFERENCES public.tournament_tables(id),
  hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
  operation text NOT NULL CHECK (operation IN ('undo_open_hand')),
  idempotency_key uuid NOT NULL,
  request_hash text NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, idempotency_key)
);

ALTER TABLE public.tracker_correction_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tracker_correction_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.tracker_correction_operations TO service_role;

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
  v_assignment_count integer;
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

  IF NOT public.is_club_tracker(v_actor, v_context.club_id) THEN
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

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'actor_user_id', v_actor, 'club_id', v_context.club_id,
    'physical_table_id', v_context.physical_table_id,
    'table_session_id', v_context.table_session_id,
    'control_epoch', v_context.control_epoch,
    'source_revision', v_context.source_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.report_tracker_wrong_action_v1(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_hand_id uuid,
  p_action_id uuid,
  p_expected_action jsonb,
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
  v_action public.hand_actions%ROWTYPE;
  v_snapshot jsonb;
  v_prior public.tracker_floor_alerts%ROWTYPE;
  v_alert_id uuid;
BEGIN
  IF p_action_id IS NULL OR p_expected_action IS NULL OR p_expected_source_revision IS NULL
     OR p_expected_source_revision < 1 OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;

  SELECT * INTO v_prior FROM public.tracker_floor_alerts
  WHERE reported_by = v_actor AND request_id = p_request_id FOR SHARE;
  IF FOUND THEN
    IF v_prior.alert_kind <> 'wrong_action' OR v_prior.hand_id IS DISTINCT FROM p_hand_id
       OR v_prior.source_action_id IS DISTINCT FROM p_action_id
       OR v_prior.source_revision IS DISTINCT FROM p_expected_source_revision
       OR v_prior.source_action_snapshot IS DISTINCT FROM p_expected_action THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'duplicate', true, 'alert_id', v_prior.id,
      'request_id', p_request_id, 'correction_pending', true,
      'source_revision', v_prior.source_revision
    );
  END IF;

  v_context := public._tracker_correction_uat_context(
    p_tournament_id, p_tournament_table_id, p_hand_id, 'report_wrong_action'
  );
  IF COALESCE((v_context->>'ok')::boolean, false) IS NOT TRUE THEN RETURN v_context; END IF;
  IF (v_context->>'source_revision')::bigint <> p_expected_source_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_source_revision');
  END IF;

  SELECT * INTO v_action FROM public.hand_actions
  WHERE id = p_action_id AND hand_id = p_hand_id FOR SHARE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_action_reference'); END IF;
  v_snapshot := pg_catalog.jsonb_build_object(
    'id', v_action.id, 'hand_id', v_action.hand_id,
    'action_order', v_action.action_order, 'street', v_action.street,
    'player_id', v_action.player_id, 'entry_number', v_action.entry_number,
    'action_type', v_action.action_type, 'action_amount', v_action.action_amount
  );
  IF v_snapshot IS DISTINCT FROM p_expected_action THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_action_reference');
  END IF;

  v_alert_id := gen_random_uuid();
  INSERT INTO public.tracker_floor_alerts (
    id, club_id, tournament_id, tournament_table_id, physical_table_id,
    hand_id, dealer_id, assignment_id, reported_by,
    alert_kind, priority, correction_required, title, message,
    request_id, request_payload, source_action_id, source_action_snapshot,
    source_state_fingerprint, source_revision
  )
  SELECT v_alert_id, (v_context->>'club_id')::uuid, p_tournament_id,
    p_tournament_table_id, (v_context->>'physical_table_id')::uuid,
    p_hand_id, d.id, da.id, v_actor, 'wrong_action', 'high', true,
    'Dealer bao sai action', 'Action can duoc kiem tra va sua truoc khi tiep tuc.',
    p_request_id,
    pg_catalog.jsonb_build_object('hand_id', p_hand_id, 'action_id', p_action_id,
      'source_revision', p_expected_source_revision),
    p_action_id, v_snapshot, pg_catalog.md5(v_snapshot::text), p_expected_source_revision
  FROM public.dealers d
  JOIN public.dealer_assignments da ON da.dealer_id = d.id
  WHERE d.user_id = v_actor AND da.table_session_id = (v_context->>'table_session_id')::uuid
    AND da.table_id = (v_context->>'physical_table_id')::uuid
    AND da.status = 'assigned' AND da.released_at IS NULL
  LIMIT 1;

  UPDATE public.tracker_voice_configs
  SET correction_state = 'correction_pending', correction_alert_id = v_alert_id,
      updated_at = pg_catalog.now(), updated_by = v_actor
  WHERE tournament_id = p_tournament_id AND tournament_table_id = p_tournament_table_id;

  INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  VALUES ((v_context->>'club_id')::uuid, v_actor, 'tracker_wrong_action_reported',
    'tracker_floor_alert', v_alert_id,
    pg_catalog.jsonb_build_object('hand_id', p_hand_id, 'action_id', p_action_id,
      'source_revision', p_expected_source_revision, 'request_id', p_request_id));

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'duplicate', false, 'alert_id', v_alert_id,
    'request_id', p_request_id, 'correction_pending', true,
    'source_revision', p_expected_source_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.undo_tracker_last_action_v1(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_hand_id uuid,
  p_expected_action_id uuid,
  p_expected_source_revision bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request_hash text;
  v_existing public.tracker_correction_operations%ROWTYPE;
  v_context jsonb;
  v_last public.hand_actions%ROWTYPE;
  v_hand public.tournament_hands%ROWTYPE;
  v_board_count integer;
  v_current_street text;
  v_legacy jsonb;
  v_receipt jsonb;
BEGIN
  IF p_expected_action_id IS NULL OR p_expected_source_revision IS NULL
     OR p_expected_source_revision < 1 OR p_idempotency_key IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'tournament_id', p_tournament_id, 'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id, 'action_id', p_expected_action_id,
    'source_revision', p_expected_source_revision
  )::text);

  SELECT * INTO v_existing FROM public.tracker_correction_operations
  WHERE actor_user_id = v_actor AND idempotency_key = p_idempotency_key FOR SHARE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
    END IF;
    RETURN v_existing.receipt || pg_catalog.jsonb_build_object('duplicate', true);
  END IF;

  v_context := public._tracker_correction_uat_context(
    p_tournament_id, p_tournament_table_id, p_hand_id, 'undo_open_hand'
  );
  IF COALESCE((v_context->>'ok')::boolean, false) IS NOT TRUE THEN RETURN v_context; END IF;
  IF (v_context->>'source_revision')::bigint <> p_expected_source_revision THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_source_revision');
  END IF;

  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id FOR UPDATE;
  SELECT * INTO v_last FROM public.hand_actions WHERE hand_id = p_hand_id
  ORDER BY action_order DESC, created_at DESC, id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_last.id <> p_expected_action_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'last_action_changed');
  END IF;
  IF v_last.action_type IN ('post_sb', 'post_bb', 'post_ante') THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'undo_boundary_blind');
  END IF;
  v_board_count := pg_catalog.jsonb_array_length(COALESCE(v_hand.community_cards, '[]'::jsonb));
  v_current_street := CASE WHEN v_board_count >= 5 THEN 'river' WHEN v_board_count = 4 THEN 'turn'
    WHEN v_board_count = 3 THEN 'flop' ELSE 'preflop' END;
  IF COALESCE(v_last.street, 'preflop') <> v_current_street THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'undo_boundary_board');
  END IF;

  v_legacy := public.delete_last_action(p_hand_id, v_actor);
  IF v_legacy->>'status' IS DISTINCT FROM 'success' THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', COALESCE(v_legacy->>'error', 'undo_failed'));
  END IF;
  SELECT * INTO v_hand FROM public.tournament_hands WHERE id = p_hand_id;
  v_receipt := pg_catalog.jsonb_build_object(
    'ok', true, 'duplicate', false, 'operation', 'undo_open_hand',
    'hand_id', p_hand_id, 'undone_action_id', p_expected_action_id,
    'source_revision', v_hand.source_revision, 'deleted', v_legacy->'deleted'
  );
  INSERT INTO public.tracker_correction_operations (
    actor_user_id, tournament_id, tournament_table_id, hand_id, operation,
    idempotency_key, request_hash, receipt
  ) VALUES (
    v_actor, p_tournament_id, p_tournament_table_id, p_hand_id, 'undo_open_hand',
    p_idempotency_key, v_request_hash, v_receipt
  );
  INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  VALUES ((v_context->>'club_id')::uuid, v_actor, 'tracker_open_hand_action_undone',
    'tournament_hand', p_hand_id, v_receipt);
  RETURN v_receipt;
END;
$$;

ALTER FUNCTION public._tracker_correction_uat_context(uuid, uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.report_tracker_wrong_action_v1(uuid, uuid, uuid, uuid, jsonb, bigint, uuid) OWNER TO postgres;
ALTER FUNCTION public.undo_tracker_last_action_v1(uuid, uuid, uuid, uuid, bigint, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public._tracker_correction_uat_context(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.report_tracker_wrong_action_v1(uuid, uuid, uuid, uuid, jsonb, bigint, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.report_tracker_wrong_action_v1(uuid, uuid, uuid, uuid, jsonb, bigint, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.undo_tracker_last_action_v1(uuid, uuid, uuid, uuid, bigint, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.undo_tracker_last_action_v1(uuid, uuid, uuid, uuid, bigint, uuid)
  TO authenticated;

COMMIT;
