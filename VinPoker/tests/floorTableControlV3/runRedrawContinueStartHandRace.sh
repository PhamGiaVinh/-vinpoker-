#!/usr/bin/env bash
set -euo pipefail

# PG17 disposable database only. Both contenders call their real public RPCs.
psql_quiet() { psql -X -qAt -v ON_ERROR_STOP=1 "$@"; }
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo 'REDRAW_CLOCK_HOLD Continue-vs-start_hand fence race'
batch_id="$(psql_quiet -c "SELECT id FROM public.tournament_redraw_batches WHERE tournament_id = '00000000-0000-0000-0000-000000000112' AND status = 'applied' AND hold_completed_at IS NULL")"
if [[ -z "$batch_id" ]]; then
  echo 'REDRAW_CLOCK_HOLD_ASSERTION_FAILED missing applied race batch' >&2
  exit 1
fi
(
  psql_quiet <<SQL
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL deadlock_timeout = '200ms';
SELECT 1 FROM public.tournaments
WHERE id = '00000000-0000-0000-0000-000000000112' FOR UPDATE;
SELECT pg_catalog.pg_sleep(1.5);
COMMIT;
SQL
) >"$tmp_dir/fence" 2>&1 &
fence_pid=$!
sleep 0.15

(
  psql_quiet <<SQL
BEGIN;
SET LOCAL application_name = 'redraw_start_hand_contender';
SET LOCAL lock_timeout = '5s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true);
SELECT public.start_hand(
  '00000000-0000-0000-0000-000000000112',
  '00000000-0000-0000-0000-000000000743',
  101, now(), '00000000-0000-0000-0000-000000000004', 1
);
COMMIT;
SQL
) >"$tmp_dir/start-hand" 2>&1 &
start_pid=$!

# Wait until the actual start_hand trigger is queued on the shared tournament
# row fence before launching Continue, making the order deterministic.
for _ in $(seq 1 50); do
  waiting="$(psql_quiet -c "SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name = 'redraw_start_hand_contender' AND wait_event_type = 'Lock'")"
  [[ "$waiting" == '1' ]] && break
  sleep 0.05
done
if [[ "${waiting:-0}" != '1' ]]; then
  echo 'REDRAW_CLOCK_HOLD_ASSERTION_FAILED start_hand did not queue on tournament fence' >&2
  cat "$tmp_dir/start-hand" >&2
  exit 1
fi

(
  psql_quiet <<SQL
BEGIN;
SET LOCAL application_name = 'redraw_continue_contender';
SET LOCAL lock_timeout = '5s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
SELECT public.floor_continue_tournament_redraw_v1(
  '$batch_id', 1,
  '00000000-0000-0000-0000-000000003119'
);
COMMIT;
SQL
) >"$tmp_dir/continue" 2>&1 &
continue_pid=$!

fence_status=0; start_status=0; continue_status=0
wait "$fence_pid" || fence_status=$?
wait "$start_pid" || start_status=$?
wait "$continue_pid" || continue_status=$?
if [[ "$fence_status" != 0 || "$continue_status" != 0 ]]; then
  echo 'REDRAW_CLOCK_HOLD_ASSERTION_FAILED fence or Continue RPC failed' >&2
  cat "$tmp_dir/fence" "$tmp_dir/start-hand" "$tmp_dir/continue" >&2
  exit 1
fi
if [[ "$start_status" == 0 ]] || ! grep -q 'redraw_table_hold_active' "$tmp_dir/start-hand"; then
  echo 'REDRAW_CLOCK_HOLD_ASSERTION_FAILED start_hand crossed active redraw hold' >&2
  cat "$tmp_dir/start-hand" "$tmp_dir/continue" >&2
  exit 1
fi
if ! grep -q '"ok": true' "$tmp_dir/continue"; then
  echo 'REDRAW_CLOCK_HOLD_ASSERTION_FAILED Continue did not complete' >&2
  cat "$tmp_dir/continue" >&2
  exit 1
fi
if [[ "$(psql_quiet -c "SELECT count(*) FROM public.tournament_hands WHERE tournament_id = '00000000-0000-0000-0000-000000000112' AND status = 'in_progress'")" != '0' ]]; then
  echo 'REDRAW_CLOCK_HOLD_ASSERTION_FAILED raced start_hand left a live hand' >&2
  exit 1
fi
if [[ "$(psql_quiet -c "SELECT count(*) FROM public.table_sessions WHERE tournament_id = '00000000-0000-0000-0000-000000000112' AND redraw_hold_batch_id IS NOT NULL")" != '0' ]]; then
  echo 'REDRAW_CLOCK_HOLD_ASSERTION_FAILED Continue left a redraw hold active' >&2
  exit 1
fi
echo 'REDRAW_CLOCK_HOLD_CONTINUE_START_HAND_RACE_PASS'
