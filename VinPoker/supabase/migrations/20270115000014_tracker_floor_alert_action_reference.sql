-- Bind a Dealer-selected action to the source revision observed in the UI.
-- ROLLBACK: revoke v2 EXECUTE; retain alert source_revision for audit.
BEGIN;

ALTER TABLE public.tracker_floor_alerts
  ADD COLUMN IF NOT EXISTS source_revision bigint;

CREATE OR REPLACE FUNCTION public.report_tracker_floor_operational_alert_v2(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_hand_id uuid,
  p_action_id uuid,
  p_kind text,
  p_message text,
  p_request_id uuid,
  p_expected_action jsonb,
  p_source_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_prior public.tracker_floor_alerts%ROWTYPE;
  v_action public.hand_actions%ROWTYPE;
  v_current_revision bigint;
  v_snapshot jsonb;
  v_payload jsonb;
  v_receipt jsonb;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  IF (p_action_id IS NULL AND (p_expected_action IS NOT NULL OR p_source_revision IS NOT NULL))
     OR (p_action_id IS NOT NULL AND (p_hand_id IS NULL OR p_expected_action IS NULL
       OR p_source_revision IS NULL OR p_source_revision < 1)) THEN
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_action_reference');
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'tournament_id', p_tournament_id, 'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id, 'action_id', p_action_id,
    'kind', p_kind, 'message', pg_catalog.btrim(COALESCE(p_message, ''))
  );
  SELECT * INTO v_prior FROM public.tracker_floor_alerts
  WHERE reported_by = v_actor AND request_id = p_request_id FOR SHARE;
  IF FOUND THEN
    IF v_prior.request_payload IS DISTINCT FROM v_payload
       OR v_prior.source_revision IS DISTINCT FROM p_source_revision THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
    END IF;
    IF p_action_id IS NOT NULL THEN
      v_snapshot := pg_catalog.jsonb_build_object(
        'id', v_prior.source_action_snapshot->'id',
        'hand_id', v_prior.source_action_snapshot->'hand_id',
        'action_order', v_prior.source_action_snapshot->'action_order',
        'street', v_prior.source_action_snapshot->'street',
        'player_id', v_prior.source_action_snapshot->'player_id',
        'entry_number', v_prior.source_action_snapshot->'entry_number',
        'action_type', v_prior.source_action_snapshot->'action_type',
        'action_amount', v_prior.source_action_snapshot->'action_amount'
      );
      IF v_snapshot IS DISTINCT FROM p_expected_action THEN
        RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
      END IF;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'alert_id', v_prior.id, 'request_id', p_request_id,
      'kind', v_prior.alert_kind, 'hand_id', v_prior.hand_id,
      'action_id', v_prior.source_action_id,
      'source_revision', v_prior.source_revision,
      'source_state_fingerprint', v_prior.source_state_fingerprint
    );
  END IF;

  IF p_action_id IS NOT NULL THEN
    SELECT h.source_revision INTO v_current_revision
    FROM public.tournament_hands h
    WHERE h.id = p_hand_id AND h.tournament_id = p_tournament_id
      AND h.tournament_table_id = p_tournament_table_id
    FOR SHARE;
    IF NOT FOUND OR v_current_revision < p_source_revision THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_action_reference');
    END IF;
    SELECT * INTO v_action FROM public.hand_actions a
    WHERE a.id = p_action_id AND a.hand_id = p_hand_id FOR SHARE;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_action_reference');
    END IF;
    v_snapshot := pg_catalog.jsonb_build_object(
      'id', v_action.id, 'hand_id', v_action.hand_id,
      'action_order', v_action.action_order, 'street', v_action.street,
      'player_id', v_action.player_id, 'entry_number', v_action.entry_number,
      'action_type', v_action.action_type, 'action_amount', v_action.action_amount
    );
    IF v_snapshot IS DISTINCT FROM p_expected_action THEN
      RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'stale_action_reference');
    END IF;
  END IF;

  BEGIN
    v_receipt := public.report_tracker_floor_operational_alert(
      p_tournament_id, p_tournament_table_id, p_hand_id, p_action_id,
      p_kind, p_message, p_request_id
    );
    IF v_receipt->>'ok' IS DISTINCT FROM 'true' THEN RETURN v_receipt; END IF;
    IF p_action_id IS NOT NULL THEN
      UPDATE public.tracker_floor_alerts
      SET source_revision = p_source_revision
      WHERE id = (v_receipt->>'alert_id')::uuid
        AND reported_by = v_actor
        AND (source_revision IS NULL OR source_revision = p_source_revision)
        AND source_action_snapshot @> p_expected_action;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'request_key_conflict';
      END IF;
    END IF;
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    -- Roll back the legacy alert insert if revision binding lost a race.
    RETURN pg_catalog.jsonb_build_object('ok', false, 'error', 'request_key_conflict');
  END;
  RETURN v_receipt || pg_catalog.jsonb_build_object('source_revision', p_source_revision);
END;
$$;

REVOKE ALL ON FUNCTION public.report_tracker_floor_operational_alert_v2(
  uuid, uuid, uuid, uuid, text, text, uuid, jsonb, bigint
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.report_tracker_floor_operational_alert_v2(
  uuid, uuid, uuid, uuid, text, text, uuid, jsonb, bigint
) TO authenticated;

COMMIT;
