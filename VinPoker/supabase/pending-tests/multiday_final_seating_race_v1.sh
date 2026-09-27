#!/usr/bin/env bash
set -euo pipefail
psql_args=(-v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")
winner_log=$(mktemp)
loser_log=$(mktemp)
trap 'rm -f "$winner_log" "$loser_log"' EXIT

# First transaction holds the previously absent player fence through commit.
# The second must wait, observe the committed seating and fail as a duplicate.
psql "${psql_args[@]}" >"$winner_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
BEGIN;
SELECT public.multi_day_seat_final_v1(
 '30000000-0000-0000-0000-000000000004',
 '60000000-0000-0000-0000-00000000000c',
 '80000000-0000-0000-0000-00000000000d',1,0,
 '91000000-0000-0000-0000-000000000041');
SELECT pg_sleep(2);
COMMIT;
SQL
winner_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$loser_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
SELECT public.multi_day_seat_final_v1(
 '30000000-0000-0000-0000-000000000004',
 '60000000-0000-0000-0000-00000000000c',
 '80000000-0000-0000-0000-00000000000d',2,0,
 '91000000-0000-0000-0000-000000000042');
SQL
then echo 'concurrent duplicate Final Day seat committed' >&2; exit 1; fi
wait "$winner_pid"
grep -q 'multi_day_final_player_already_seated' "$loser_log"
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.multi_day_final_seatings_v1 WHERE final_tournament_id='40000000-0000-0000-0000-00000000000d' AND player_id='60000000-0000-0000-0000-00000000000c'")" = 1
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.tournament_entries WHERE tournament_id='40000000-0000-0000-0000-00000000000d' AND player_id='60000000-0000-0000-0000-00000000000c'")" = 1
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.tournament_seats WHERE tournament_id='40000000-0000-0000-0000-00000000000d' AND player_id='60000000-0000-0000-0000-00000000000c'")" = 1
echo 'multiday_final_seating_race_v1 PASS'
