#!/usr/bin/env bash
set -euo pipefail
psql_args=(-X -v ON_ERROR_STOP=1 -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")
first_log=$(mktemp)
second_log=$(mktemp)
trap 'rm -f "$first_log" "$second_log"' EXIT

psql "${psql_args[@]}" <<'SQL'
INSERT INTO public.bank_transactions(id,provider,api_verified_at,transfer_type,
 amount,status,account_number,club_id)
VALUES('ba000000-0000-0000-0000-000000000051','sepay',now(),'in',1000,
 'unmatched','proof-account-1','20000000-0000-0000-0000-000000000001');
SQL

psql "${psql_args[@]}" >"$first_log" 2>&1 <<'SQL' &
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
SET request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
BEGIN;
SELECT public.multi_day_record_overlay_v1(
 '30000000-0000-0000-0000-000000000002','RECORDED',1000,
 'bank-evidence-race-51','Owner approved tested bank receipt',NULL,NULL,
 '92000000-0000-0000-0000-000000000051',
 'ba000000-0000-0000-0000-000000000051');
SELECT pg_sleep(2);
COMMIT;
SQL
first_pid=$!
sleep 0.3
if psql "${psql_args[@]}" >"$second_log" 2>&1 <<'SQL'
SET lock_timeout='5s';
SET deadlock_timeout='500ms';
INSERT INTO public.cashier_buyin_movements(bank_transaction_id,club_id,
 purpose,direction,amount,applied_amount)
VALUES('ba000000-0000-0000-0000-000000000051',
 '20000000-0000-0000-0000-000000000001','buyin','in',1000,1000);
SQL
then echo 'cashier double-allocated overlay bank' >&2; exit 1; fi
wait "$first_pid"
grep -q 'multi_day_overlay_bank_already_allocated' "$second_log"
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.multi_day_overlay_funding_v1 WHERE bank_transaction_id='ba000000-0000-0000-0000-000000000051'")" = 1
test "$(psql "${psql_args[@]}" -Atc "SELECT count(*) FROM public.cashier_buyin_movements WHERE bank_transaction_id='ba000000-0000-0000-0000-000000000051'")" = 0
echo 'multiday_overlay_bank_race_v1 PASS'
