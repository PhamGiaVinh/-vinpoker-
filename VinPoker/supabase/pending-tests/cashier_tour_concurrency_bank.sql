\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE service_role;
SELECT coalesce((public.cashier_record_verified_bank_v1(
  'b5000000-0000-4000-8000-000000000001',true)->>'handled')::boolean,false);
SELECT pg_sleep(:hold_seconds);
COMMIT;
