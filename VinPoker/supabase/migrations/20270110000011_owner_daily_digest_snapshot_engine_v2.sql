-- Owner Daily Digest V2 — canonical immutable snapshot engine.
--
-- CRITICAL / SOURCE-ONLY. This migration is NOT applied by this change.
-- Production apply, Cron activation and any capability rollout remain owner-gated.
-- All per-club settings default OFF.
--
-- Canonical invariants:
--   * one server-side generator computes every Digest metric;
--   * web and automation consume the same immutable snapshot;
--   * [06:00, next-day 06:00) local business window;
--   * no guessed rake/service split for historical registrations;
--   * source query failure creates a FAILED run and no zero-filled snapshot;
--   * identical source hash reuses the existing snapshot and emits no duplicate outbox event.
--
-- ROLLBACK (controlled runbook only; retain audit/data tables unless the owner explicitly approves loss):
--   SELECT cron.unschedule('owner-daily-digest-v2-due-runner');
--   UPDATE private.owner_daily_digest_settings_v2 SET enabled = false;
--   DROP FUNCTION IF EXISTS private.run_owner_daily_digest_due_v2();
--   DROP FUNCTION IF EXISTS private.process_owner_daily_digest_requests_v2(integer);
--   DROP FUNCTION IF EXISTS private.generate_owner_daily_digest_snapshot_v2(uuid,date,text,uuid,uuid,text);
--   DROP FUNCTION IF EXISTS private.owner_daily_digest_content_hash_v2(jsonb);
--   DROP TRIGGER IF EXISTS trg_owner_digest_registration_split_v2 ON public.tournament_registrations;
--   DROP FUNCTION IF EXISTS private.capture_registration_fee_split_v2();
-- Snapshot, run, request and outbox rows are intentionally retained for audit.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------------------------
-- 1. Persist the paid rake/service split at registration creation time.
-- --------------------------------------------------------------------------------------------

ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS rake_paid_vnd bigint,
  ADD COLUMN IF NOT EXISTS service_fee_paid_vnd bigint;

COMMENT ON COLUMN public.tournament_registrations.rake_paid_vnd IS
  'Server-captured pure rake at registration INSERT. NULL means legacy/unknown; never infer later.';
COMMENT ON COLUMN public.tournament_registrations.service_fee_paid_vnd IS
  'Server-captured service fee at registration INSERT. NULL means legacy/unknown; never infer later.';

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.tournament_registrations'::regclass
      AND conname = 'tournament_registrations_fee_split_pair_v2'
  ) THEN
    ALTER TABLE public.tournament_registrations
      ADD CONSTRAINT tournament_registrations_fee_split_pair_v2
      CHECK (
        (rake_paid_vnd IS NULL AND service_fee_paid_vnd IS NULL)
        OR (
          rake_paid_vnd IS NOT NULL
          AND service_fee_paid_vnd IS NOT NULL
          AND rake_paid_vnd >= 0
          AND service_fee_paid_vnd >= 0
          AND total_pay = buy_in + rake_paid_vnd + service_fee_paid_vnd
        )
      ) NOT VALID;
  END IF;
END;
$constraints$;

CREATE OR REPLACE FUNCTION private.capture_registration_fee_split_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $function$
DECLARE
  v_rake bigint;
  v_service bigint;
  v_free_rake_enabled boolean;
  v_free_rake_used integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Historical rows stay unknown; persisted money inputs/splits are immutable for V2 rows.
    IF OLD.rake_paid_vnd IS NOT NULL AND (
      NEW.rake_paid_vnd IS DISTINCT FROM OLD.rake_paid_vnd
      OR NEW.service_fee_paid_vnd IS DISTINCT FROM OLD.service_fee_paid_vnd
      OR NEW.buy_in IS DISTINCT FROM OLD.buy_in
      OR NEW.total_pay IS DISTINCT FROM OLD.total_pay
      OR NEW.tournament_id IS DISTINCT FROM OLD.tournament_id
      OR NEW.used_free_rake IS DISTINCT FROM OLD.used_free_rake
    ) THEN
      RAISE EXCEPTION 'REGISTRATION_FEE_SPLIT_IMMUTABLE'
        USING ERRCODE = '55000';
    END IF;
    NEW.rake_paid_vnd := OLD.rake_paid_vnd;
    NEW.service_fee_paid_vnd := OLD.service_fee_paid_vnd;
    RETURN NEW;
  END IF;

  -- `used_free_rake` is not client authority. The canonical Edge registration path
  -- consumes a slot with the service role before inserting the registration.
  IF COALESCE(NEW.used_free_rake, false)
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'FREE_RAKE_SERVER_AUTHORITY_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    t.rake_amount::bigint,
    t.service_fee_amount::bigint,
    COALESCE(t.free_rake_enabled, false),
    COALESCE(t.free_rake_used, 0)
  INTO v_rake, v_service, v_free_rake_enabled, v_free_rake_used
  FROM public.tournaments t
  WHERE t.id = NEW.tournament_id
    AND t.rake_amount::numeric = trunc(t.rake_amount::numeric)
    AND t.service_fee_amount::numeric = trunc(t.service_fee_amount::numeric)
  FOR SHARE;

  IF NOT FOUND OR v_rake IS NULL OR v_service IS NULL OR v_rake < 0 OR v_service < 0 THEN
    RAISE EXCEPTION 'REGISTRATION_FEE_SPLIT_UNAVAILABLE'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(NEW.used_free_rake, false) THEN
    IF NOT v_free_rake_enabled OR v_free_rake_used < 1 THEN
      RAISE EXCEPTION 'FREE_RAKE_SLOT_NOT_CONSUMED'
        USING ERRCODE = '23514';
    END IF;
    v_rake := 0;
  END IF;

  -- Ignore any client-provided split. The database captures canonical values.
  NEW.rake_paid_vnd := v_rake;
  NEW.service_fee_paid_vnd := v_service;

  IF NEW.total_pay <> NEW.buy_in + v_rake + v_service THEN
    RAISE EXCEPTION 'REGISTRATION_TOTAL_SPLIT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.capture_registration_fee_split_v2()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_owner_digest_registration_split_v2
  ON public.tournament_registrations;
CREATE TRIGGER trg_owner_digest_registration_split_v2
  BEFORE INSERT OR UPDATE OF
    rake_paid_vnd, service_fee_paid_vnd, buy_in, total_pay, tournament_id, used_free_rake
  ON public.tournament_registrations
  FOR EACH ROW
  EXECUTE FUNCTION private.capture_registration_fee_split_v2();

-- Cross-runtime semantic hash. Automation mirrors this exact field order and epoch-second rule;
-- JSON whitespace/key ordering can therefore never create a false checksum mismatch.
CREATE OR REPLACE FUNCTION private.owner_daily_digest_content_hash_v2(p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, extensions, pg_temp
AS $function$
  SELECT encode(
    extensions.digest(
      convert_to(
        concat_ws('|',
          'OWNER_DAILY_DIGEST_V2',
          p_payload->>'business_date',
          p_payload->>'calculation_version',
          p_payload->>'effective_timezone',
          trunc(extract(epoch FROM ((p_payload->>'window_start_utc')::timestamptz)))::bigint::text,
          trunc(extract(epoch FROM ((p_payload->>'window_end_utc')::timestamptz)))::bigint::text,
          p_payload->>'freshness_state',
          p_payload->>'money_state',
          COALESCE(p_payload#>>'{metrics,registered_players,value}', 'null'),
          p_payload#>>'{metrics,registered_players,state}',
          COALESCE(p_payload#>>'{metrics,attendance_players,value}', 'null'),
          p_payload#>>'{metrics,attendance_players,state}',
          COALESCE(p_payload#>>'{metrics,entries_count,value}', 'null'),
          p_payload#>>'{metrics,entries_count,state}',
          COALESCE(p_payload#>>'{metrics,staff_count,value}', 'null'),
          p_payload#>>'{metrics,staff_count,state}',
          COALESCE(p_payload#>>'{metrics,rake_paid_vnd,value}', 'null'),
          p_payload#>>'{metrics,rake_paid_vnd,state}',
          COALESCE(p_payload#>>'{metrics,service_fee_paid_vnd,value}', 'null'),
          p_payload#>>'{metrics,service_fee_paid_vnd,state}',
          COALESCE(p_payload#>>'{metrics,fnb_net_revenue_vnd,value}', 'null'),
          p_payload#>>'{metrics,fnb_net_revenue_vnd,state}',
          COALESCE(p_payload#>>'{metrics,payout_outstanding_vnd,value}', 'null'),
          p_payload#>>'{metrics,payout_outstanding_vnd,state}',
          COALESCE(p_payload#>>'{metrics,dealer_payroll_outstanding_vnd,value}', 'null'),
          p_payload#>>'{metrics,dealer_payroll_outstanding_vnd,state}',
          COALESCE((
            SELECT string_agg(value, ',' ORDER BY ordinality)
            FROM jsonb_array_elements_text(p_payload->'warning_codes') WITH ORDINALITY AS w(value, ordinality)
          ), ''),
          COALESCE((
            SELECT string_agg(value, ',' ORDER BY ordinality)
            FROM jsonb_array_elements_text(p_payload->'action_codes') WITH ORDINALITY AS a(value, ordinality)
          ), '')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

REVOKE ALL ON FUNCTION private.owner_daily_digest_content_hash_v2(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.owner_daily_digest_content_hash_v2(jsonb)
  TO service_role;

-- --------------------------------------------------------------------------------------------
-- 2. Private settings, immutable snapshots, generation ledger and outbox.
-- --------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.owner_daily_digest_settings_v2 (
  club_id uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  manager_access_enabled boolean NOT NULL DEFAULT false,
  day_cutoff_local time NOT NULL DEFAULT time '06:00',
  generation_time_local time NOT NULL DEFAULT time '07:00',
  calculation_version text NOT NULL DEFAULT 'owner-daily-digest-v2.0.0',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (generation_time_local > day_cutoff_local)
);

CREATE TABLE IF NOT EXISTS private.owner_daily_digest_generation_runs_v2 (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('SCHEDULE', 'MANUAL')),
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_id uuid,
  reason text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  snapshot_id uuid,
  result_code text,
  sanitized_error_code text,
  CHECK (reason IS NULL OR char_length(reason) <= 240),
  CHECK (sanitized_error_code IS NULL OR sanitized_error_code ~ '^[A-Z0-9_]{2,96}$')
);

CREATE INDEX IF NOT EXISTS owner_digest_generation_runs_latest_v2_idx
  ON private.owner_daily_digest_generation_runs_v2
  (club_id, business_date, started_at DESC);

CREATE TABLE IF NOT EXISTS private.owner_daily_digest_snapshots_v2 (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  snapshot_version integer NOT NULL CHECK (snapshot_version > 0),
  calculation_version text NOT NULL,
  effective_timezone text NOT NULL,
  window_start_utc timestamptz NOT NULL,
  window_end_utc timestamptz NOT NULL,
  source_as_of timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  notification_expires_at timestamptz NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('SCHEDULE', 'MANUAL')),
  generated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  supersedes_snapshot_id uuid REFERENCES private.owner_daily_digest_snapshots_v2(snapshot_id)
    ON DELETE RESTRICT,
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  freshness_state text NOT NULL CHECK (freshness_state IN ('FRESH', 'PARTIAL')),
  money_state text NOT NULL DEFAULT 'PROVISIONAL' CHECK (money_state = 'PROVISIONAL'),

  registered_players integer NOT NULL CHECK (registered_players >= 0),
  registered_players_state text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (registered_players_state = 'AVAILABLE'),
  attendance_players integer NOT NULL CHECK (attendance_players >= 0),
  attendance_players_state text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (attendance_players_state = 'AVAILABLE'),
  entries_count integer NOT NULL CHECK (entries_count >= 0),
  entries_count_state text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (entries_count_state = 'AVAILABLE'),
  staff_count integer NOT NULL CHECK (staff_count >= 0),
  staff_count_state text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (staff_count_state = 'AVAILABLE'),

  rake_paid_vnd bigint,
  rake_paid_state text NOT NULL CHECK (rake_paid_state IN ('AVAILABLE', 'UNAVAILABLE')),
  service_fee_paid_vnd bigint,
  service_fee_paid_state text NOT NULL CHECK (service_fee_paid_state IN ('AVAILABLE', 'UNAVAILABLE')),
  fnb_net_revenue_vnd bigint,
  fnb_net_revenue_state text NOT NULL CHECK (fnb_net_revenue_state IN ('AVAILABLE', 'UNAVAILABLE')),
  payout_outstanding_vnd bigint NOT NULL CHECK (payout_outstanding_vnd >= 0),
  payout_outstanding_state text NOT NULL DEFAULT 'AVAILABLE'
    CHECK (payout_outstanding_state = 'AVAILABLE'),
  dealer_payroll_outstanding_vnd bigint,
  dealer_payroll_outstanding_state text NOT NULL
    CHECK (dealer_payroll_outstanding_state IN ('AVAILABLE', 'UNAVAILABLE')),

  warning_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  action_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end_utc > window_start_utc),
  CHECK (notification_expires_at > generated_at),
  CHECK (cardinality(warning_codes) <= 32),
  CHECK (cardinality(action_codes) <= 32),
  CHECK ((rake_paid_state = 'AVAILABLE') = (rake_paid_vnd IS NOT NULL)),
  CHECK ((service_fee_paid_state = 'AVAILABLE') = (service_fee_paid_vnd IS NOT NULL)),
  CHECK ((fnb_net_revenue_state = 'AVAILABLE') = (fnb_net_revenue_vnd IS NOT NULL)),
  CHECK ((dealer_payroll_outstanding_state = 'AVAILABLE') = (dealer_payroll_outstanding_vnd IS NOT NULL)),
  CHECK (rake_paid_vnd IS NULL OR rake_paid_vnd >= 0),
  CHECK (service_fee_paid_vnd IS NULL OR service_fee_paid_vnd >= 0),
  CHECK (dealer_payroll_outstanding_vnd IS NULL OR dealer_payroll_outstanding_vnd >= 0),
  UNIQUE (club_id, business_date, calculation_version, source_hash),
  UNIQUE (club_id, business_date, calculation_version, snapshot_version)
);

ALTER TABLE private.owner_daily_digest_generation_runs_v2
  DROP CONSTRAINT IF EXISTS owner_daily_digest_generation_runs_v2_snapshot_id_fkey;
ALTER TABLE private.owner_daily_digest_generation_runs_v2
  ADD CONSTRAINT owner_daily_digest_generation_runs_v2_snapshot_id_fkey
  FOREIGN KEY (snapshot_id)
  REFERENCES private.owner_daily_digest_snapshots_v2(snapshot_id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS owner_digest_snapshots_latest_v2_idx
  ON private.owner_daily_digest_snapshots_v2
  (club_id, business_date DESC, snapshot_version DESC);

CREATE TABLE IF NOT EXISTS private.owner_daily_digest_generation_requests_v2 (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REJECTED')),
  snapshot_id uuid REFERENCES private.owner_daily_digest_snapshots_v2(snapshot_id)
    ON DELETE RESTRICT,
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  CHECK (char_length(btrim(reason)) BETWEEN 3 AND 240),
  UNIQUE (club_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS owner_digest_generation_requests_pending_v2_idx
  ON private.owner_daily_digest_generation_requests_v2 (created_at)
  WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS private.owner_daily_digest_outbox_v2 (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type = 'owner.daily_digest.snapshot_created'),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL UNIQUE REFERENCES private.owner_daily_digest_snapshots_v2(snapshot_id)
    ON DELETE RESTRICT,
  dedupe_key text NOT NULL UNIQUE,
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version = 2),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > available_at),
  CHECK (pg_catalog.octet_length(payload::text) <= 32768)
);

REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA private TO service_role;

-- Snapshot rows and outbox events are append-only, including for service_role.
CREATE OR REPLACE FUNCTION private.reject_owner_digest_immutable_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, private, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'OWNER_DIGEST_IMMUTABLE_ROW'
    USING ERRCODE = '55000';
END;
$function$;

DROP TRIGGER IF EXISTS trg_owner_digest_snapshot_immutable_v2
  ON private.owner_daily_digest_snapshots_v2;
CREATE TRIGGER trg_owner_digest_snapshot_immutable_v2
  BEFORE UPDATE OR DELETE ON private.owner_daily_digest_snapshots_v2
  FOR EACH ROW EXECUTE FUNCTION private.reject_owner_digest_immutable_mutation_v2();

DROP TRIGGER IF EXISTS trg_owner_digest_outbox_immutable_v2
  ON private.owner_daily_digest_outbox_v2;
CREATE TRIGGER trg_owner_digest_outbox_immutable_v2
  BEFORE UPDATE OR DELETE ON private.owner_daily_digest_outbox_v2
  FOR EACH ROW EXECUTE FUNCTION private.reject_owner_digest_immutable_mutation_v2();

REVOKE ALL ON FUNCTION private.reject_owner_digest_immutable_mutation_v2()
  FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------------------------
-- 3. The single canonical generator.
-- --------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.generate_owner_daily_digest_snapshot_v2(
  p_club_id uuid,
  p_business_date date,
  p_trigger_type text,
  p_requested_by uuid DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $function$
DECLARE
  v_run_id uuid;
  v_snapshot_id uuid;
  v_existing_snapshot_id uuid;
  v_supersedes_snapshot_id uuid;
  v_timezone text;
  v_cutoff time;
  v_calculation_version text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_source_as_of timestamptz;
  v_revision integer;
  v_source_payload jsonb;
  v_source_hash text;
  v_freshness_state text;
  v_registered integer;
  v_attendance integer;
  v_entries integer;
  v_staff integer;
  v_rake bigint;
  v_rake_state text;
  v_service bigint;
  v_service_state text;
  v_fnb bigint;
  v_fnb_state text;
  v_payout bigint;
  v_payout_invalid_amounts integer;
  v_payroll bigint;
  v_payroll_state text;
  v_warning_codes text[];
  v_action_codes text[];
  v_sqlstate text;
BEGIN
  IF p_club_id IS NULL OR p_business_date IS NULL
     OR p_trigger_type NOT IN ('SCHEDULE', 'MANUAL') THEN
    RAISE EXCEPTION 'OWNER_DIGEST_INVALID_ARGUMENT'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.owner_daily_digest_generation_runs_v2 (
    club_id, business_date, trigger_type, requested_by, request_id, reason
  ) VALUES (
    p_club_id, p_business_date, p_trigger_type, p_requested_by, p_request_id, p_reason
  )
  RETURNING run_id INTO v_run_id;

  BEGIN
    -- Serialise Cron/manual regeneration for one Club + business date.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_club_id::text || ':' || p_business_date::text, 0)
    );

    SELECT cs.timezone, s.day_cutoff_local, s.calculation_version
    INTO v_timezone, v_cutoff, v_calculation_version
    FROM private.owner_daily_digest_settings_v2 s
    JOIN public.club_settings cs ON cs.club_id = s.club_id
    WHERE s.club_id = p_club_id;

    IF NOT FOUND OR v_timezone IS NULL
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_timezone) THEN
      RAISE EXCEPTION 'OWNER_DIGEST_TIMEZONE_REQUIRED'
        USING ERRCODE = '22023';
    END IF;

    v_window_start := (p_business_date::timestamp + v_cutoff) AT TIME ZONE v_timezone;
    v_window_end := ((p_business_date + 1)::timestamp + v_cutoff) AT TIME ZONE v_timezone;
    v_source_as_of := clock_timestamp();

    IF v_window_end > v_source_as_of THEN
      RAISE EXCEPTION 'OWNER_DIGEST_WINDOW_NOT_ENDED'
        USING ERRCODE = '22023';
    END IF;

    -- One SQL statement/statement snapshot computes all nine metrics consistently.
    WITH
    cohort_tournaments AS (
      SELECT t.id
      FROM public.tournaments t
      WHERE t.club_id = p_club_id
        AND t.deleted_at IS NULL
        AND t.start_time >= v_window_start
        AND t.start_time < v_window_end
    ),
    confirmed_registrations AS (
      SELECT r.id, r.player_id, r.tournament_id, r.rake_paid_vnd, r.service_fee_paid_vnd
      FROM public.tournament_registrations r
      JOIN cohort_tournaments ct ON ct.id = r.tournament_id
      WHERE r.status = 'confirmed'
    ),
    registration_metrics AS (
      SELECT
        count(DISTINCT player_id)::integer AS registered_players,
        count(*) FILTER (
          WHERE rake_paid_vnd IS NULL OR service_fee_paid_vnd IS NULL
        )::integer AS missing_split_count,
        COALESCE(sum(rake_paid_vnd), 0)::bigint AS rake_paid_vnd,
        COALESCE(sum(service_fee_paid_vnd), 0)::bigint AS service_fee_paid_vnd
      FROM confirmed_registrations
    ),
    valid_entries AS (
      SELECT e.*
      FROM public.tournament_entries e
      JOIN confirmed_registrations r ON r.id = e.registration_id
      WHERE lower(COALESCE(e.status, '')) NOT IN
        ('void', 'voided', 'cancelled', 'canceled', 'refunded', 'rejected')
    ),
    entry_metrics AS (
      SELECT
        count(*)::integer AS entries_count,
        count(DISTINCT player_id) FILTER (
          WHERE checked_in_at IS NOT NULL
             OR seated_at IS NOT NULL
             OR status IN ('seated', 'busted', 'finished')
        )::integer AS attendance_players
      FROM valid_entries
    ),
    staff_presence AS (
      SELECT 'staff:' || s.id::text AS person_key
      FROM public.staff_attendance a
      JOIN public.staff s ON s.id = a.staff_id
      WHERE s.club_id = p_club_id
        AND s.deleted_at IS NULL
        AND lower(COALESCE(a.status, '')) NOT IN ('cancelled', 'canceled', 'no_show')
        AND a.check_in_time < v_window_end
        AND COALESCE(a.check_out_time, v_source_as_of) > v_window_start
      UNION
      SELECT 'dealer:' || d.id::text AS person_key
      FROM public.dealer_attendance a
      JOIN public.dealers d ON d.id = a.dealer_id
      WHERE d.club_id = p_club_id
        AND lower(COALESCE(a.status, '')) NOT IN ('cancelled', 'canceled', 'no_show')
        AND a.check_in_time IS NOT NULL
        AND a.check_in_time < v_window_end
        AND COALESCE(a.check_out_time, v_source_as_of) > v_window_start
    ),
    staff_metrics AS (
      SELECT count(DISTINCT person_key)::integer AS staff_count
      FROM staff_presence
    ),
    fnb_gate AS (
      SELECT COALESCE(f.fnb_in_club_net, false) AS enabled
      FROM public.fnb_settings f
      WHERE f.club_id = p_club_id
    ),
    fnb_movements AS (
      SELECT o.subtotal_vnd::bigint AS amount_vnd
      FROM public.fnb_orders o
      WHERE o.club_id = p_club_id
        AND NOT COALESCE(o.is_comp, false)
        AND o.paid_at IS NOT NULL
        AND o.paid_at >= v_window_start
        AND o.paid_at < v_window_end
      UNION ALL
      SELECT -o.subtotal_vnd::bigint
      FROM public.fnb_orders o
      WHERE o.club_id = p_club_id
        AND NOT COALESCE(o.is_comp, false)
        AND o.status = 'cancelled'
        AND o.paid_at IS NOT NULL
        AND o.cancelled_at >= v_window_start
        AND o.cancelled_at < v_window_end
    ),
    fnb_metrics AS (
      SELECT
        EXISTS (SELECT 1 FROM fnb_gate WHERE enabled) AS source_available,
        COALESCE((SELECT sum(amount_vnd) FROM fnb_movements), 0)::bigint AS net_revenue_vnd
    ),
    applied_payout_tournaments AS (
      SELECT t.id
      FROM public.tournaments t
      JOIN public.tournament_payout_runs pr
        ON pr.tournament_id = t.id AND pr.status = 'applied'
      WHERE t.club_id = p_club_id
    ),
    payout_owed AS (
      SELECT
        COALESCE(sum(tp.amount), 0)::bigint AS owed_vnd,
        count(*) FILTER (WHERE tp.amount <> trunc(tp.amount))::integer AS invalid_amount_count
      FROM public.tournament_entries e
      JOIN applied_payout_tournaments apt ON apt.id = e.tournament_id
      JOIN public.tournament_prizes tp
        ON tp.tournament_id = e.tournament_id
       AND tp.position = e.finished_place
      WHERE e.finished_place IS NOT NULL
    ),
    payout_paid AS (
      SELECT
        COALESCE(sum(pp.prize_amount), 0)::bigint AS paid_vnd,
        count(*) FILTER (
          WHERE pp.prize_amount <> trunc(pp.prize_amount)
        )::integer AS invalid_amount_count
      FROM public.tournament_prize_payments pp
      JOIN applied_payout_tournaments apt ON apt.id = pp.tournament_id
      WHERE pp.status = 'paid'
    ),
    payout_metrics AS (
      SELECT
        GREATEST(o.owed_vnd - p.paid_vnd, 0)::bigint AS outstanding_vnd,
        o.invalid_amount_count + p.invalid_amount_count AS invalid_amount_count
      FROM payout_owed o CROSS JOIN payout_paid p
    ),
    latest_payment_record AS (
      SELECT DISTINCT ON (pr.period_id)
        pr.period_id, pr.status, pr.paid_at, pr.reconciled_at, pr.prepared_at
      FROM public.payment_records pr
      WHERE pr.club_id = p_club_id
      ORDER BY pr.period_id, pr.created_at DESC
    ),
    payroll_rows AS (
      SELECT
        dp.net_pay_vnd,
        CASE
          WHEN pay.reconciled_at IS NOT NULL OR pay.status = 'reconciled' THEN 'reconciled'
          WHEN pay.paid_at IS NOT NULL OR pay.status = 'paid' THEN 'paid'
          WHEN pay.prepared_at IS NOT NULL OR pay.status IN ('prepared', 'payment_prepared')
            THEN 'payment_prepared'
          ELSE lower(COALESCE(pp.status, 'other'))
        END AS effective_status
      FROM public.payroll_periods pp
      LEFT JOIN public.dealer_payroll dp
        ON dp.period_id = pp.id AND COALESCE(dp.status, '') <> 'excluded'
      LEFT JOIN latest_payment_record pay ON pay.period_id = pp.id
      WHERE pp.club_id = p_club_id
    ),
    payroll_metrics AS (
      SELECT
        count(*) FILTER (
          WHERE effective_status IN ('submitted', 'approved', 'locked', 'payment_prepared')
            AND net_pay_vnd IS NULL
        )::integer AS missing_amount_count,
        COALESCE(sum(net_pay_vnd) FILTER (
          WHERE effective_status IN ('submitted', 'approved', 'locked', 'payment_prepared')
        ), 0)::bigint AS outstanding_vnd
      FROM payroll_rows
    )
    SELECT
      rm.registered_players,
      em.attendance_players,
      em.entries_count,
      sm.staff_count,
      CASE WHEN rm.missing_split_count = 0 THEN rm.rake_paid_vnd END,
      CASE WHEN rm.missing_split_count = 0 THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END,
      CASE WHEN rm.missing_split_count = 0 THEN rm.service_fee_paid_vnd END,
      CASE WHEN rm.missing_split_count = 0 THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END,
      CASE WHEN fm.source_available THEN fm.net_revenue_vnd END,
      CASE WHEN fm.source_available THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END,
      pom.outstanding_vnd,
      pom.invalid_amount_count,
      CASE WHEN pm.missing_amount_count = 0 THEN pm.outstanding_vnd END,
      CASE WHEN pm.missing_amount_count = 0 THEN 'AVAILABLE' ELSE 'UNAVAILABLE' END
    INTO
      v_registered, v_attendance, v_entries, v_staff,
      v_rake, v_rake_state, v_service, v_service_state,
      v_fnb, v_fnb_state, v_payout, v_payout_invalid_amounts,
      v_payroll, v_payroll_state
    FROM registration_metrics rm
    CROSS JOIN entry_metrics em
    CROSS JOIN staff_metrics sm
    CROSS JOIN fnb_metrics fm
    CROSS JOIN payout_metrics pom
    CROSS JOIN payroll_metrics pm;

    IF v_payout_invalid_amounts > 0 THEN
      RAISE EXCEPTION 'OWNER_DIGEST_PAYOUT_NON_INTEGER_VND'
        USING ERRCODE = '22003';
    END IF;

    v_warning_codes := ARRAY[]::text[];
    v_action_codes := ARRAY[]::text[];

    IF v_rake_state = 'UNAVAILABLE' OR v_service_state = 'UNAVAILABLE' THEN
      v_warning_codes := array_append(v_warning_codes, 'REGISTRATION_FEE_SPLIT_UNAVAILABLE');
      v_action_codes := array_append(v_action_codes, 'REVIEW_LEGACY_REGISTRATIONS');
    END IF;
    IF v_fnb_state = 'UNAVAILABLE' THEN
      v_warning_codes := array_append(v_warning_codes, 'FNB_SOURCE_UNAVAILABLE');
      v_action_codes := array_append(v_action_codes, 'REVIEW_FNB_CONFIGURATION');
    END IF;
    IF v_payroll_state = 'UNAVAILABLE' THEN
      v_warning_codes := array_append(v_warning_codes, 'PAYROLL_AMOUNT_UNAVAILABLE');
      v_action_codes := array_append(v_action_codes, 'REVIEW_PAYROLL_DATA');
    END IF;
    IF v_payout > 0 THEN
      v_warning_codes := array_append(v_warning_codes, 'PAYOUT_OUTSTANDING');
      v_action_codes := array_append(v_action_codes, 'REVIEW_PAYOUT_OUTSTANDING');
    END IF;
    IF v_attendance < v_registered THEN
      v_warning_codes := array_append(v_warning_codes, 'ATTENDANCE_BELOW_REGISTRATION');
      v_action_codes := array_append(v_action_codes, 'REVIEW_ATTENDANCE_GAP');
    END IF;

    v_freshness_state := CASE
      WHEN v_rake_state = 'AVAILABLE'
       AND v_service_state = 'AVAILABLE'
       AND v_fnb_state = 'AVAILABLE'
       AND v_payroll_state = 'AVAILABLE'
      THEN 'FRESH'
      ELSE 'PARTIAL'
    END;

    v_source_payload := jsonb_build_object(
      'business_date', p_business_date,
      'calculation_version', v_calculation_version,
      'effective_timezone', v_timezone,
      'window_start_utc', v_window_start,
      'window_end_utc', v_window_end,
      'freshness_state', v_freshness_state,
      'money_state', 'PROVISIONAL',
      'metrics', jsonb_build_object(
        'registered_players', jsonb_build_object('value', v_registered, 'state', 'AVAILABLE'),
        'attendance_players', jsonb_build_object('value', v_attendance, 'state', 'AVAILABLE'),
        'entries_count', jsonb_build_object('value', v_entries, 'state', 'AVAILABLE'),
        'staff_count', jsonb_build_object('value', v_staff, 'state', 'AVAILABLE'),
        'rake_paid_vnd', jsonb_build_object('value', v_rake, 'state', v_rake_state),
        'service_fee_paid_vnd', jsonb_build_object('value', v_service, 'state', v_service_state),
        'fnb_net_revenue_vnd', jsonb_build_object('value', v_fnb, 'state', v_fnb_state),
        'payout_outstanding_vnd', jsonb_build_object('value', v_payout, 'state', 'AVAILABLE'),
        'dealer_payroll_outstanding_vnd', jsonb_build_object('value', v_payroll, 'state', v_payroll_state)
      ),
      'warning_codes', to_jsonb(v_warning_codes),
      'action_codes', to_jsonb(v_action_codes)
    );

    v_source_hash := private.owner_daily_digest_content_hash_v2(v_source_payload);

    SELECT s.snapshot_id INTO v_existing_snapshot_id
    FROM private.owner_daily_digest_snapshots_v2 s
    WHERE s.club_id = p_club_id
      AND s.business_date = p_business_date
      AND s.calculation_version = v_calculation_version
      AND s.source_hash = v_source_hash;

    IF v_existing_snapshot_id IS NOT NULL THEN
      UPDATE private.owner_daily_digest_generation_runs_v2
      SET status = 'SUCCESS', completed_at = clock_timestamp(), snapshot_id = v_existing_snapshot_id,
          result_code = 'UNCHANGED_REUSED'
      WHERE run_id = v_run_id;
      RETURN v_existing_snapshot_id;
    END IF;

    SELECT s.snapshot_id, s.snapshot_version
    INTO v_supersedes_snapshot_id, v_revision
    FROM private.owner_daily_digest_snapshots_v2 s
    WHERE s.club_id = p_club_id
      AND s.business_date = p_business_date
      AND s.calculation_version = v_calculation_version
    ORDER BY s.snapshot_version DESC
    LIMIT 1;

    v_revision := COALESCE(v_revision, 0) + 1;

    INSERT INTO private.owner_daily_digest_snapshots_v2 (
      club_id, business_date, snapshot_version, calculation_version,
      effective_timezone, window_start_utc, window_end_utc, source_as_of,
      notification_expires_at, trigger_type, generated_by, supersedes_snapshot_id,
      source_hash, content_hash, freshness_state, money_state,
      registered_players, attendance_players, entries_count, staff_count,
      rake_paid_vnd, rake_paid_state, service_fee_paid_vnd, service_fee_paid_state,
      fnb_net_revenue_vnd, fnb_net_revenue_state,
      payout_outstanding_vnd, dealer_payroll_outstanding_vnd,
      dealer_payroll_outstanding_state, warning_codes, action_codes
    ) VALUES (
      p_club_id, p_business_date, v_revision, v_calculation_version,
      v_timezone, v_window_start, v_window_end, v_source_as_of,
      clock_timestamp() + interval '8 hours', p_trigger_type, p_requested_by,
      v_supersedes_snapshot_id, v_source_hash, v_source_hash,
      v_freshness_state, 'PROVISIONAL',
      v_registered, v_attendance, v_entries, v_staff,
      v_rake, v_rake_state, v_service, v_service_state,
      v_fnb, v_fnb_state, v_payout, v_payroll, v_payroll_state,
      v_warning_codes, v_action_codes
    )
    RETURNING snapshot_id INTO v_snapshot_id;

    INSERT INTO private.owner_daily_digest_outbox_v2 (
      event_id, event_type, club_id, snapshot_id, dedupe_key,
      payload, occurred_at, available_at, expires_at
    )
    SELECT
      s.event_id,
      'owner.daily_digest.snapshot_created',
      s.club_id,
      s.snapshot_id,
      'owner-digest:' || s.club_id::text || ':' || s.business_date::text || ':' || s.source_hash,
      jsonb_build_object(
        'snapshot_id', s.snapshot_id,
        'club_id', s.club_id,
        'business_date', s.business_date,
        'snapshot_version', s.snapshot_version,
        'calculation_version', s.calculation_version,
        'content_hash', s.content_hash,
        'schema_version', 2
      ),
      s.generated_at,
      s.generated_at,
      s.notification_expires_at
    FROM private.owner_daily_digest_snapshots_v2 s
    WHERE s.snapshot_id = v_snapshot_id;

    UPDATE private.owner_daily_digest_generation_runs_v2
    SET status = 'SUCCESS', completed_at = clock_timestamp(), snapshot_id = v_snapshot_id,
        result_code = 'SNAPSHOT_CREATED'
    WHERE run_id = v_run_id;

    RETURN v_snapshot_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    UPDATE private.owner_daily_digest_generation_runs_v2
    SET status = 'FAILED', completed_at = clock_timestamp(), result_code = 'GENERATION_FAILED',
        sanitized_error_code = 'SQLSTATE_' || regexp_replace(v_sqlstate, '[^A-Z0-9]', '', 'g')
    WHERE run_id = v_run_id;
    RETURN NULL;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION private.generate_owner_daily_digest_snapshot_v2(uuid,date,text,uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.generate_owner_daily_digest_snapshot_v2(uuid,date,text,uuid,uuid,text)
  TO service_role;

-- --------------------------------------------------------------------------------------------
-- 4. Manual-request worker and one global timezone-aware due-runner.
-- --------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.process_owner_daily_digest_requests_v2(
  p_limit integer DEFAULT 20
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $function$
DECLARE
  v_request record;
  v_snapshot_id uuid;
  v_processed integer := 0;
BEGIN
  FOR v_request IN
    SELECT r.*
    FROM private.owner_daily_digest_generation_requests_v2 r
    WHERE r.status = 'PENDING'
    ORDER BY r.created_at, r.request_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)
  LOOP
    UPDATE private.owner_daily_digest_generation_requests_v2
    SET status = 'PROCESSING', processing_started_at = clock_timestamp()
    WHERE request_id = v_request.request_id;

    v_snapshot_id := private.generate_owner_daily_digest_snapshot_v2(
      v_request.club_id,
      v_request.business_date,
      'MANUAL',
      v_request.requested_by,
      v_request.request_id,
      v_request.reason
    );

    UPDATE private.owner_daily_digest_generation_requests_v2
    SET status = CASE WHEN v_snapshot_id IS NULL THEN 'FAILED' ELSE 'SUCCESS' END,
        snapshot_id = v_snapshot_id,
        result_code = CASE WHEN v_snapshot_id IS NULL THEN 'GENERATION_FAILED' ELSE 'COMPLETED' END,
        completed_at = clock_timestamp()
    WHERE request_id = v_request.request_id;

    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$function$;

CREATE OR REPLACE FUNCTION private.run_owner_daily_digest_due_v2()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, extensions, pg_temp
AS $function$
DECLARE
  v_due record;
  v_processed integer := 0;
BEGIN
  PERFORM private.process_owner_daily_digest_requests_v2(20);

  FOR v_due IN
    WITH candidate AS (
      SELECT
        s.club_id,
        d.local_date - 1 AS business_date,
        ((d.local_date::date + s.generation_time_local) AT TIME ZONE cs.timezone) AS scheduled_at
      FROM private.owner_daily_digest_settings_v2 s
      JOIN public.club_settings cs ON cs.club_id = s.club_id
      CROSS JOIN LATERAL (
        SELECT gs::date AS local_date
        FROM generate_series(
          ((clock_timestamp() AT TIME ZONE cs.timezone)::date - 1)::timestamp,
          (clock_timestamp() AT TIME ZONE cs.timezone)::date::timestamp,
          interval '1 day'
        ) gs
      ) d
      WHERE s.enabled
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = cs.timezone)
    )
    SELECT c.club_id, c.business_date
    FROM candidate c
    WHERE c.scheduled_at <= clock_timestamp()
      AND c.scheduled_at > clock_timestamp() - interval '24 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM private.owner_daily_digest_generation_runs_v2 r
        WHERE r.club_id = c.club_id
          AND r.business_date = c.business_date
          AND r.trigger_type = 'SCHEDULE'
          AND r.status = 'SUCCESS'
      )
    ORDER BY c.scheduled_at, c.club_id
  LOOP
    PERFORM private.generate_owner_daily_digest_snapshot_v2(
      v_due.club_id, v_due.business_date, 'SCHEDULE', NULL, NULL, NULL
    );
    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$function$;

REVOKE ALL ON FUNCTION private.process_owner_daily_digest_requests_v2(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.run_owner_daily_digest_due_v2()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.process_owner_daily_digest_requests_v2(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION private.run_owner_daily_digest_due_v2()
  TO service_role;

-- One global job; it is inert because every Club setting defaults to enabled=false.
DO $cron$
DECLARE
  v_job_id bigint;
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    SELECT jobid INTO v_job_id FROM cron.job
    WHERE jobname = 'owner-daily-digest-v2-due-runner';
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    PERFORM cron.schedule(
      'owner-daily-digest-v2-due-runner',
      '*/5 * * * *',
      $job$SELECT private.run_owner_daily_digest_due_v2();$job$
    );
  END IF;
END;
$cron$;
