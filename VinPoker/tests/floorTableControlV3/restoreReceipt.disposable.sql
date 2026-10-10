\set ON_ERROR_STOP on
-- Isolated TEST only, after restoreBustIntegrity.disposable.sql. Never live.
\if :{?SKIP_RECEIPT52_MIGRATION}
\else
\ir ../../supabase/migrations/20270128000052_floor_restore_receipt_reconciliation_v1.sql
\endif
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE
  entry uuid:='00000000-0000-0000-0000-000000000831';
  dest uuid:='00000000-0000-0000-0000-000000000770';
  sess uuid:='00000000-0000-0000-0000-000000000670';
  rid uuid:=gen_random_uuid(); fingerprint text; canonical jsonb; response jsonb;
  revision_before bigint;
BEGIN
  SELECT revision INTO revision_before FROM public.table_sessions WHERE id=sess;
  canonical:=jsonb_build_object('ok',true,'entry_id',entry,'seat_id',gen_random_uuid(),
    'tournament_table_id',dest,'table_session_id',sess,'seat_number',3,
    'chip_count',25000,'revision',revision_before+1,'payout_applied',false);
  fingerprint:=jsonb_build_object('entry_id',entry,'to_tournament_table_id',dest,
    'to_seat_number',3,'expected_revision',revision_before,'expected_control_epoch',2,
    'expected_table_session_id',sess)::text;
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,sess);
  PERFORM public.floor_table_v3_assert(response->>'status'='unknown','missing receipt is unknown, not failed');
  PERFORM floor_private.floor_table_v3_save_receipt(auth.uid(),
    'floor_restore_busted_player_to_seat_v3',rid,fingerprint,canonical);
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,sess);
  PERFORM public.floor_table_v3_assert(response->>'status'='committed' AND response->'result'=canonical,'exact own receipt returned');
  response:=public.get_floor_restore_receipt_v1(entry,dest,4,revision_before,2,rid,sess);
  PERFORM public.floor_table_v3_assert(response->>'error'='IDEMPOTENCY_CONFLICT','changed payload rejected');
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,gen_random_uuid());
  PERFORM public.floor_table_v3_assert(response->>'error'='IDEMPOTENCY_CONFLICT','session is part of original intent');
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,NULL);
  PERFORM public.floor_table_v3_assert(response->>'error'='invalid_request','exact session required');
  UPDATE public.tournament_entries SET status='seated' WHERE id=entry;
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,sess);
  PERFORM public.floor_table_v3_assert(response->'result'=canonical,'entry no longer busted must not prevent readback');
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,sess);
  PERFORM public.floor_table_v3_assert(response->>'status'='unknown' AND NOT response ? 'result','another valid Floor cannot read first actor receipt');
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,sess);
  PERFORM public.floor_table_v3_assert(response->>'error'='actor_not_allowed','outsider cannot read other actor receipt');
  PERFORM set_config('request.jwt.claim.sub','',true);
  response:=public.get_floor_restore_receipt_v1(entry,dest,3,revision_before,2,rid,sess);
  PERFORM public.floor_table_v3_assert(response->>'error'='invalid_request','missing actor denied');
  PERFORM public.floor_table_v3_assert((SELECT revision=revision_before FROM public.table_sessions WHERE id=sess),'reader does not mutate session');
  PERFORM public.floor_table_v3_assert(
    has_function_privilege('authenticated','public.get_floor_restore_receipt_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.get_floor_restore_receipt_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.get_floor_restore_receipt_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE'),
    'reader ACL remains authenticated only');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT public.floor_table_v3_assert(
  public.get_floor_restore_receipt_v1('00000000-0000-0000-0000-000000000831',
    '00000000-0000-0000-0000-000000000770',3,1,2,gen_random_uuid(),
    '00000000-0000-0000-0000-000000000670')->>'status'='unknown',
  'actual authenticated role can call reader with private helper unavailable directly');
RESET ROLE;
ROLLBACK;
\echo RESTORE52_OWN_EXACT_RECEIPT_READONLY_PASS
