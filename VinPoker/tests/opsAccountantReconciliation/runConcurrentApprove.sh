#!/bin/sh
set -eu

: "${PGHOST:=localhost}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=postgres}"

psql -X -q -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -f tests/opsAccountantReconciliation/concurrentApprove.sql \
  >/tmp/ops-accountant-approve-a.out 2>/tmp/ops-accountant-approve-a.err &
pid_a=$!
psql -X -q -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -f tests/opsAccountantReconciliation/concurrentApprove.sql \
  >/tmp/ops-accountant-approve-b.out 2>/tmp/ops-accountant-approve-b.err &
pid_b=$!

set +e
wait "$pid_a"
exit_a=$?
wait "$pid_b"
exit_b=$?
set -e

successes=0
[ "$exit_a" -eq 0 ] && successes=$((successes + 1))
[ "$exit_b" -eq 0 ] && successes=$((successes + 1))

echo "RACE_EXIT_A=$exit_a"
echo "RACE_EXIT_B=$exit_b"

if [ "$successes" -ne 1 ]; then
  echo "Expected exactly one successful approval"
  sed -n '1,10p' /tmp/ops-accountant-approve-a.err
  sed -n '1,10p' /tmp/ops-accountant-approve-b.err
  exit 1
fi

result=$(psql -X -At -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 \
  -c "SELECT status || ':' || approved_by::text FROM public.payroll_periods WHERE id='40000000-0000-4000-8000-000000000001';")

if [ "$result" != "approved:00000000-0000-4000-8000-000000000001" ]; then
  echo "Unexpected final approval state"
  exit 1
fi

echo "FINAL_STATE=$result"
echo "PG17_CONCURRENT_APPROVAL_PASS"
