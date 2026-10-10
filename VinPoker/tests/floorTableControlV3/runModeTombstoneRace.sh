#!/usr/bin/env bash
set -euo pipefail
# Inherited mode fixture, disposable DB only. No Supabase/project credential.
[[ ${PGDATABASE:-} == vinpoker_ops_* || ${PGDATABASE:-} == floor_table_control_v3_contract ]] || { echo 'disposable database required'; exit 1; }
[[ -z ${PGHOST:-} || ${PGHOST:-} == 127.0.0.1 ]] || { echo 'local socket or loopback required'; exit 1; }
[[ $(psql -X -At -c "SELECT current_database() NOT IN ('postgres','template0','template1') AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999;") == t ]] || { echo 'disposable PG17 required'; exit 1; }
sql() { psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
tour=00000000-0000-0000-0000-000000000131
session=00000000-0000-0000-0000-000000000670
table=00000000-0000-0000-0000-000000000770
actor=00000000-0000-0000-0000-000000000001
tag="mode_tombstone_$$"
sql "BEGIN; SELECT set_config('request.jwt.claim.sub','$actor',true);
  SELECT public.floor_request_table_control_mode_v4('$table','$session','tracker',revision,control_epoch,gen_random_uuid()) FROM public.table_sessions WHERE id='$session'; COMMIT;" | grep -q '"outcome": "pending"'
before=$(sql "SELECT control_mode||','||revision||','||control_epoch FROM public.table_sessions WHERE id='$session';")
coproc OWNER_TX { psql -X -qAt -v ON_ERROR_STOP=1; }
owner_pid=$OWNER_TX_PID
owner_in=${OWNER_TX[1]}
owner_out=${OWNER_TX[0]}
printf "SET application_name='%s'; BEGIN; SET LOCAL statement_timeout='8s'; SELECT id FROM public.tournaments WHERE id='%s' FOR UPDATE;\n" "$tag" "$tour" >&"$owner_in"
found=false
for i in $(seq 1 160); do
  if [[ $(sql "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='$tag' AND state='idle in transaction');") == t ]]; then found=true; break; fi
  sleep 0.025
done
[[ $found == true ]] || { echo 'real overlap barrier absent'; exit 1; }
# B holds session while A holds tournament. NOWAIT must return, not deadlock.
result=$(sql "BEGIN; SET LOCAL statement_timeout='2s'; SELECT id FROM public.table_sessions WHERE id='$session' FOR UPDATE; SELECT floor_private.resolve_table_mode_request_v1('$session'); COMMIT;")
grep -q 'tournament_busy' <<<"$result"
[[ $(sql "SELECT control_mode||','||revision||','||control_epoch FROM public.table_sessions WHERE id='$session';") == "$before" ]]
printf "UPDATE public.tournaments SET deleted_at=now() WHERE id='%s'; COMMIT;\n" "$tour" >&"$owner_in"
exec {owner_in}>&-
cat <&"$owner_out" >/dev/null
wait "$owner_pid"
[[ $(sql "SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='$session' AND status='pending';") == 0 ]]
[[ $(sql "SELECT count(*) FROM floor_private.table_mode_requests_v1 WHERE table_session_id='$session' AND status='expired' AND blockers ? 'tournament_not_open';") == 1 ]]
[[ $(sql "SELECT control_mode||','||revision||','||control_epoch FROM public.table_sessions WHERE id='$session';") == "$before" ]]
[[ $(sql "SELECT sum(chip_count) FROM public.tournament_seats WHERE table_session_id='$session' AND is_active;") == 30000 ]]
echo MODE_TOMBSTONE_PG17_REAL_OVERLAP_PASS
