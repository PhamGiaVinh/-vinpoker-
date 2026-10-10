\set ON_ERROR_STOP on
-- Isolated chip integrity fixture only, after reader53.
\ir ../../supabase/migrations/20270128000055_chip_pending_cancellation_v1.sql
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE t uuid:='00000000-0000-0000-0000-000000000002';
  p jsonb:='{"tournament":"00000000-0000-0000-0000-000000000002","removed":"00000000-0000-0000-0000-000000000004","target":"00000000-0000-0000-0000-000000000005","added":1,"level":1}';
  r jsonb; terminal jsonb; n bigint; rev_payload jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.chip_inventory_ledger;
  r:=public.cancel_chip_color_up_request_v1(t,'color_up','cancel-new',p);
  terminal:=r->'result';
  ASSERT r->>'status'='committed' AND terminal->>'status'='cancelled' AND terminal->'payload'=p,'exact terminal cancellation';
  ASSERT public.chip_ops_color_up(t,(p->>'removed')::uuid,(p->>'target')::uuid,1,1,'cancel-new')=terminal,'late color-up fenced';
  ASSERT public.cancel_chip_color_up_request_v1(t,'color_up','cancel-new',p)->'result'=terminal,'cancel replay';
  ASSERT public.chip_ops_color_up(t,(p->>'removed')::uuid,(p->>'target')::uuid,2,1,'cancel-new')->>'error'='IDEMPOTENCY_CONFLICT','changed payload conflict';
  SELECT payload INTO rev_payload FROM floor_private.chip_mutation_receipts WHERE request_key='undo-first';
  r:=public.cancel_chip_color_up_request_v1(t,'reverse_color_up','cancel-reverse',rev_payload);
  ASSERT r->'result'->>'status'='cancelled','reverse cancellation';
  ASSERT public.chip_ops_reverse_color_up((rev_payload->>'operation')::uuid,'cancel-reverse')=r->'result','late reverse fenced';
  r:=public.cancel_chip_color_up_request_v1(t,'color_up','same-key',p);
  ASSERT r->>'status'='committed' AND r->'result'->>'status'='ok','already committed not cancelled';
  ASSERT (SELECT count(*) FROM public.chip_inventory_ledger)=n,'no financial ledger delta';
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
  ASSERT public.cancel_chip_color_up_request_v1(t,'color_up','cancel-new',p)->>'error'='Forbidden','outsider denied';
  ASSERT NOT has_function_privilege('anon','public.cancel_chip_color_up_request_v1(uuid,text,text,jsonb)','EXECUTE'),'anon denied';
END $$;
ROLLBACK;
\echo CHIP55_CANCEL_LATE_RETRY_COMMITTED_CONFLICT_NO_LEDGER_DELTA_PASS
