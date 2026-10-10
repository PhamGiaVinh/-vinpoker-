#!/usr/bin/env bash
set -euo pipefail
[[ ${PGDATABASE:-} == vinpoker_ops_* || ${PGDATABASE:-} == floor_table_control_v3_contract ]] || exit 1
[[ -z ${PGHOST:-} || ${PGHOST:-} == 127.0.0.1 ]] || exit 1
sql() { psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
[[ $(sql "SELECT current_setting('server_version_num')::integer BETWEEN 170000 AND 179999;") == t ]] || exit 1
tour=00000000-0000-0000-0000-000000000131
session=00000000-0000-0000-0000-000000000670
table=00000000-0000-0000-0000-000000000770
actor=00000000-0000-0000-0000-000000000001
tag="mode_request_lock_$$"
sql "BEGIN; UPDATE public.tournaments SET deleted_at=NULL WHERE id='$tour';
  UPDATE public.tracker_voice_configs SET correction_state='correction_pending' WHERE tournament_table_id='$table';
  SELECT set_config('request.jwt.claim.sub','$actor',true);
  SELECT public.floor_request_table_control_mode_v4('$table','$session',CASE control_mode WHEN 'manual' THEN 'tracker' ELSE 'manual' END,revision,control_epoch,gen_random_uuid()) FROM public.table_sessions WHERE id='$session'; COMMIT;" | grep -q '"outcome": "pending"'
before=$(sql "SELECT control_mode||','||revision||','||control_epoch FROM public.table_sessions WHERE id='$session';")
coproc TERMINAL_TX { psql -X -qAt -v ON_ERROR_STOP=1; }
terminal_pid=$TERMINAL_TX_PID
terminal_in=${TERMINAL_TX[1]}
terminal_out=${TERMINAL_TX[0]}
printf "SET application_name='%s'; BEGIN; SET LOCAL statement_timeout='8s'; SELECT id FROM floor_private.table_mode_requests_v1 WHERE table_session_id='%s' AND status='pending' FOR UPDATE;\n" "$tag" "$session" >&"$terminal_in"
found=false
for i in $(seq 1 160); do
  if [[ $(sql "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='$tag' AND state='idle in transaction');") == t ]]; then found=true; break; fi
  sleep 0.025
done
[[ $found == true ]] || { echo 'real overlap barrier absent'; exit 1; }
result=$(sql "BEGIN; SET LOCAL statement_timeout='2s'; SELECT floor_private.resolve_table_mode_request_v1('$session'); COMMIT;")
grep -q 'request_busy' <<<"$result"
[[ $(sql "SELECT control_mode||','||revision||','||control_epoch FROM public.table_sessions WHERE id='$session';") == "$before" ]]
printf "UPDATE public.tournaments SET deleted_at=now() WHERE id='%s'; COMMIT;\n" "$tour" >&"$terminal_in"
exec {terminal_in}>&-
cat <&"$terminal_out" >/dev/null
wait "$terminal_pid"
sql "SELECT floor_private.resolve_pending_table_modes_v1(50);" >/dev/null
[[ $(sql "SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='$session' AND status='pending';") == 0 ]]
[[ $(sql "SELECT control_mode||','||revision||','||control_epoch FROM public.table_sessions WHERE id='$session';") == "$before" ]]
[[ $(sql "SELECT sum(chip_count) FROM public.tournament_seats WHERE table_session_id='$session' AND is_active;") == 30000 ]]
echo MODE_REQUEST_LOCK_PG17_REAL_OVERLAP_PASS
