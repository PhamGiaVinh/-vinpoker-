#!/usr/bin/env bash
set -euo pipefail
psql_args=(-v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")
winner_log=$(mktemp)
loser_log=$(mktemp)
overlay_log=$(mktemp)
trap 'rm -f "$winner_log" "$loser_log" "$overlay_log"' EXIT

psql "${psql_args[@]}" >"$winner_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
BEGIN;
SELECT public.multi_day_finalize_payout_v1(f.event_id,f.rules_version,
 f.funding_revision,f.qualification_revision,f.payout_input_hash,
 '93000000-0000-0000-0000-000000000041')
FROM public.multi_day_payout_race_fixture_v1 f;
SELECT pg_sleep(2);
COMMIT;
SQL
winner_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$loser_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_finalize_payout_v1(f.event_id,f.rules_version,
 f.funding_revision,f.qualification_revision,f.payout_input_hash,
 '93000000-0000-0000-0000-000000000042')
FROM public.multi_day_payout_race_fixture_v1 f;
SQL
then echo 'concurrent second payout finalize committed' >&2; exit 1; fi
wait "$winner_pid"
grep -q 'multi_day_payout_already_finalized' "$loser_log"
psql "${psql_args[@]}" >/dev/null <<'SQL'
INSERT INTO public.bank_transactions(id,provider,api_verified_at,transfer_type,
 amount,status,account_number,club_id)
VALUES('ba000000-0000-0000-0000-000000000041','sepay',now(),'in',1,
 'unmatched','proof-account-1','20000000-0000-0000-0000-000000000001');
SQL
if psql "${psql_args[@]}" >"$overlay_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_record_overlay_v1(
 '30000000-0000-0000-0000-00000000000b','RECORDED',1,
 'bank-evidence-post-final','Post finalize source mutation',NULL,NULL,
 '92000000-0000-0000-0000-000000000041',
 'ba000000-0000-0000-0000-000000000041');
SQL
then echo 'post-finalize overlay committed' >&2; exit 1; fi
grep -q 'multi_day_payout_linked_adjustment_required' "$overlay_log"

psql "${psql_args[@]}" -At <<'SQL' | grep -q '^t$'
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT (public.multi_day_finalize_payout_v1(f.event_id,f.rules_version,
 f.funding_revision,f.qualification_revision,f.payout_input_hash,
 '93000000-0000-0000-0000-000000000041')->>'idempotent')='true'
FROM public.multi_day_payout_race_fixture_v1 f;
SQL
if psql "${psql_args[@]}" >"$loser_log" 2>&1 <<'SQL'
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_finalize_payout_v1(f.event_id,f.rules_version,
 f.funding_revision,f.qualification_revision,md5('changed-payload'),
 '93000000-0000-0000-0000-000000000041')
FROM public.multi_day_payout_race_fixture_v1 f;
SQL
then echo 'same request changed payload accepted' >&2; exit 1; fi
grep -q 'multi_day_payout_request_conflict' "$loser_log"
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.multi_day_payout_finalizations_v1 WHERE event_id='30000000-0000-0000-0000-00000000000b'")" = 1
echo 'multiday_payout_finalize_race_v1 PASS'
