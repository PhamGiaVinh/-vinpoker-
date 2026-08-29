-- Dealer Swing shortage alert lifecycle.
-- SUPERSEDES (NEVER APPLY): 20270104000005_dealer_shortage_alert_lifecycle.sql.
-- ROLLBACK: revoke the two functions, then drop dealer_shortage_alert_incidents
-- only after confirming no audit retention requirement exists.

CREATE TABLE IF NOT EXISTS public.dealer_shortage_alert_incidents (
  id                              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  club_id                         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  incident_key                    text NOT NULL,
  classification                  text NOT NULL CHECK (classification IN (
                                    'healthy', 'temporary_wait', 'reserved_relief_pending',
                                    'true_shortage', 'critical_shortage', 'snapshot_invalid'
                                  )),
  severity                        smallint NOT NULL DEFAULT 0 CHECK (severity BETWEEN 0 AND 2),
  status                          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'expired')),
  first_detected_at               timestamptz NOT NULL DEFAULT now(),
  last_detected_at                timestamptz NOT NULL DEFAULT now(),
  last_notified_at                timestamptz,
  last_notification_attempt_at    timestamptz,
  notification_count              integer NOT NULL DEFAULT 0 CHECK (notification_count >= 0),
  resolved_at                     timestamptz,
  resolution_pending_at           timestamptz,
  resolution_notified_at          timestamptz,
  notification_claim_id           uuid,
  notification_claimed_at         timestamptz,
  notification_claim_kind         text CHECK (notification_claim_kind IN ('opened', 'reminder', 'escalated', 'resolved')),
  snapshot                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code                      text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealer_shortage_alert_incidents_club_key_unique UNIQUE (club_id, incident_key),
  CONSTRAINT dealer_shortage_alert_incidents_snapshot_object CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT dealer_shortage_alert_incidents_snapshot_size CHECK (octet_length(snapshot::text) <= 8000),
  CONSTRAINT dealer_shortage_alert_incidents_error_code_safe CHECK (
    error_code IS NULL OR error_code ~ '^[A-Za-z0-9_]{1,96}$'
  )
);

CREATE INDEX IF NOT EXISTS idx_dealer_shortage_alert_incidents_open
  ON public.dealer_shortage_alert_incidents (club_id, status, updated_at DESC)
  WHERE status IN ('open', 'acknowledged');

ALTER TABLE public.dealer_shortage_alert_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_shortage_alert_incidents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dealer_shortage_alert_incidents TO service_role;

CREATE OR REPLACE FUNCTION public.advance_dealer_shortage_alert_incident(
  p_club_id uuid,
  p_incident_key text,
  p_classification text,
  p_severity smallint,
  p_snapshot jsonb,
  p_error_code text,
  p_notify_enabled boolean,
  p_cooldown_seconds integer DEFAULT 600,
  p_resolution_debounce_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_incident public.dealer_shortage_alert_incidents%ROWTYPE;
  v_now timestamptz := now();
  v_previous_severity smallint := 0;
  v_notification text := 'none';
  v_claim_id uuid;
  v_snapshot jsonb;
  v_error_code text;
  v_existing boolean := false;
  v_created boolean := false;
  v_inserted_count bigint := 0;
BEGIN
  IF p_club_id IS NULL
     OR p_incident_key IS NULL OR length(p_incident_key) NOT BETWEEN 1 AND 128
     OR p_classification NOT IN ('healthy', 'temporary_wait', 'reserved_relief_pending', 'true_shortage', 'critical_shortage', 'snapshot_invalid')
     OR p_severity NOT BETWEEN 0 AND 2
     OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR octet_length(p_snapshot::text) > 8000
     OR greatest(p_cooldown_seconds, 0) > 86400
     OR greatest(p_resolution_debounce_seconds, 0) > 3600 THEN
    RETURN jsonb_build_object('outcome', 'invalid_request', 'notification', 'none');
  END IF;

  v_snapshot := p_snapshot;
  v_error_code := CASE
    WHEN p_error_code ~ '^[A-Za-z0-9_]{1,96}$' THEN p_error_code
    ELSE NULL
  END;

  SELECT * INTO v_incident
  FROM public.dealer_shortage_alert_incidents
  WHERE club_id = p_club_id
    AND incident_key = p_incident_key
  FOR UPDATE;
  v_existing := FOUND;

  IF NOT v_existing AND p_severity = 0 THEN
    RETURN jsonb_build_object('outcome', 'no_open_incident', 'notification', 'none');
  END IF;

  IF NOT v_existing THEN
    INSERT INTO public.dealer_shortage_alert_incidents (
      club_id, incident_key, classification, severity, status,
      first_detected_at, last_detected_at, snapshot, error_code
    ) VALUES (
      p_club_id, p_incident_key, p_classification, p_severity, 'open',
      v_now, v_now, v_snapshot, v_error_code
    )
    ON CONFLICT (club_id, incident_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    v_created := v_inserted_count > 0;

    SELECT * INTO v_incident
    FROM public.dealer_shortage_alert_incidents
    WHERE club_id = p_club_id
      AND incident_key = p_incident_key
    FOR UPDATE;
    v_existing := true;
  END IF;

  v_previous_severity := v_incident.severity;

  IF p_severity = 0 THEN
    IF p_classification = 'healthy' AND v_incident.status IN ('open', 'acknowledged') THEN
      IF v_incident.resolution_pending_at IS NULL THEN
        UPDATE public.dealer_shortage_alert_incidents
        SET classification = p_classification,
            severity = 0,
            resolution_pending_at = v_now,
            snapshot = v_snapshot,
            error_code = v_error_code,
            updated_at = v_now
        WHERE id = v_incident.id
        RETURNING * INTO v_incident;
      ELSIF v_now >= v_incident.resolution_pending_at
          + make_interval(secs => greatest(p_resolution_debounce_seconds, 0)) THEN
        UPDATE public.dealer_shortage_alert_incidents
        SET classification = p_classification,
            severity = 0,
            status = 'resolved',
            resolved_at = v_now,
            snapshot = v_snapshot,
            error_code = v_error_code,
            updated_at = v_now
        WHERE id = v_incident.id
        RETURNING * INTO v_incident;
        IF p_notify_enabled AND v_incident.resolution_notified_at IS NULL
           AND (v_incident.notification_claimed_at IS NULL
                OR v_incident.notification_claimed_at < v_now - interval '2 minutes') THEN
          v_notification := 'resolved';
        END IF;
      END IF;
    ELSE
      UPDATE public.dealer_shortage_alert_incidents
      SET classification = p_classification,
          severity = 0,
          resolution_pending_at = NULL,
          snapshot = v_snapshot,
          error_code = v_error_code,
          updated_at = v_now
      WHERE id = v_incident.id
      RETURNING * INTO v_incident;
    END IF;
  ELSE
    UPDATE public.dealer_shortage_alert_incidents
    SET classification = p_classification,
        severity = p_severity,
        status = 'open',
        first_detected_at = CASE WHEN v_incident.status IN ('resolved', 'expired') THEN v_now ELSE v_incident.first_detected_at END,
        last_detected_at = v_now,
        resolved_at = NULL,
        resolution_pending_at = NULL,
        snapshot = v_snapshot,
        error_code = v_error_code,
        updated_at = v_now
    WHERE id = v_incident.id
    RETURNING * INTO v_incident;

    IF p_notify_enabled
       AND (v_incident.notification_claimed_at IS NULL
            OR v_incident.notification_claimed_at < v_now - interval '2 minutes') THEN
      IF v_created OR v_previous_severity = 0 THEN
        v_notification := 'opened';
      ELSIF p_severity > v_previous_severity THEN
        v_notification := 'escalated';
      ELSIF COALESCE(v_incident.last_notification_attempt_at, v_incident.last_notified_at, '-infinity'::timestamptz)
          <= v_now - make_interval(secs => greatest(p_cooldown_seconds, 0)) THEN
        v_notification := 'reminder';
      END IF;
    END IF;
  END IF;

  IF v_notification <> 'none' THEN
    v_claim_id := extensions.gen_random_uuid();
    UPDATE public.dealer_shortage_alert_incidents
    SET notification_claim_id = v_claim_id,
        notification_claimed_at = v_now,
        notification_claim_kind = v_notification,
        updated_at = v_now
    WHERE id = v_incident.id;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'recorded',
    'incident_id', v_incident.id,
    'notification', v_notification,
    'claim_id', v_claim_id,
    'status', v_incident.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.advance_dealer_shortage_alert_incident(
  uuid, text, text, smallint, jsonb, text, boolean, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_dealer_shortage_alert_incident(
  uuid, text, text, smallint, jsonb, text, boolean, integer, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_dealer_shortage_alert_notification(
  p_incident_id uuid,
  p_claim_id uuid,
  p_delivered boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_incident public.dealer_shortage_alert_incidents%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_incident_id IS NULL OR p_claim_id IS NULL OR p_delivered IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_request');
  END IF;

  SELECT * INTO v_incident
  FROM public.dealer_shortage_alert_incidents
  WHERE id = p_incident_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_incident.notification_claim_id IS DISTINCT FROM p_claim_id THEN
    RETURN jsonb_build_object('outcome', 'claim_lost');
  END IF;

  UPDATE public.dealer_shortage_alert_incidents
  SET notification_claim_id = NULL,
      notification_claimed_at = NULL,
      notification_claim_kind = NULL,
      last_notification_attempt_at = v_now,
      last_notified_at = CASE WHEN p_delivered THEN v_now ELSE last_notified_at END,
      notification_count = notification_count + CASE WHEN p_delivered THEN 1 ELSE 0 END,
      resolution_notified_at = CASE
        WHEN p_delivered AND v_incident.notification_claim_kind = 'resolved' THEN v_now
        ELSE resolution_notified_at
      END,
      updated_at = v_now
  WHERE id = v_incident.id;

  RETURN jsonb_build_object('outcome', CASE WHEN p_delivered THEN 'delivered' ELSE 'failed' END);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_dealer_shortage_alert_notification(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_dealer_shortage_alert_notification(uuid, uuid, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
