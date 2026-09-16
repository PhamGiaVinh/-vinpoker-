-- One synthetic app registration per invocation; CI runs 100 in parallel.
-- This is disposable PostgreSQL only, never Supabase production.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.cashier_create_app_registration_v1(
  'b3000000-0000-4000-8000-000000000001',
  ('b1000000-0000-4000-8000-'||lpad((1000+(:'customer')::integer)::text,12,'0'))::uuid);
COMMIT;
