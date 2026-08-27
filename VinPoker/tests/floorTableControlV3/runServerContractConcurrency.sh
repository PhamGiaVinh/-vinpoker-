#!/usr/bin/env bash
set -euo pipefail

# Disposable PostgreSQL only.  Each competing writer below uses an independent
# psql connection, bounded lock waits, and the real `authenticated` role.  No
# project ref, URL, credential, production data, DB apply, or Edge deploy is
# involved.
umask 077
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

psql_quiet() {
  psql -X -qAt -v ON_ERROR_STOP=1 "$@"
}

assert_scalar() {
  local expected="$1"
  local sql="$2"
  local actual
  actual="$(psql_quiet -c "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    echo "FLOOR_TABLE_CONTROL_V3_CONCURRENCY_ASSERTION_FAILED expected=$expected actual=$actual" >&2
    exit 1
  fi
}

assert_exactly_one_success() {
  local left="$1"
  local right="$2"
  local successes
  # `grep -h -c` emits bare per-file counts (for example `1` then `0`), not
  # `file:count`.  Sum those counts directly, and keep the zero-success path
  # diagnostic rather than letting `set -e -o pipefail` hide it.
  successes="$({ grep -h -c '"ok": true' "$left" "$right" || true; } | awk '{ sum += $1 } END { print sum + 0 }')"
  if [[ "$successes" != "1" ]]; then
    echo "FLOOR_TABLE_CONTROL_V3_CONCURRENCY_ASSERTION_FAILED expected one winner" >&2
    cat "$left" "$right" >&2
    exit 1
  fi
  if grep -qi 'deadlock detected\|canceling statement due to lock timeout' "$left" "$right"; then
    echo "FLOOR_TABLE_CONTROL_V3_CONCURRENCY_ASSERTION_FAILED deadlock_or_lock_timeout" >&2
    cat "$left" "$right" >&2
    exit 1
  fi
}

run_first_with_tournament_lock() {
  local tournament_id="$1"
  local rpc_sql="$2"
  psql_quiet <<SQL
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL deadlock_timeout = '200ms';
SELECT 1 FROM public.tournaments WHERE id = '${tournament_id}' FOR UPDATE;
SELECT pg_catalog.pg_sleep(0.8);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
${rpc_sql}
COMMIT;
SQL
}

run_floor_rpc() {
  local rpc_sql="$1"
  psql_quiet <<SQL
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL deadlock_timeout = '200ms';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
${rpc_sql}
COMMIT;
SQL
}

echo 'FLOOR_TABLE_CONTROL_V3_CONCURRENCY same-seat race'
run_first_with_tournament_lock \
  '00000000-0000-0000-0000-000000000103' \
  "SELECT public.floor_assign_entry_to_seat('00000000-0000-0000-0000-000000000810', '00000000-0000-0000-0000-000000000720', 1, 1, '00000000-0000-0000-0000-000000003001');" \
  >"$tmp_dir/same-seat-a" 2>&1 &
same_seat_a=$!
sleep 0.15
run_floor_rpc \
  "SELECT public.floor_assign_entry_to_seat('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000720', 1, 1, '00000000-0000-0000-0000-000000003002');" \
  >"$tmp_dir/same-seat-b" 2>&1 &
same_seat_b=$!
wait "$same_seat_a"
wait "$same_seat_b"
assert_exactly_one_success "$tmp_dir/same-seat-a" "$tmp_dir/same-seat-b"
assert_scalar '1' "SELECT count(*) FROM public.tournament_seats WHERE tournament_table_id = '00000000-0000-0000-0000-000000000720' AND seat_number = 1 AND is_active;"
assert_scalar '1' "SELECT count(*) FROM public.tournament_seats WHERE tournament_id = '00000000-0000-0000-0000-000000000103' AND is_active;"

echo 'FLOOR_TABLE_CONTROL_V3_CONCURRENCY move race'
run_first_with_tournament_lock \
  '00000000-0000-0000-0000-000000000104' \
  "SELECT public.move_player_seat_v2('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000724', 1, 1, 1, '00000000-0000-0000-0000-000000003003');" \
  >"$tmp_dir/move-a" 2>&1 &
move_a=$!
sleep 0.15
run_floor_rpc \
  "SELECT public.move_player_seat_v2('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000725', 1, 1, 1, '00000000-0000-0000-0000-000000003004');" \
  >"$tmp_dir/move-b" 2>&1 &
move_b=$!
wait "$move_a"
wait "$move_b"
assert_exactly_one_success "$tmp_dir/move-a" "$tmp_dir/move-b"
assert_scalar '1' "SELECT count(*) FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000812' AND is_active;"
assert_scalar '1' "SELECT count(*) FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000812' AND tournament_table_id IN ('00000000-0000-0000-0000-000000000724', '00000000-0000-0000-0000-000000000725') AND is_active;"

echo 'FLOOR_TABLE_CONTROL_V3_CONCURRENCY move-vs-bust race'
run_first_with_tournament_lock \
  '00000000-0000-0000-0000-000000000105' \
  "SELECT public.move_player_seat_v2('00000000-0000-0000-0000-000000000813', '00000000-0000-0000-0000-000000000727', 1, 1, 1, '00000000-0000-0000-0000-000000003005');" \
  >"$tmp_dir/move-bust-a" 2>&1 &
move_bust_a=$!
sleep 0.15
run_floor_rpc \
  "SELECT public.floor_bust_player_v3('00000000-0000-0000-0000-000000000813', 1, 1, 30000, '00000000-0000-0000-0000-000000003006', 'concurrency_fixture');" \
  >"$tmp_dir/move-bust-b" 2>&1 &
move_bust_b=$!
wait "$move_bust_a"
wait "$move_bust_b"
assert_exactly_one_success "$tmp_dir/move-bust-a" "$tmp_dir/move-bust-b"
assert_scalar 't' "SELECT ((SELECT count(*) FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000813' AND is_active) = 1 AND EXISTS (SELECT 1 FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000813' AND tournament_table_id = '00000000-0000-0000-0000-000000000727' AND is_active)) OR ((SELECT count(*) FROM public.tournament_seats WHERE entry_id = '00000000-0000-0000-0000-000000000813' AND is_active) = 0 AND (SELECT status FROM public.tournament_entries WHERE id = '00000000-0000-0000-0000-000000000813') = 'busted');"

echo 'FLOOR_TABLE_CONTROL_V3_CONCURRENCY close-vs-dealer assignment race'
(
  psql_quiet <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL deadlock_timeout = '200ms';
SELECT 1 FROM public.table_sessions WHERE id = '00000000-0000-0000-0000-000000000628' FOR SHARE;
SELECT pg_catalog.pg_sleep(0.8);
INSERT INTO public.dealer_assignments (table_id, table_session_id, status)
VALUES ('00000000-0000-0000-0000-000000000528', '00000000-0000-0000-0000-000000000628', 'assigned');
COMMIT;
SQL
) >"$tmp_dir/dealer-assignment" 2>&1 &
dealer_assignment=$!
sleep 0.15
(
  psql_quiet <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL deadlock_timeout = '200ms';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
SELECT public.close_tournament_table_v3(
  '00000000-0000-0000-0000-000000000728',
  1,
  '00000000-0000-0000-0000-000000003007'
);
COMMIT;
SQL
) >"$tmp_dir/close" 2>&1 &
close_table=$!
wait "$dealer_assignment"
wait "$close_table"
if ! grep -q '"ok": true' "$tmp_dir/close"; then
  echo 'FLOOR_TABLE_CONTROL_V3_CONCURRENCY_ASSERTION_FAILED close did not succeed' >&2
  cat "$tmp_dir/close" >&2
  exit 1
fi
if grep -qi 'deadlock detected\|canceling statement due to lock timeout' "$tmp_dir/dealer-assignment" "$tmp_dir/close"; then
  echo 'FLOOR_TABLE_CONTROL_V3_CONCURRENCY_ASSERTION_FAILED close-dealer deadlock_or_lock_timeout' >&2
  cat "$tmp_dir/dealer-assignment" "$tmp_dir/close" >&2
  exit 1
fi
assert_scalar 't' "SELECT closed_at IS NOT NULL FROM public.table_sessions WHERE id = '00000000-0000-0000-0000-000000000628';"
assert_scalar '0' "SELECT count(*) FROM public.dealer_assignments WHERE table_session_id = '00000000-0000-0000-0000-000000000628' AND released_at IS NULL AND status IN ('assigned', 'on_break');"

if psql_quiet <<'SQL' >"$tmp_dir/closed-session-assignment" 2>&1
BEGIN;
INSERT INTO public.dealer_assignments (table_id, table_session_id, status)
VALUES ('00000000-0000-0000-0000-000000000528', '00000000-0000-0000-0000-000000000628', 'assigned');
COMMIT;
SQL
then
  echo 'FLOOR_TABLE_CONTROL_V3_CONCURRENCY_ASSERTION_FAILED closed session accepted a dealer assignment' >&2
  exit 1
fi
if ! grep -q 'floor_table_v3_dealer_assignment_session_not_active' "$tmp_dir/closed-session-assignment"; then
  cat "$tmp_dir/closed-session-assignment" >&2
  exit 1
fi

echo 'FLOOR_TABLE_CONTROL_V3_SERVER_CONTRACT_CONCURRENCY_PASS'
