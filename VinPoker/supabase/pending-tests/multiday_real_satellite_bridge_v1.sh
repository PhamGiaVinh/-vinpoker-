#!/usr/bin/env bash
set -euo pipefail
own_vinpoker=$(cd "${1:?own VinPoker path required}" && pwd)
sat_vinpoker=$(cd "${2:?Satellite dependency VinPoker path required}" && pwd)
psql_args=(-h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1)

cd "$sat_vinpoker"
psql "${psql_args[@]}" \
  -f supabase/pending-tests/cashier_tour_disposable_baseline.sql \
  -f supabase/migrations/20270109000000_ops_floor_cashier_canonical_mutations.sql \
  -f supabase/migrations/20270115000003_cashier_tour_money_v1.sql \
  -f supabase/pending-migrations/20270115000011_cashier_refund_without_floor_clearance.sql \
  -f supabase/pending-migrations/20270119000002_satellite_registration_pool_row_v1.sql \
  -f supabase/pending-tests/satellite_source_funding_disposable_setup.sql \
  -f supabase/pending-migrations/20260924165219_centerpoint_tournament_ops_release_v1.sql \
  -f supabase/pending-migrations/20270117000001_satellite_award_plan_v1.sql \
  -f supabase/pending-migrations/20270118000002_satellite_single_ticket_rank_v2.sql \
  -f supabase/pending-migrations/20270117000002_satellite_ticket_issue_v1.sql \
  -f supabase/pending-migrations/20260925092509_satellite_funding_preview_math_v1.sql \
  -f supabase/pending-migrations/20270119000003_satellite_source_funding_preview_v1.sql \
  -f supabase/pending-migrations/20270119000004_satellite_frozen_ticket_components_v1.sql \
  -f supabase/pending-migrations/20270119000005_satellite_source_cutoff_v1.sql \
  -f supabase/pending-migrations/20270119000006_satellite_entry_cutoff_v1.sql \
  -f supabase/pending-migrations/20270119000007_satellite_offline_source_guard_v1.sql \
  -f supabase/pending-migrations/20270119000009_satellite_source_rules_fixed_v1.sql \
  -f supabase/pending-migrations/20270119000008_satellite_verified_award_lock_v1.sql \
  -f supabase/pending-migrations/20270119000010_satellite_locked_registration_evidence_v1.sql \
  -f supabase/pending-migrations/20270119000011_satellite_issue_and_secret_v1.sql \
  -f supabase/pending-migrations/20270119000012_satellite_unmatched_funding_guard_v1.sql \
  -f supabase/pending-migrations/20270119000013_satellite_atomic_redeem_v1.sql \
  -f supabase/pending-tests/satellite_reversal_hand_disposable_setup.sql \
  -f supabase/pending-migrations/20270119000014_satellite_redemption_reversal_v1.sql \
  -f supabase/pending-tests/satellite_redeem_race_seed.sql

psql "${psql_args[@]}" -v serial=1 -v worker=integrated-ticket \
  -v player=d1000000-0000-4000-8000-000000000013 \
  -v request=d8000000-0000-4000-8000-000000000091 -v hold_seconds=0 \
  -f supabase/pending-tests/satellite_redeem_race_ticket.sql
psql "${psql_args[@]}" -v serial=2 -v worker=integrated-ticket-2 \
  -v player=d1000000-0000-4000-8000-000000000014 \
  -v request=d8000000-0000-4000-8000-000000000092 -v hold_seconds=0 \
  -f supabase/pending-tests/satellite_redeem_race_ticket.sql

cd "$own_vinpoker"
psql "${psql_args[@]}" \
  -f supabase/pending-tests/multiday_real_satellite_bridge_fixture_v1.sql \
  -f supabase/pending-migrations/20270120000005_multiday_overlay_funding_v1.sql \
  -f supabase/pending-migrations/20270119000001_multiday_equal_tie_entitlement_v1.sql \
  -f supabase/pending-migrations/20270120000006_multiday_payout_snapshot_v1.sql \
  -f supabase/pending-migrations/20270120000007_multiday_payout_source_proof_v1.sql \
  -f supabase/pending-tests/multiday_real_satellite_bridge_assert_v1.sql
echo 'multiday_real_satellite_bridge_v1 PASS'
