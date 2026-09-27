#!/usr/bin/env bash
set -euo pipefail
psql_args=(-v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")
winner_log=$(mktemp)
loser_log=$(mktemp)
trap 'rm -f "$winner_log" "$loser_log"' EXIT

psql "${psql_args[@]}" >/dev/null <<'SQL'
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_request_payout_correction_v1(
 f.event_id,'OBLIGATION_DELTA',
 (f.obligations->0->>'participationId')::uuid,NULL,-10000,
 public.multi_day_payout_postfinal_state_v1(f.event_id)->>'revision',
 'Race correction first','race-evidence-first',
 'a0000000-0000-0000-0000-000000000111')
FROM public.multi_day_payout_finalizations_v1 f
WHERE f.event_id='30000000-0000-0000-0000-00000000000a';
SELECT public.multi_day_request_payout_correction_v1(
 f.event_id,'OBLIGATION_DELTA',
 (f.obligations->0->>'participationId')::uuid,NULL,-10000,
 public.multi_day_payout_postfinal_state_v1(f.event_id)->>'revision',
 'Race correction second','race-evidence-second',
 'a0000000-0000-0000-0000-000000000112')
FROM public.multi_day_payout_finalizations_v1 f
WHERE f.event_id='30000000-0000-0000-0000-00000000000a';
SQL

psql "${psql_args[@]}" >"$winner_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
BEGIN;
SELECT public.multi_day_approve_payout_correction_v1(
 'a0000000-0000-0000-0000-000000000111',
 'a0000000-0000-0000-0000-000000000211');
SELECT pg_sleep(2);
COMMIT;
SQL
winner_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$loser_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_approve_payout_correction_v1(
 'a0000000-0000-0000-0000-000000000112',
 'a0000000-0000-0000-0000-000000000212');
SQL
then echo 'stale concurrent approval committed' >&2; exit 1; fi
wait "$winner_pid"
grep -q 'multi_day_payout_recalculate' "$loser_log"
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.multi_day_payout_corrections_v1 WHERE request_id IN ('a0000000-0000-0000-0000-000000000111','a0000000-0000-0000-0000-000000000112')")" = 1
echo 'multiday_payout_postfinal_race_v1 PASS'
