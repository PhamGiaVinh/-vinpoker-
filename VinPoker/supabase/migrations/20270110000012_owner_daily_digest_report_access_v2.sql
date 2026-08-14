-- Owner Daily Digest V2 — immutable snapshot read boundary and scoped manager access.
--
-- SOURCE-ONLY / CRITICAL. Applying this migration requires the controlled production
-- database runbook and an explicit Owner gate. The V2 web capability remains OFF in source.
-- No notification, payout, payroll or other canonical money state is mutated here.
--
-- Candidate model:
--   * Super Admin prepares a specific existing `club_admin` for one Club.
--   * The Club Owner may grant/revoke read-only Digest access only for prepared candidates.
--   * Global `club_admin` role alone never grants access.
--   * Manager events are append-only. Current authorization is derived from the latest event.
--
-- ROLLBACK (append-only follow-up migration only; never edit this file after apply):
--   1. Disable every club's owner_daily_digest_settings_v2.manager_access_enabled.
--   2. Drop owner_daily_digest_v1_scope_sync_v2 in the follow-up migration.
--   3. Revoke EXECUTE on the V2 public functions from authenticated.
--   4. Keep snapshot, request and manager-event ledgers for audit; do not delete them.

CREATE TABLE IF NOT EXISTS private.owner_daily_digest_manager_events_v2 (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'CANDIDATE_PREPARED',
    'CANDIDATE_WITHDRAWN',
    'ACCESS_GRANTED',
    'ACCESS_REVOKED'
  )),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9_]{3,64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Keeps local re-application after an interrupted disposable test compatible.
ALTER TABLE private.owner_daily_digest_manager_events_v2
  ADD COLUMN IF NOT EXISTS event_sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS owner_digest_manager_events_sequence_v2_uidx
  ON private.owner_daily_digest_manager_events_v2 (event_sequence);

CREATE INDEX IF NOT EXISTS owner_digest_manager_events_state_v2_idx
  ON private.owner_daily_digest_manager_events_v2
  (club_id, user_id, event_type, event_sequence DESC);

REVOKE ALL ON TABLE private.owner_daily_digest_manager_events_v2
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE private.owner_daily_digest_manager_events_v2
  TO service_role;

CREATE OR REPLACE FUNCTION private.reject_owner_digest_manager_event_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, private, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'owner digest manager events are append-only'
    USING ERRCODE = '55000';
END;
$function$;

DROP TRIGGER IF EXISTS owner_digest_manager_events_immutable_v2
  ON private.owner_daily_digest_manager_events_v2;
CREATE TRIGGER owner_digest_manager_events_immutable_v2
  BEFORE UPDATE OR DELETE ON private.owner_daily_digest_manager_events_v2
  FOR EACH ROW EXECUTE FUNCTION private.reject_owner_digest_manager_event_mutation_v2();

REVOKE ALL ON FUNCTION private.reject_owner_digest_manager_event_mutation_v2()
  FROM PUBLIC, anon, authenticated;

-- Preserve already-authorized V1 Club Admin scopes when V2 is later enabled.
-- These inserts are deterministic for a one-time migration and do not broaden the V1 scope.
DO $migration$
BEGIN
  IF to_regclass('public.owner_daily_digest_club_admin_scopes') IS NOT NULL THEN
    EXECUTE $seed$
      INSERT INTO private.owner_daily_digest_manager_events_v2 (
        club_id, user_id, event_type, actor_user_id, reason_code, created_at
      )
      SELECT s.club_id, s.user_id, 'CANDIDATE_PREPARED', s.granted_by,
             'MIGRATED_V1_SCOPE', s.created_at
      FROM public.owner_daily_digest_club_admin_scopes s
      WHERE NOT EXISTS (
        SELECT 1
        FROM private.owner_daily_digest_manager_events_v2 e
        WHERE e.club_id = s.club_id
          AND e.user_id = s.user_id
          AND e.event_type = 'CANDIDATE_PREPARED'
          AND e.reason_code = 'MIGRATED_V1_SCOPE'
      )
    $seed$;

    EXECUTE $seed$
      INSERT INTO private.owner_daily_digest_manager_events_v2 (
        club_id, user_id, event_type, actor_user_id, reason_code, created_at
      )
      SELECT s.club_id, s.user_id, 'ACCESS_GRANTED', s.granted_by,
             'MIGRATED_V1_SCOPE', s.created_at + interval '1 microsecond'
      FROM public.owner_daily_digest_club_admin_scopes s
      WHERE NOT EXISTS (
        SELECT 1
        FROM private.owner_daily_digest_manager_events_v2 e
        WHERE e.club_id = s.club_id
          AND e.user_id = s.user_id
          AND e.event_type = 'ACCESS_GRANTED'
          AND e.reason_code = 'MIGRATED_V1_SCOPE'
      )
    $seed$;
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION private.owner_daily_digest_candidate_active_v2(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT e.event_type = 'CANDIDATE_PREPARED'
    FROM private.owner_daily_digest_manager_events_v2 e
    WHERE e.club_id = p_club_id
      AND e.user_id = p_user_id
      AND e.event_type IN ('CANDIDATE_PREPARED', 'CANDIDATE_WITHDRAWN')
    ORDER BY e.event_sequence DESC
    LIMIT 1
  ), false);
$function$;

-- Latest ledger state only. Revocation must use this helper so removing a
-- global role before revoking cannot leave a dormant ACCESS_GRANTED event that
-- silently reactivates if the role is later restored.
CREATE OR REPLACE FUNCTION private.owner_daily_digest_access_state_granted_v2(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, private, pg_temp
AS $function$
  SELECT COALESCE((
    SELECT e.event_type = 'ACCESS_GRANTED'
    FROM private.owner_daily_digest_manager_events_v2 e
    WHERE e.club_id = p_club_id
      AND e.user_id = p_user_id
      AND e.event_type IN ('ACCESS_GRANTED', 'ACCESS_REVOKED')
    ORDER BY e.event_sequence DESC
    LIMIT 1
  ), false);
$function$;

CREATE OR REPLACE FUNCTION private.owner_daily_digest_access_granted_v2(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
  SELECT private.owner_daily_digest_access_state_granted_v2(p_club_id, p_user_id)
  AND private.owner_daily_digest_candidate_active_v2(p_club_id, p_user_id)
  AND public.has_role(p_user_id, 'club_admin'::public.app_role);
$function$;

CREATE OR REPLACE FUNCTION private.owner_daily_digest_manager_active_v2(
  p_club_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
  SELECT private.owner_daily_digest_access_granted_v2(p_club_id, p_user_id)
  AND COALESCE((
    SELECT s.manager_access_enabled
    FROM private.owner_daily_digest_settings_v2 s
    WHERE s.club_id = p_club_id
  ), false);
$function$;

CREATE OR REPLACE FUNCTION private.can_manage_owner_daily_digest_access_v2(
  p_user_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
  SELECT p_user_id IS NOT NULL AND (
    public.has_role(p_user_id, 'super_admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.id = p_club_id AND c.owner_id = p_user_id
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.can_read_owner_daily_digest_v2(
  p_user_id uuid,
  p_club_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
  SELECT private.can_manage_owner_daily_digest_access_v2(p_user_id, p_club_id)
    OR private.owner_daily_digest_manager_active_v2(p_club_id, p_user_id);
$function$;

REVOKE ALL ON FUNCTION private.owner_daily_digest_candidate_active_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.owner_daily_digest_access_state_granted_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.owner_daily_digest_access_granted_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.owner_daily_digest_manager_active_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_manage_owner_daily_digest_access_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.can_read_owner_daily_digest_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.owner_daily_digest_snapshot_artifact_v2(
  p_snapshot_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'artifact_id', s.snapshot_id,
    'club_id', s.club_id,
    'artifact_type', 'OWNER_DAILY_DIGEST',
    'schema_version', 2,
    'snapshot_version', s.snapshot_version,
    'calculation_version', s.calculation_version,
    'privacy_class', 'NO_PII',
    'sensitivity', 'CLUB_CONFIDENTIAL',
    'source_data_hash', s.source_hash,
    'generation_mode', 'DETERMINISTIC',
    'input_hash', s.source_hash,
    'output_hash', s.content_hash,
    'source_as_of', s.source_as_of,
    'generated_at', s.generated_at,
    'approval_status', 'NOT_REQUIRED',
    'content_payload', jsonb_build_object(
      'business_date', s.business_date,
      'calculation_version', s.calculation_version,
      'effective_timezone', s.effective_timezone,
      'window_start_utc', s.window_start_utc,
      'window_end_utc', s.window_end_utc,
      'freshness_state', s.freshness_state,
      'money_state', s.money_state,
      'metrics', jsonb_build_object(
        'registered_players', jsonb_build_object('value', s.registered_players, 'state', s.registered_players_state),
        'attendance_players', jsonb_build_object('value', s.attendance_players, 'state', s.attendance_players_state),
        'entries_count', jsonb_build_object('value', s.entries_count, 'state', s.entries_count_state),
        'staff_count', jsonb_build_object('value', s.staff_count, 'state', s.staff_count_state),
        'rake_paid_vnd', jsonb_build_object('value', s.rake_paid_vnd, 'state', s.rake_paid_state),
        'service_fee_paid_vnd', jsonb_build_object('value', s.service_fee_paid_vnd, 'state', s.service_fee_paid_state),
        'fnb_net_revenue_vnd', jsonb_build_object('value', s.fnb_net_revenue_vnd, 'state', s.fnb_net_revenue_state),
        'payout_outstanding_vnd', jsonb_build_object('value', s.payout_outstanding_vnd, 'state', s.payout_outstanding_state),
        'dealer_payroll_outstanding_vnd', jsonb_build_object('value', s.dealer_payroll_outstanding_vnd, 'state', s.dealer_payroll_outstanding_state)
      ),
      'warning_codes', to_jsonb(s.warning_codes),
      'action_codes', to_jsonb(s.action_codes)
    ),
    'content_sha256', s.content_hash,
    'expires_at', s.notification_expires_at
  )
  FROM private.owner_daily_digest_snapshots_v2 s
  WHERE s.snapshot_id = p_snapshot_id;
$function$;

REVOKE ALL ON FUNCTION private.owner_daily_digest_snapshot_artifact_v2(uuid)
  FROM PUBLIC, anon, authenticated;

-- Keep the still-live V1 scope boundary and the V2 append-only ledger aligned
-- throughout the cutover window. V1 writes remain callable until a later,
-- separately approved retirement migration revokes them. The trigger mirrors
-- those writes into V2; V2 grant/revoke functions mirror back to V1 below.
CREATE OR REPLACE FUNCTION private.sync_owner_daily_digest_v1_scope_to_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_club_id uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.club_id ELSE OLD.club_id END;
  v_user_id uuid := CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END;
  v_actor uuid := COALESCE(
    (SELECT auth.uid()),
    CASE WHEN TG_OP = 'INSERT' THEN NEW.granted_by ELSE OLD.granted_by END
  );
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_club_id::text || ':' || v_user_id::text, 0));

  IF TG_OP = 'INSERT' THEN
    IF NOT private.owner_daily_digest_candidate_active_v2(v_club_id, v_user_id) THEN
      INSERT INTO private.owner_daily_digest_manager_events_v2 (
        club_id, user_id, event_type, actor_user_id, reason_code
      ) VALUES (v_club_id, v_user_id, 'CANDIDATE_PREPARED', v_actor, 'V1_SCOPE_SYNC');
    END IF;
    IF NOT private.owner_daily_digest_access_state_granted_v2(v_club_id, v_user_id) THEN
      INSERT INTO private.owner_daily_digest_manager_events_v2 (
        club_id, user_id, event_type, actor_user_id, reason_code
      ) VALUES (v_club_id, v_user_id, 'ACCESS_GRANTED', v_actor, 'V1_SCOPE_SYNC');
    END IF;
    RETURN NEW;
  END IF;

  IF private.owner_daily_digest_access_state_granted_v2(v_club_id, v_user_id) THEN
    INSERT INTO private.owner_daily_digest_manager_events_v2 (
      club_id, user_id, event_type, actor_user_id, reason_code
    ) VALUES (v_club_id, v_user_id, 'ACCESS_REVOKED', v_actor, 'V1_SCOPE_SYNC');
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION private.sync_owner_daily_digest_v1_scope_to_v2()
  FROM PUBLIC, anon, authenticated;

DO $cutover_sync$
BEGIN
  IF to_regclass('public.owner_daily_digest_club_admin_scopes') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS owner_daily_digest_v1_scope_sync_v2 ON public.owner_daily_digest_club_admin_scopes';
    EXECUTE 'CREATE TRIGGER owner_daily_digest_v1_scope_sync_v2
      AFTER INSERT OR DELETE ON public.owner_daily_digest_club_admin_scopes
      FOR EACH ROW EXECUTE FUNCTION private.sync_owner_daily_digest_v1_scope_to_v2()';
  END IF;
END;
$cutover_sync$;
GRANT EXECUTE ON FUNCTION private.owner_daily_digest_snapshot_artifact_v2(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.list_owner_daily_digest_clubs_v2()
RETURNS TABLE (
  club_id uuid,
  club_name text,
  access_level text,
  can_manage_access boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
  SELECT
    c.id,
    c.name,
    CASE
      WHEN public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role) THEN 'SUPER_ADMIN'
      WHEN c.owner_id = (SELECT auth.uid()) THEN 'OWNER'
      ELSE 'MANAGER'
    END,
    private.can_manage_owner_daily_digest_access_v2((SELECT auth.uid()), c.id)
  FROM public.clubs c
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND private.can_read_owner_daily_digest_v2((SELECT auth.uid()), c.id)
  ORDER BY c.name, c.id;
$function$;

CREATE OR REPLACE FUNCTION public.get_owner_daily_digest_snapshot_v2(
  p_club_id uuid,
  p_business_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_snapshot_id uuid;
  v_snapshot_date date;
  v_latest_available_date date;
  v_run record;
BEGIN
  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_user_id IS NULL OR NOT private.can_read_owner_daily_digest_v2(v_user_id, p_club_id) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT s.snapshot_id, s.business_date
  INTO v_snapshot_id, v_snapshot_date
  FROM private.owner_daily_digest_snapshots_v2 s
  WHERE s.club_id = p_club_id
    AND (p_business_date IS NULL OR s.business_date = p_business_date)
  ORDER BY s.business_date DESC, s.snapshot_version DESC
  LIMIT 1;

  SELECT max(s.business_date)
  INTO v_latest_available_date
  FROM private.owner_daily_digest_snapshots_v2 s
  WHERE s.club_id = p_club_id;

  SELECT r.status, r.result_code, r.sanitized_error_code, r.started_at, r.completed_at
  INTO v_run
  FROM private.owner_daily_digest_generation_runs_v2 r
  WHERE r.club_id = p_club_id
    AND r.business_date = COALESCE(p_business_date, v_snapshot_date, v_latest_available_date)
  ORDER BY r.started_at DESC, r.run_id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'requested_business_date', p_business_date,
    'latest_available_business_date', v_latest_available_date,
    'snapshot', CASE
      WHEN v_snapshot_id IS NULL THEN NULL
      ELSE private.owner_daily_digest_snapshot_artifact_v2(v_snapshot_id)
    END,
    'last_generation', CASE
      WHEN v_run.status IS NULL THEN NULL
      ELSE jsonb_build_object(
        'status', v_run.status,
        'result_code', v_run.result_code,
        'error_code', v_run.sanitized_error_code,
        'started_at', v_run.started_at,
        'completed_at', v_run.completed_at
      )
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_owner_daily_digest_managers_v2(
  p_club_id uuid
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  short_identifier text,
  granted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF NOT private.can_manage_owner_daily_digest_access_v2(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH active AS (
    SELECT DISTINCT ON (e.user_id)
      e.user_id, e.event_type, e.created_at
    FROM private.owner_daily_digest_manager_events_v2 e
    WHERE e.club_id = p_club_id
      AND e.event_type IN ('ACCESS_GRANTED', 'ACCESS_REVOKED')
    ORDER BY e.user_id, e.event_sequence DESC
  )
  SELECT a.user_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), 'Quản lý CLB'),
         right(replace(a.user_id::text, '-', ''), 8),
         a.created_at
  FROM active a
  LEFT JOIN public.profiles p ON p.user_id = a.user_id
  WHERE a.event_type = 'ACCESS_GRANTED'
    AND private.owner_daily_digest_access_granted_v2(p_club_id, a.user_id)
  ORDER BY COALESCE(NULLIF(btrim(p.display_name), ''), 'Quản lý CLB'), a.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_assignable_owner_daily_digest_managers_v2(
  p_club_id uuid
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  short_identifier text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF NOT private.can_manage_owner_daily_digest_access_v2(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ur.user_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), 'Quản lý CLB'),
         right(replace(ur.user_id::text, '-', ''), 8)
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.user_id = ur.user_id
  WHERE ur.role = 'club_admin'::public.app_role
    AND private.owner_daily_digest_candidate_active_v2(p_club_id, ur.user_id)
    AND NOT private.owner_daily_digest_access_granted_v2(p_club_id, ur.user_id)
  ORDER BY COALESCE(NULLIF(btrim(p.display_name), ''), 'Quản lý CLB'), ur.user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_owner_daily_digest_manager_candidate_v2(
  p_club_id uuid,
  p_user_id uuid,
  p_reason_code text DEFAULT 'SUPER_ADMIN_UI'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_event_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_club_id IS NULL OR p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.clubs c WHERE c.id = p_club_id
  ) THEN
    RAISE EXCEPTION 'invalid candidate input' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_role(p_user_id, 'club_admin'::public.app_role) THEN
    RAISE EXCEPTION 'target user must already have club_admin role' USING ERRCODE = '23514';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code !~ '^[A-Z0-9_]{3,64}$' THEN
    RAISE EXCEPTION 'invalid reason code' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || p_user_id::text, 0));
  IF private.owner_daily_digest_candidate_active_v2(p_club_id, p_user_id) THEN
    SELECT e.event_id INTO v_event_id
    FROM private.owner_daily_digest_manager_events_v2 e
    WHERE e.club_id = p_club_id AND e.user_id = p_user_id
      AND e.event_type = 'CANDIDATE_PREPARED'
    ORDER BY e.event_sequence DESC LIMIT 1;
    RETURN v_event_id;
  END IF;

  INSERT INTO private.owner_daily_digest_manager_events_v2 (
    club_id, user_id, event_type, actor_user_id, reason_code
  ) VALUES (p_club_id, p_user_id, 'CANDIDATE_PREPARED', v_actor, p_reason_code)
  RETURNING event_id INTO v_event_id;
  RETURN v_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.grant_owner_daily_digest_manager_v2(
  p_club_id uuid,
  p_user_id uuid,
  p_reason_code text DEFAULT 'OWNER_UI'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_event_id uuid;
BEGIN
  IF NOT private.can_manage_owner_daily_digest_access_v2(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NOT public.has_role(p_user_id, 'club_admin'::public.app_role)
     OR NOT private.owner_daily_digest_candidate_active_v2(p_club_id, p_user_id) THEN
    RAISE EXCEPTION 'target is not an assignable Club Admin' USING ERRCODE = '23514';
  END IF;
  IF p_reason_code IS NULL OR p_reason_code !~ '^[A-Z0-9_]{3,64}$' THEN
    RAISE EXCEPTION 'invalid reason code' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || p_user_id::text, 0));
  IF private.owner_daily_digest_access_granted_v2(p_club_id, p_user_id) THEN
    IF to_regclass('public.owner_daily_digest_club_admin_scopes') IS NOT NULL THEN
      EXECUTE 'INSERT INTO public.owner_daily_digest_club_admin_scopes (club_id, user_id, granted_by)
        VALUES ($1, $2, $3) ON CONFLICT (club_id, user_id) DO NOTHING'
      USING p_club_id, p_user_id, v_actor;
    END IF;
    SELECT e.event_id INTO v_event_id
    FROM private.owner_daily_digest_manager_events_v2 e
    WHERE e.club_id = p_club_id AND e.user_id = p_user_id
      AND e.event_type = 'ACCESS_GRANTED'
    ORDER BY e.event_sequence DESC LIMIT 1;
    RETURN v_event_id;
  END IF;

  INSERT INTO private.owner_daily_digest_manager_events_v2 (
    club_id, user_id, event_type, actor_user_id, reason_code
  ) VALUES (p_club_id, p_user_id, 'ACCESS_GRANTED', v_actor, p_reason_code)
  RETURNING event_id INTO v_event_id;
  IF to_regclass('public.owner_daily_digest_club_admin_scopes') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.owner_daily_digest_club_admin_scopes (club_id, user_id, granted_by)
      VALUES ($1, $2, $3) ON CONFLICT (club_id, user_id) DO NOTHING'
    USING p_club_id, p_user_id, v_actor;
  END IF;
  RETURN v_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_owner_daily_digest_manager_v2(
  p_club_id uuid,
  p_user_id uuid,
  p_reason_code text DEFAULT 'OWNER_UI'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_event_id uuid;
BEGIN
  IF NOT private.can_manage_owner_daily_digest_access_v2(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_reason_code IS NULL OR p_reason_code !~ '^[A-Z0-9_]{3,64}$' THEN
    RAISE EXCEPTION 'invalid revoke input' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || p_user_id::text, 0));
  IF NOT private.owner_daily_digest_access_state_granted_v2(p_club_id, p_user_id) THEN
    IF to_regclass('public.owner_daily_digest_club_admin_scopes') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.owner_daily_digest_club_admin_scopes
        WHERE club_id = $1 AND user_id = $2'
      USING p_club_id, p_user_id;
    END IF;
    SELECT e.event_id INTO v_event_id
    FROM private.owner_daily_digest_manager_events_v2 e
    WHERE e.club_id = p_club_id AND e.user_id = p_user_id
      AND e.event_type = 'ACCESS_REVOKED'
    ORDER BY e.event_sequence DESC LIMIT 1;
    RETURN v_event_id;
  END IF;

  INSERT INTO private.owner_daily_digest_manager_events_v2 (
    club_id, user_id, event_type, actor_user_id, reason_code
  ) VALUES (p_club_id, p_user_id, 'ACCESS_REVOKED', v_actor, p_reason_code)
  RETURNING event_id INTO v_event_id;
  IF to_regclass('public.owner_daily_digest_club_admin_scopes') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.owner_daily_digest_club_admin_scopes
      WHERE club_id = $1 AND user_id = $2'
    USING p_club_id, p_user_id;
  END IF;
  RETURN v_event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_owner_daily_digest_regeneration_v2(
  p_club_id uuid,
  p_business_date date,
  p_client_request_id uuid,
  p_reason text DEFAULT 'OWNER_UI_REGENERATION'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_timezone text;
  v_cutoff time;
  v_window_end timestamptz;
  v_request private.owner_daily_digest_generation_requests_v2%ROWTYPE;
BEGIN
  IF NOT private.can_manage_owner_daily_digest_access_v2(v_actor, p_club_id) THEN
    RAISE EXCEPTION 'not found or forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_business_date IS NULL OR p_client_request_id IS NULL
     OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 3 AND 240 THEN
    RAISE EXCEPTION 'invalid generation request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_club_id::text || ':request:' || p_client_request_id::text, 0
  ));

  SELECT cs.timezone, s.day_cutoff_local
  INTO v_timezone, v_cutoff
  FROM private.owner_daily_digest_settings_v2 s
  JOIN public.club_settings cs ON cs.club_id = s.club_id
  WHERE s.club_id = p_club_id
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = cs.timezone);

  IF v_timezone IS NULL THEN
    RAISE EXCEPTION 'digest timezone is not configured' USING ERRCODE = '55000';
  END IF;
  v_window_end := ((p_business_date + 1)::date + v_cutoff) AT TIME ZONE v_timezone;
  IF v_window_end > clock_timestamp() THEN
    RAISE EXCEPTION 'business day has not ended' USING ERRCODE = '22023';
  END IF;
  IF p_business_date < ((clock_timestamp() AT TIME ZONE v_timezone)::date - 90) THEN
    RAISE EXCEPTION 'business date exceeds regeneration lookback' USING ERRCODE = '22023';
  END IF;

  SELECT r.* INTO v_request
  FROM private.owner_daily_digest_generation_requests_v2 r
  WHERE r.club_id = p_club_id AND r.client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'request_id', v_request.request_id,
      'status', v_request.status,
      'business_date', v_request.business_date,
      'created_at', v_request.created_at
    );
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_club_id::text || ':business-date:' || p_business_date::text, 0
  ));

  IF EXISTS (
    SELECT 1 FROM private.owner_daily_digest_generation_requests_v2 r
    WHERE r.club_id = p_club_id AND r.business_date = p_business_date
      AND r.status IN ('PENDING', 'PROCESSING')
  ) THEN
    SELECT r.* INTO v_request
    FROM private.owner_daily_digest_generation_requests_v2 r
    WHERE r.club_id = p_club_id AND r.business_date = p_business_date
      AND r.status IN ('PENDING', 'PROCESSING')
    ORDER BY r.created_at DESC, r.request_id DESC LIMIT 1;
    RETURN jsonb_build_object(
      'request_id', v_request.request_id,
      'status', v_request.status,
      'business_date', v_request.business_date,
      'created_at', v_request.created_at
    );
  END IF;

  IF (SELECT count(*) FROM private.owner_daily_digest_generation_requests_v2 r
      WHERE r.club_id = p_club_id AND r.requested_by = v_actor
        AND r.created_at > clock_timestamp() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'generation request rate limit exceeded' USING ERRCODE = '54000';
  END IF;

  INSERT INTO private.owner_daily_digest_generation_requests_v2 (
    club_id, business_date, requested_by, client_request_id, reason
  ) VALUES (
    p_club_id, p_business_date, v_actor, p_client_request_id, btrim(p_reason)
  )
  RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'request_id', v_request.request_id,
    'status', v_request.status,
    'business_date', v_request.business_date,
    'created_at', v_request.created_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_owner_daily_digest_clubs_v2()
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_owner_daily_digest_snapshot_v2(uuid,date)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_owner_daily_digest_managers_v2(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_assignable_owner_daily_digest_managers_v2(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepare_owner_daily_digest_manager_candidate_v2(uuid,uuid,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.grant_owner_daily_digest_manager_v2(uuid,uuid,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_owner_daily_digest_manager_v2(uuid,uuid,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_owner_daily_digest_regeneration_v2(uuid,date,uuid,text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_owner_daily_digest_clubs_v2()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_daily_digest_snapshot_v2(uuid,date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_owner_daily_digest_managers_v2(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_assignable_owner_daily_digest_managers_v2(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_owner_daily_digest_manager_candidate_v2(uuid,uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_owner_daily_digest_manager_v2(uuid,uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_owner_daily_digest_manager_v2(uuid,uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_owner_daily_digest_regeneration_v2(uuid,date,uuid,text)
  TO authenticated;

COMMENT ON FUNCTION public.get_owner_daily_digest_snapshot_v2(uuid,date) IS
  'Read-only V2 Digest envelope. Explicit dates never fall back to another day.';
COMMENT ON FUNCTION public.request_owner_daily_digest_regeneration_v2(uuid,date,uuid,text) IS
  'Queues a server-side regeneration request. Does not calculate or mutate canonical money state.';
