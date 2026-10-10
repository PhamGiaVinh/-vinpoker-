#!/usr/bin/env bash
set -euo pipefail
# Final correction callback races a plain tournament lock that rolls back.
[[ ${PGDATABASE:-} == vinpoker_ops_* || ${PGDATABASE:-} == floor_table_control_v3_contract ]] || exit 1
[[ -z ${PGHOST:-} || ${PGHOST:-} == 127.0.0.1 ]] || exit 1
sql() { psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
[[ $(sql "SELECT current_setting('server_version_num')::integer BETWEEN 170000 AND 179999;") == t ]] || exit 1
tour=00000000-0000-0000-0000-000000000131
session=00000000-0000-0000-0000-000000000670
table=00000000-0000-0000-0000-000000000770
actor=00000000-0000-0000-0000-000000000001
tag="mode_retry_$$"
sql "BEGIN; UPDATE public.tournaments SET deleted_at=NULL WHERE id='$tour';
  UPDATE public.tracker_voice_configs SET correction_state='correction_pending' WHERE tournament_table_id='$table';
  SELECT set_config('request.jwt.claim.sub','$actor',true);
  SELECT public.floor_request_table_control_mode_v4('$table','$session','tracker',revision,control_epoch,gen_random_uuid()) FROM public.table_sessions WHERE id='$session'; COMMIT;" | grep -q '"outcome": "pending"'
before=$(sql "SELECT control_mode||','||revision||','||control_epoch FROM public.table_sessions WHERE id='$session';")
coproc LOCK_TX { psql -X -qAt -v ON_ERROR_STOP=1; }
lock_pid=$LOCK_TX_PID
lock_in=${LOCK_TX[1]}
lock_out=${LOCK_TX[0]}
printf "SET application_name='%s'; BEGIN; SET LOCAL statement_timeout='8s'; SELECT id FROM public.tournaments WHERE id='%s' FOR UPDATE;\n" "$tag" "$tour" >&"$lock_in"
found=false
for i in $(seq 1 160); do
  if [[ $(sql "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='$tag' AND state='idle in transaction');") == t ]]; then found=true; break; fi
  sleep 0.025
done
[[ $found == true ]] || { echo 'real overlap barrier absent'; exit 1; }
sql "BEGIN; SET LOCAL statement_timeout='2s'; UPDATE public.tracker_voice_configs SET correction_state='ready' WHERE tournament_table_id='$table'; SET CONSTRAINTS ALL IMMEDIATE; COMMIT;" >/dev/null
[[ $(sql "SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='$session' AND status='pending' AND blockers ? 'tournament_busy';") == 1 ]]
printf 'ROLLBACK;\n' >&"$lock_in"
exec {lock_in}>&-
cat <&"$lock_out" >/dev/null
wait "$lock_pid"
# No UI, hand start, mutation or caller replay; only the server retry entry point.
sql "SELECT floor_private.resolve_pending_table_modes_v1(50);" >/dev/null
[[ $(sql "SELECT control_mode='tracker' AND NOT EXISTS(SELECT 1 FROM floor_private.table_mode_requests_v1 WHERE table_session_id='$session' AND status='pending') FROM public.table_sessions WHERE id='$session';") == t ]]
[[ $(sql "SELECT sum(chip_count) FROM public.tournament_seats WHERE table_session_id='$session' AND is_active;") == 30000 ]]
echo MODE_RETRY_PG17_REAL_OVERLAP_PASS
