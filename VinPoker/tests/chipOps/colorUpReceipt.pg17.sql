\set ON_ERROR_STOP on
-- Run after colorUpIntegrity.pg17.test.mjs, ONLY in its isolated fixture DB.
\if :{?SKIP_RECEIPT53_MIGRATION}
\else
\ir ../../supabase/migrations/20270128000053_chip_color_up_receipt_reconciliation_v1.sql
\endif
BEGIN;
CREATE OR REPLACE FUNCTION public.is_club_chip_master(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT $1='00000000-0000-0000-0000-000000000007'::uuid AND $2='00000000-0000-0000-0000-000000000003'::uuid
$$;
DO $$
DECLARE tour uuid:='00000000-0000-0000-0000-000000000002';
 payload jsonb:='{"tournament":"00000000-0000-0000-0000-000000000002","removed":"00000000-0000-0000-0000-000000000004","target":"00000000-0000-0000-0000-000000000005","added":1,"level":1}';
 actual jsonb; expected jsonb; reverse_payload jsonb; count_before bigint;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 SELECT count(*) INTO count_before FROM public.chip_inventory_ledger;
 SELECT result INTO expected FROM floor_private.chip_mutation_receipts WHERE request_key='same-key';
 actual:=public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload);
 ASSERT actual->>'status'='committed' AND actual->'result'=expected,'own exact stored proof';
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','absent',payload)->>'status')='unknown','absence is unknown';
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload||'{"added":2}'::jsonb)->>'error')='IDEMPOTENCY_CONFLICT','changed payload conflict';
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload||'{"extra":1}'::jsonb)->>'error')='INVALID_INPUT','extra field invalid';
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload||'{"removed":"bad"}'::jsonb)->>'error')='INVALID_INPUT','bad UUID safe error';
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload||'{"added":-1}'::jsonb)->>'error')='INVALID_INPUT','negative invalid';
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload-'level')->>'error')='INVALID_INPUT','nullable level must be present';
 SELECT r.payload INTO reverse_payload FROM floor_private.chip_mutation_receipts r WHERE r.request_key='undo-first';
 SELECT result INTO expected FROM floor_private.chip_mutation_receipts WHERE request_key='undo-first';
 actual:=public.get_chip_color_up_receipt_v1(tour,'reverse_color_up','undo-first',reverse_payload);
 ASSERT actual->>'status'='committed' AND actual->'result'=expected,'reverse exact receipt';
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'reverse_color_up','same-key',reverse_payload)->>'error')='IDEMPOTENCY_CONFLICT','cross operation key conflict';
 INSERT INTO public.tournaments VALUES('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000003',1,null);
 ASSERT (public.get_chip_color_up_receipt_v1('00000000-0000-0000-0000-000000000008','reverse_color_up','undo-first',reverse_payload)->>'error')='OPERATION_NOT_FOUND','reverse exact tournament';
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',true);
 actual:=public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload);
 ASSERT actual->>'status'='unknown' AND NOT actual?'result','authorized other actor cannot read owner receipt';
 PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload)->>'error')='Forbidden','outsider denied';
 PERFORM set_config('request.jwt.claim.sub','',true);
 ASSERT (public.get_chip_color_up_receipt_v1(tour,'color_up','same-key',payload)->>'error')='Unauthorized','no actor denied';
 ASSERT (SELECT count(*) FROM public.chip_inventory_ledger)=count_before,'reader no ledger delta';
 ASSERT has_function_privilege('authenticated','public.get_chip_color_up_receipt_v1(uuid,text,text,jsonb)','EXECUTE'),'auth ACL';
 ASSERT NOT has_function_privilege('anon','public.get_chip_color_up_receipt_v1(uuid,text,text,jsonb)','EXECUTE'),'anon denied';
 ASSERT NOT has_function_privilege('service_role','public.get_chip_color_up_receipt_v1(uuid,text,text,jsonb)','EXECUTE'),'service denied';
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 ASSERT (public.get_chip_color_up_receipt_v1('00000000-0000-0000-0000-000000000002','color_up','same-key',
 '{"tournament":"00000000-0000-0000-0000-000000000002","removed":"00000000-0000-0000-0000-000000000004","target":"00000000-0000-0000-0000-000000000005","added":1,"level":1}')->>'status')='committed','actual authenticated role';
END $$;
RESET ROLE;
ROLLBACK;
\echo CHIP53_OWN_EXACT_RECEIPT_READONLY_PASS
