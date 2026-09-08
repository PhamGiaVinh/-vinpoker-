#!/usr/bin/env bash
set -euo pipefail

psqlx() {
  psql -X -v ON_ERROR_STOP=1 -Atqc "$1"
}

TABLE="10000000-0000-4000-8000-000000000090"
CLUB="20000000-0000-4000-8000-000000000001"
SESSION="50000000-0000-4000-8000-000000000090"
A1="30000000-0000-4000-8000-000000000090"
A2="30000000-0000-4000-8000-000000000091"
A3="30000000-0000-4000-8000-000000000092"

psqlx "
  INSERT INTO public.game_tables(id, club_id, table_name, status)
  VALUES ('$TABLE', '$CLUB', 'Race', 'active');
  INSERT INTO public.dealer_attendance(id, dealer_id, current_state, status) VALUES
    ('$A1', '40000000-0000-4000-8000-000000000090', 'available', 'checked_in'),
    ('$A2', '40000000-0000-4000-8000-000000000091', 'available', 'checked_in'),
    ('$A3', '40000000-0000-4000-8000-000000000092', 'available', 'checked_in');
"

# Session-open transaction owns the physical-table lock first. Assignment must
# wait, then observe and bind the committed active session.
psql -X -v ON_ERROR_STOP=1 -qc "
  BEGIN;
  SELECT id FROM public.game_tables WHERE id='$TABLE' FOR UPDATE;
  INSERT INTO public.table_sessions(id, club_id, game_table_id, session_type, control_mode)
  VALUES ('$SESSION', '$CLUB', '$TABLE', 'tournament', 'tracker');
  SELECT pg_sleep(1);
  COMMIT;
" >/tmp/session-open.log 2>&1 &
open_pid=$!
sleep 0.2
open_result=$(psqlx "SELECT public.assign_dealer_to_table('$A1', '$TABLE', p_idempotency_key => 'race-open') ->> 'outcome'")
wait "$open_pid"
[[ "$open_result" == "ok" ]]
[[ "$(psqlx "SELECT table_session_id FROM public.dealer_assignments WHERE idempotency_key='race-open'")" == "$SESSION" ]]
echo "ASSIGN_VS_OPEN=PASS"

psqlx "
  UPDATE public.dealer_assignments SET status='completed', released_at=now() WHERE idempotency_key='race-open';
  UPDATE public.dealer_attendance SET current_state='available' WHERE id='$A1';
"

# Session-close wins the same lock order. Assignment waits, then intentionally
# takes legacy compatibility mode rather than binding the closed session.
psql -X -v ON_ERROR_STOP=1 -qc "
  BEGIN;
  SELECT id FROM public.game_tables WHERE id='$TABLE' FOR UPDATE;
  UPDATE public.table_sessions SET closed_at=now() WHERE id='$SESSION';
  SELECT pg_sleep(1);
  COMMIT;
" >/tmp/session-close.log 2>&1 &
close_pid=$!
sleep 0.2
close_result=$(psqlx "SELECT public.assign_dealer_to_table('$A1', '$TABLE', p_idempotency_key => 'race-close') ->> 'outcome'")
wait "$close_pid"
[[ "$close_result" == "ok" ]]
[[ "$(psqlx "SELECT table_session_id IS NULL FROM public.dealer_assignments WHERE idempotency_key='race-close'")" == "t" ]]
echo "ASSIGN_VS_CLOSE=PASS"

psqlx "
  UPDATE public.dealer_assignments SET status='completed', released_at=now() WHERE idempotency_key='race-close';
  UPDATE public.dealer_attendance SET current_state='available' WHERE id IN ('$A1', '$A2');
"

# Both assignments serialize on the physical table; exactly one may succeed.
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT public.assign_dealer_to_table('$A1', '$TABLE', p_idempotency_key => 'race-double-a') ->> 'outcome'" >/tmp/double-a.out 2>&1 &
p1=$!
psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT public.assign_dealer_to_table('$A2', '$TABLE', p_idempotency_key => 'race-double-b') ->> 'outcome'" >/tmp/double-b.out 2>&1 &
p2=$!
wait "$p1"
wait "$p2"
outcomes=$(cat /tmp/double-a.out /tmp/double-b.out | sort | tr '\n' ' ')
[[ "$outcomes" == "ok table_occupied " ]]
[[ "$(psqlx "SELECT count(*) FROM public.dealer_assignments WHERE table_id='$TABLE' AND status='assigned' AND released_at IS NULL")" == "1" ]]
echo "DOUBLE_ASSIGN=PASS"

# A canonical release may already own the assignment row while a forced
# replacement starts. Release never takes the physical-table lock, so the
# replacement waits without forming a lock cycle and leaves one active row.
psql -X -v ON_ERROR_STOP=1 -qc "
  BEGIN;
  SELECT id
  FROM public.dealer_assignments
  WHERE table_id='$TABLE' AND status='assigned' AND released_at IS NULL
  FOR UPDATE;
  SELECT pg_sleep(1);
  UPDATE public.dealer_assignments
  SET status='completed', released_at=now(), release_reason='race-release'
  WHERE table_id='$TABLE' AND status='assigned' AND released_at IS NULL;
  COMMIT;
" >/tmp/assignment-release.log 2>&1 &
release_pid=$!
sleep 0.2
release_race_result=$(psqlx "SELECT public.assign_dealer_to_table('$A3', '$TABLE', p_idempotency_key => 'race-release-replace', p_force_replace => true) ->> 'outcome'")
wait "$release_pid"
[[ "$release_race_result" == "ok" ]]
[[ "$(psqlx "SELECT count(*) FROM public.dealer_assignments WHERE table_id='$TABLE' AND status='assigned' AND released_at IS NULL")" == "1" ]]
[[ "$(psqlx "SELECT attendance_id FROM public.dealer_assignments WHERE idempotency_key='race-release-replace'")" == "$A3" ]]
echo "ASSIGN_VS_RELEASE=PASS"
echo "DEADLOCKS=0"
echo "WRONG_SESSION_BINDINGS=0"
