#!/usr/bin/env bash
set -euo pipefail

psql_args=(-v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")
lock_log=$(mktemp)
writer_log=$(mktemp)
trap 'rm -f "$lock_log" "$writer_log"' EXIT

# Qualification wins the event fence; a new source flight waits and fails.
psql "${psql_args[@]}" >"$lock_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
BEGIN;
SELECT public.multi_day_lock_qualification_v1(
 '30000000-0000-0000-0000-000000000004',
 ARRAY[(SELECT bag_id FROM public.multi_day_qualification_race_fixture_v1
        WHERE event_id='30000000-0000-0000-0000-000000000004')],
 (SELECT source_hash FROM public.multi_day_qualification_race_fixture_v1
        WHERE event_id='30000000-0000-0000-0000-000000000004'),
 'c0000000-0000-0000-0000-000000000401');
SELECT pg_sleep(2);
COMMIT;
SQL
lock_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$writer_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
INSERT INTO public.tournaments(id,club_id,event_id,phase)
VALUES('40000000-0000-0000-0000-000000000011',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000004','flight');
SQL
then echo 'new flight bypassed committed qualification' >&2; exit 1; fi
wait "$lock_pid"
grep -q 'multi_day_flight_set_locked' "$writer_log"
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.tournaments WHERE id='40000000-0000-0000-0000-000000000011'")" = 0

# New flight wins the same fence. The old preview hash is rejected after
# waiting for commit; no stale participation is persisted.
psql "${psql_args[@]}" >"$writer_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
BEGIN;
INSERT INTO public.tournaments(id,club_id,event_id,phase)
VALUES('40000000-0000-0000-0000-000000000010',
 '20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000005','flight');
SELECT pg_sleep(2);
COMMIT;
SQL
writer_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$lock_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_lock_qualification_v1(
 '30000000-0000-0000-0000-000000000005',
 ARRAY[(SELECT bag_id FROM public.multi_day_qualification_race_fixture_v1
        WHERE event_id='30000000-0000-0000-0000-000000000005')],
 (SELECT source_hash FROM public.multi_day_qualification_race_fixture_v1
        WHERE event_id='30000000-0000-0000-0000-000000000005'),
 'c0000000-0000-0000-0000-000000000501');
SQL
then echo 'stale source hash survived new flight' >&2; exit 1; fi
wait "$writer_pid"
grep -q 'multi_day_qualification_stale_source' "$lock_log"
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.multi_day_qualification_locks_v1 WHERE event_id='30000000-0000-0000-0000-000000000005'")" = 0
echo 'multiday_qualification_race_v1 PASS'
