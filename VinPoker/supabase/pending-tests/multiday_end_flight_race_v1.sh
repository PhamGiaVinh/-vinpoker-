#!/usr/bin/env bash
set -euo pipefail

psql_args=(-v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")
writer_log=$(mktemp)
end_log=$(mktemp)
trap 'rm -f "$writer_log" "$end_log"' EXIT

# Writer wins the fence. Its in-progress hand must commit before End Flight
# checks readiness; End Flight must fail rather than snapshot stale source.
psql "${psql_args[@]}" >"$writer_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
BEGIN;
INSERT INTO public.tournament_hands VALUES(
 'd0000000-0000-0000-0000-000000000004',
 '40000000-0000-0000-0000-000000000004',
 '70000000-0000-0000-0000-000000000004',1,'in_progress',1);
SELECT pg_sleep(2);
COMMIT;
SQL
writer_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$end_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_end_flight_v1('40000000-0000-0000-0000-000000000004',1,
  'c0000000-0000-0000-0000-000000000004');
SQL
then echo 'End Flight accepted an in-flight hand' >&2; exit 1; fi
wait "$writer_pid"
grep -q 'multi_day_end_flight_not_ready' "$end_log"

# End Flight wins the fence. A later direct hand writer waits for the same
# tournament lock and then fails, with no hand row committed.
psql "${psql_args[@]}" >"$end_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
BEGIN;
SELECT public.multi_day_end_flight_v1('40000000-0000-0000-0000-000000000005',1,
  'c0000000-0000-0000-0000-000000000005');
SELECT pg_sleep(2);
COMMIT;
SQL
end_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$writer_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
INSERT INTO public.tournament_hands VALUES(
 'd0000000-0000-0000-0000-000000000005',
 '40000000-0000-0000-0000-000000000005',
 '70000000-0000-0000-0000-000000000005',1,'in_progress',1);
SQL
then echo 'Direct hand writer passed after End Flight' >&2; exit 1; fi
wait "$end_pid"
grep -q 'multi_day_end_play_source_frozen' "$writer_log"
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.tournament_hands WHERE tournament_id='40000000-0000-0000-0000-000000000005'")" = 0
echo 'multiday_end_flight_race_v1 PASS'
