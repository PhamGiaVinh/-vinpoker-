\set ON_ERROR_STOP on
-- Disposable only: run after existing restore integrity + reader52 fixtures.
\ir ../../supabase/migrations/20270128000054_restore_pending_cancellation_v1.sql
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE e uuid:='00000000-0000-0000-0000-000000000831';
  d uuid:='00000000-0000-0000-0000-000000000770';
  s uuid:='00000000-0000-0000-0000-000000000670';
  k uuid:=gen_random_uuid(); response jsonb; terminal jsonb; before_rows jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) INTO before_rows FROM public.tournament_seats x;
  response:=public.cancel_floor_restore_request_v1(e,d,3,1,2,k,s);
  terminal:=response->'result';
  PERFORM public.floor_table_v3_assert(response->>'ok'='true' AND terminal->>'status'='cancelled'
    AND terminal->>'request_id'=k::text AND terminal->>'actor_id'=auth.uid()::text,'exact cancellation proof');
  response:=floor_private.restore_busted_player_to_seat(e,d,3,1,2,k,s);
  PERFORM public.floor_table_v3_assert(response=terminal,'delayed original restore replays tombstone');
  response:=public.cancel_floor_restore_request_v1(e,d,3,1,2,k,s);
  PERFORM public.floor_table_v3_assert(response->'result'=terminal,'cancellation replay returns identical proof');
  response:=floor_private.restore_busted_player_to_seat(e,d,4,1,2,k,s);
  PERFORM public.floor_table_v3_assert(response->>'error'='IDEMPOTENCY_CONFLICT','changed payload cannot bypass cancellation');
  response:=public.cancel_floor_restore_request_v1(e,d,4,1,2,k,s);
  PERFORM public.floor_table_v3_assert(response->>'error'='IDEMPOTENCY_CONFLICT','cancel changed payload conflicts');
  PERFORM public.floor_table_v3_assert((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)=before_rows
    FROM public.tournament_seats x),'cancel and delayed retry preserve every seat');
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
  response:=public.cancel_floor_restore_request_v1(e,d,3,1,2,k,s);
  PERFORM public.floor_table_v3_assert(response->>'error'='actor_not_allowed','foreign actor denied');
  PERFORM public.floor_table_v3_assert(
    has_function_privilege('authenticated','public.cancel_floor_restore_request_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.cancel_floor_restore_request_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.cancel_floor_restore_request_v1(uuid,uuid,integer,bigint,bigint,uuid,uuid)','EXECUTE'),'cancel auth-only ACL');
END $$;
ROLLBACK;
\echo RESTORE54_CANCEL_LATE_RETRY_PAYLOAD_ACL_PASS
