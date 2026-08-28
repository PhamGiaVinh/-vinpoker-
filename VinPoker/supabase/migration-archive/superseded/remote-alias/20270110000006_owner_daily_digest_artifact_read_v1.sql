-- Owner Daily Digest V1 — typed, append-only report artifact + Owner-scoped read RPC.
--
-- SOURCE-ONLY / RED: merging this file does NOT apply it to any database.
-- Apply requires the controlled DB runbook, owner approval, TEST negative auth tests,
-- and a separate feature-flag/UAT decision.
--
-- The browser reads one server-produced snapshot. It never recomputes rake, F&B,
-- payout liability, payroll, attendance, or entries from domain tables.
--
-- ROLLBACK (only if the feature has not stored records that must be retained):
--   DROP FUNCTION IF EXISTS public.get_latest_owner_daily_digest_artifact(uuid, date);
--   DROP TABLE IF EXISTS public.owner_daily_digest_reports;

CREATE TABLE IF NOT EXISTS public.owner_daily_digest_reports (
  artifact_id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  business_date date NOT NULL,
  generated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  freshness_state text NOT NULL CHECK (freshness_state IN ('FRESH', 'PARTIAL', 'STALE')),
  money_state text NOT NULL CHECK (money_state IN ('NONE', 'PROVISIONAL', 'CLOSED')),
  registrations integer NOT NULL CHECK (registrations >= 0),
  attendance integer NOT NULL CHECK (attendance >= 0),
  entries integer NOT NULL CHECK (entries >= 0),
  staff_count integer NOT NULL CHECK (staff_count >= 0),
  rake_retained_vnd bigint NOT NULL CHECK (rake_retained_vnd >= 0),
  fnb_net_revenue_vnd bigint NOT NULL CHECK (fnb_net_revenue_vnd >= 0),
  pending_liabilities_vnd bigint NOT NULL CHECK (pending_liabilities_vnd >= 0),
  payroll_provisional_vnd bigint NOT NULL CHECK (payroll_provisional_vnd >= 0),
  warning_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  action_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > generated_at),
  CHECK (cardinality(warning_codes) <= 32),
  CHECK (cardinality(action_codes) <= 32)
);

COMMENT ON TABLE public.owner_daily_digest_reports IS
  'Append-only server-produced Owner Daily Digest artifacts. No client writes or aggregation.';

CREATE INDEX IF NOT EXISTS owner_daily_digest_reports_latest_idx
  ON public.owner_daily_digest_reports (club_id, business_date DESC, generated_at DESC);

ALTER TABLE public.owner_daily_digest_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_daily_digest_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_daily_digest_reports_select_owner ON public.owner_daily_digest_reports;
CREATE POLICY owner_daily_digest_reports_select_owner
  ON public.owner_daily_digest_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = owner_daily_digest_reports.club_id
        AND (
          c.owner_id = (SELECT auth.uid())
          OR public.has_role((SELECT auth.uid()), 'super_admin'::public.app_role)
        )
    )
  );

REVOKE ALL ON TABLE public.owner_daily_digest_reports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.owner_daily_digest_reports TO authenticated;
GRANT SELECT, INSERT ON TABLE public.owner_daily_digest_reports TO service_role;

CREATE OR REPLACE FUNCTION public.get_latest_owner_daily_digest_artifact(
  p_club_id uuid,
  p_business_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'artifact_id', r.artifact_id,
    'club_id', r.club_id,
    'artifact_type', 'OWNER_DAILY_DIGEST',
    'schema_version', 1,
    'generated_at', r.generated_at,
    'expires_at', r.expires_at,
    'content_sha256', r.content_sha256,
    'content_payload', jsonb_build_object(
      'business_date', r.business_date,
      'freshness_state', r.freshness_state,
      'money_state', r.money_state,
      'metrics', jsonb_build_object(
        'registrations', r.registrations,
        'attendance', r.attendance,
        'entries', r.entries,
        'staff', r.staff_count,
        'rake_retained_vnd', r.rake_retained_vnd,
        'fnb_net_revenue_vnd', r.fnb_net_revenue_vnd,
        'pending_liabilities_vnd', r.pending_liabilities_vnd,
        'payroll_provisional_vnd', r.payroll_provisional_vnd
      ),
      'warning_codes', to_jsonb(r.warning_codes),
      'action_codes', to_jsonb(r.action_codes)
    )
  )
  FROM public.owner_daily_digest_reports r
  WHERE r.club_id = p_club_id
    AND (p_business_date IS NULL OR r.business_date = p_business_date)
  ORDER BY r.business_date DESC, r.generated_at DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_latest_owner_daily_digest_artifact(uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_latest_owner_daily_digest_artifact(uuid, date)
  TO authenticated;
