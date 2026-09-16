-- One distinct synthetic customer per invocation; CI runs 100 invocations
-- through a bounded 20-connection pool. Never run on Supabase.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT public.cashier_record_cash_buyin_v1(
  r.id,6600000,
  ('b6000000-0000-4000-8000-'||lpad((1000+(:'customer')::integer)::text,12,'0'))::uuid)
FROM public.tournament_registrations r
WHERE r.player_id=('b1000000-0000-4000-8000-'||lpad((1000+(:'customer')::integer)::text,12,'0'))::uuid;
COMMIT;
