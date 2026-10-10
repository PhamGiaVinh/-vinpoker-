#!/usr/bin/env bash
set -euo pipefail
[[ ${PGDATABASE:-} == vinpoker_ops_* || ${PGDATABASE:-} == floor_table_control_v3_contract ]] || exit 1
[[ -z ${PGHOST:-} || ${PGHOST:-} == 127.0.0.1 ]] || exit 1
sql() { psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
[[ $(sql "SELECT current_setting('server_version_num')::integer BETWEEN 170000 AND 179999;") == t ]] || exit 1
psql -X -q -v ON_ERROR_STOP=1 -v SEED_MODE_FAIRNESS_ONLY=1 -f "$(dirname "$0")/tableModeRetryFairness.disposable.sql"
sql 'UPDATE floor_private.table_mode_retry_cursor_v1 SET last_session_id=NULL WHERE singleton;' >/dev/null
tag="mode_locked_fairness_$$"
coproc BATCH_LOCK { psql -X -qAt -v ON_ERROR_STOP=1; }
lock_pid=$BATCH_LOCK_PID
lock_in=${BATCH_LOCK[1]}
lock_out=${BATCH_LOCK[0]}
printf "SET application_name='%s'; BEGIN; SET LOCAL statement_timeout='8s'; SELECT id FROM public.table_sessions WHERE id BETWEEN '20000000-0000-0000-0000-000000000001' AND '20000000-0000-0000-0000-000000000050' ORDER BY id FOR UPDATE;\n" "$tag" >&"$lock_in"
found=false
for i in $(seq 1 160); do
  if [[ $(sql "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='$tag' AND state='idle in transaction');") == t ]]; then found=true; break; fi
  sleep 0.025
done
[[ $found == true ]] || { echo 'real locked batch barrier absent'; exit 1; }
first=$(sql "BEGIN; SET LOCAL statement_timeout='2s'; SELECT floor_private.resolve_pending_table_modes_v1(50); COMMIT;")
grep -q '"checked": 0' <<<"$first"
[[ $(sql "SELECT last_session_id='20000000-0000-0000-0000-000000000050' FROM floor_private.table_mode_retry_cursor_v1 WHERE singleton;") == t ]]
second=$(sql "BEGIN; SET LOCAL statement_timeout='2s'; SELECT floor_private.resolve_pending_table_modes_v1(50); COMMIT;")
grep -q '"applied": 1' <<<"$second"
[[ $(sql "SELECT control_mode='tracker' FROM public.table_sessions WHERE id='20000000-0000-0000-0000-000000000051';") == t ]]
[[ $(sql "SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE status='pending' AND table_session_id BETWEEN '20000000-0000-0000-0000-000000000001' AND '20000000-0000-0000-0000-000000000050';") == 50 ]]
printf 'ROLLBACK;\n' >&"$lock_in"
exec {lock_in}>&-
cat <&"$lock_out" >/dev/null
wait "$lock_pid"
echo MODE_LOCKED_FAIRNESS_PG17_REAL_OVERLAP_PASS
