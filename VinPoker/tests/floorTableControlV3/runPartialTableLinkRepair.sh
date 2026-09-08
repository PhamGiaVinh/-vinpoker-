#!/usr/bin/env bash
set -euo pipefail

setup="tests/floorTableControlV3/repairTrackerTestRosterPartialTableLink.setup.sql"
helper="scripts/production/repairs/repair_tracker_test_roster_tournament_table_link_ban5.sql"
fingerprint="SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) FROM public.tournament_seats s WHERE s.tournament_id='00000000-0000-0000-0000-000000000109';"

run_reject() {
  local name="$1" mutation="$2" before after status
  psql -v ON_ERROR_STOP=1 -f "$setup" >/dev/null
  psql -v ON_ERROR_STOP=1 -c "$mutation" >/dev/null
  before="$(psql -tA -c "$fingerprint")"
  set +e
  psql -v ON_ERROR_STOP=1 -f "$helper" >/tmp/partial-repair.log 2>&1
  status=$?
  set -e
  after="$(psql -tA -c "$fingerprint")"
  if [[ $status -eq 0 || "$before" != "$after" ]]; then
    cat /tmp/partial-repair.log
    echo "PARTIAL_REPAIR_NEGATIVE_FAILED=$name"
    exit 1
  fi
  echo "PARTIAL_REPAIR_NEGATIVE_PASS=$name"
}

target="tournament_id='00000000-0000-0000-0000-000000000109'"
run_reject already_linked "UPDATE public.tournament_seats SET tournament_table_id=table_id WHERE $target AND seat_number=1"
run_reject wrong_entry "UPDATE public.tournament_seats s SET entry_id=(SELECT e.id FROM public.tournament_entries e WHERE e.tournament_id<>'00000000-0000-0000-0000-000000000109' LIMIT 1) WHERE s.$target AND s.seat_number=1"
run_reject wrong_session "UPDATE public.tournament_seats SET table_session_id='00000000-0000-0000-0000-000000009630' WHERE $target AND seat_number=1"
run_reject wrong_table "UPDATE public.tournament_seats SET table_id='00000000-0000-0000-0000-000000009730' WHERE $target AND seat_number=1"
run_reject wrong_name "UPDATE public.tournament_seats SET player_name='Wrong' WHERE $target AND seat_number=1"
run_reject wrong_chips "UPDATE public.tournament_seats SET chip_count=1999999 WHERE $target AND seat_number=1"
run_reject extra_seat "INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,table_id,table_session_id,seat_number,chip_count,is_active,status,player_name) VALUES ('00000000-0000-0000-0000-000000009999','00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000009999',1,'00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000630',10,1,true,'active','Extra')"
run_reject missing_seat "UPDATE public.tournament_seats SET is_active=false WHERE $target AND seat_number=1"
run_reject wrong_tournament_name "UPDATE public.tournaments SET name='Wrong' WHERE id='00000000-0000-0000-0000-000000000109'"
run_reject closed_session "UPDATE public.table_sessions SET closed_at=now() WHERE id='00000000-0000-0000-0000-000000000630'"
run_reject manual_session "UPDATE public.table_sessions SET control_mode='manual' WHERE id='00000000-0000-0000-0000-000000000630'"
run_reject target_active_hand "INSERT INTO public.tournament_hands(id,tournament_id,table_id,tournament_table_id,table_session_id,status,is_voided) VALUES ('00000000-0000-0000-0000-000000009951','00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000730','00000000-0000-0000-0000-000000000630','in_progress',false)"

psql -v ON_ERROR_STOP=1 -f "$setup" >/dev/null
psql -v ON_ERROR_STOP=1 -f "$helper"
psql -v ON_ERROR_STOP=1 -f tests/floorTableControlV3/repairTrackerTestRosterPartialTableLink.verify.sql
