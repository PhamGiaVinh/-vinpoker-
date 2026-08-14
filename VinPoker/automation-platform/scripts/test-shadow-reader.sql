\set ON_ERROR_STOP on

-- Disposable local TEST only. This reader consumes the same immutable V2 snapshot as the web;
-- it never aggregates canonical money/attendance tables itself.
CREATE SCHEMA IF NOT EXISTS vinpoker_test;
REVOKE ALL ON SCHEMA vinpoker_test FROM PUBLIC;

CREATE OR REPLACE VIEW vinpoker_test.owner_digest_shadow_source
WITH (security_barrier = true)
AS
SELECT
  c.id AS club_id,
  c.owner_id AS owner_id,
  c.name AS display_code,
  s.snapshot_id,
  s.snapshot_version,
  s.calculation_version,
  s.source_as_of,
  s.generated_at,
  s.notification_expires_at,
  s.source_hash,
  s.content_hash,
  jsonb_build_object(
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
  ) AS content_payload,
  o.event_id,
  o.event_type,
  o.dedupe_key,
  o.payload AS outbox_payload,
  o.occurred_at AS event_occurred_at,
  o.available_at AS event_available_at,
  o.expires_at AS event_expires_at
FROM public.clubs c
JOIN LATERAL (
  SELECT snapshot.*
  FROM private.owner_daily_digest_snapshots_v2 snapshot
  WHERE snapshot.club_id = c.id
  ORDER BY snapshot.business_date DESC, snapshot.snapshot_version DESC
  LIMIT 1
) s ON true
JOIN private.owner_daily_digest_outbox_v2 o
  ON o.snapshot_id = s.snapshot_id
WHERE c.id IN (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinpoker_digest_shadow_reader') THEN
    CREATE ROLE vinpoker_digest_shadow_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE vinpoker_digest_shadow_reader PASSWORD :'digest_password';
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vinpoker_digest_shadow_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM vinpoker_digest_shadow_reader;
GRANT CONNECT ON DATABASE postgres TO vinpoker_digest_shadow_reader;
GRANT USAGE ON SCHEMA vinpoker_test TO vinpoker_digest_shadow_reader;
GRANT SELECT ON vinpoker_test.owner_digest_shadow_source TO vinpoker_digest_shadow_reader;
