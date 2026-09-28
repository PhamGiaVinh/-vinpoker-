#!/usr/bin/env bash
set -euo pipefail

DB_URL="${1:?database url required}"
call="SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',false);
SELECT set_config('request.jwt.claim.role','authenticated',false);
SELECT public.operator_perform_swing(
  '20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003',
  '60000000-0000-4000-8000-000000000003',1,'80000000-0000-4000-8000-000000000099');"

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -Atqc "$call" > /tmp/swing-a.out &
pid_a=$!
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -Atqc "$call" > /tmp/swing-b.out &
pid_b=$!
wait "$pid_a"
wait "$pid_b"

grep -q '"outcome": "swung"' /tmp/swing-a.out
grep -q '"outcome": "swung"' /tmp/swing-b.out
grep -q '"idempotent": true' <(cat /tmp/swing-a.out /tmp/swing-b.out)

test "$(psql "$DB_URL" -X -Atqc "SELECT count(*) FROM public.dealer_swing_operator_requests WHERE request_id='80000000-0000-4000-8000-000000000099'")" = "1"
test "$(psql "$DB_URL" -X -Atqc "SELECT count(*) FROM public.dealer_assignments WHERE table_id='20000000-0000-4000-8000-000000000003' AND status='assigned' AND released_at IS NULL")" = "1"
