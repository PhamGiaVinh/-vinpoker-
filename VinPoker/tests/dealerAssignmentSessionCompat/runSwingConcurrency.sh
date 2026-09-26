#!/usr/bin/env bash
set -euo pipefail

psqlx() { psql -X -v ON_ERROR_STOP=1 -Atqc "$1"; }

TABLE="11000000-0000-4000-8000-000000000090"
CLUB="20000000-0000-4000-8000-000000000001"
SESSION="51000000-0000-4000-8000-000000000090"
OLD="61000000-0000-4000-8000-000000000090"
A="31000000-0000-4000-8000-000000000090"
B="31000000-0000-4000-8000-000000000091"
C="31000000-0000-4000-8000-000000000092"

psqlx "
  INSERT INTO public.dealers(id, full_name) VALUES
    ('41000000-0000-4000-8000-000000000090', 'Race A'),
    ('41000000-0000-4000-8000-000000000091', 'Race B'),
    ('41000000-0000-4000-8000-000000000092', 'Race C');
  INSERT INTO public.game_tables(id, club_id, table_name, status) VALUES ('$TABLE', '$CLUB', 'Swing Race', 'active');
  INSERT INTO public.table_sessions(id, club_id, game_table_id, session_type, control_mode)
    VALUES ('$SESSION', '$CLUB', '$TABLE', 'tournament', 'tracker');
  INSERT INTO public.dealer_attendance(id, dealer_id, current_state, status) VALUES
    ('$A', '41000000-0000-4000-8000-000000000090', 'assigned', 'checked_in'),
    ('$B', '41000000-0000-4000-8000-000000000091', 'pre_assigned', 'checked_in'),
    ('$C', '41000000-0000-4000-8000-000000000092', 'pre_assigned', 'checked_in');
  INSERT INTO public.dealer_assignments(id, attendance_id, table_id, table_session_id, club_id, status, assigned_at, idempotency_key)
    VALUES ('$OLD', '$A', '$TABLE', '$SESSION', '$CLUB', 'assigned', now() - interval '30 minutes', 'race-old');
"

psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT public.execute_pre_assigned_swing_rpc('$OLD','$B',now()+interval '30 minutes',30,false,15)->>'status'" >/tmp/swing-b.out &
p1=$!
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT public.execute_pre_assigned_swing_rpc('$OLD','$C',now()+interval '30 minutes',30,false,15)->>'status'" >/tmp/swing-c.out &
p2=$!
wait "$p1"
wait "$p2"

outcomes=$(cat /tmp/swing-b.out /tmp/swing-c.out | sort | tr '\n' ' ')
[[ "$outcomes" == "error success " ]]
[[ "$(psqlx "SELECT count(*) FROM public.dealer_assignments WHERE table_id='$TABLE' AND status='assigned' AND released_at IS NULL")" == "1" ]]
[[ "$(psqlx "SELECT count(*) FROM public.swing_log WHERE assignment_id='$OLD' AND outcome='swung'")" == "1" ]]
echo "SWING_DOUBLE_EXECUTOR=PASS"
echo "SWING_DUPLICATES=0"
