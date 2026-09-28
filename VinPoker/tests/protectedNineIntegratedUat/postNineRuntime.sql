\set ON_ERROR_STOP on

-- Runs only after the captured production schema and all nine protected
-- migrations have been applied to the same disposable PostgreSQL 17 database.
-- It deliberately does not recreate or replace any production function.
CREATE OR REPLACE FUNCTION public.protected_nine_uat_assert(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'protected_nine_uat_failed: %', message; END IF;
END
$fn$;

SELECT public.protected_nine_uat_assert(
  NOT has_function_privilege('anon','public.execute_pre_assigned_swing_rpc(uuid,uuid,timestamp with time zone,integer,boolean,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.execute_pre_assigned_swing_rpc(uuid,uuid,timestamp with time zone,integer,boolean,integer)','EXECUTE')
  AND has_function_privilege('authenticated','public.operator_perform_swing(uuid,uuid,uuid,integer,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.worker_perform_swing(uuid,uuid,uuid,integer,boolean,integer,integer,integer,uuid,integer)','EXECUTE'),
  'dealer_swing_entrypoint_acl'
);

SELECT public.protected_nine_uat_assert(
  has_function_privilege('anon','public.get_tv_display_state_v3(text)','EXECUTE')
  AND has_function_privilege('authenticated','public.get_tv_display_state_v3(text)','EXECUTE')
  AND has_function_privilege('authenticated','public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_tv_display_state(text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.get_tv_display_state(text)','EXECUTE')
  AND NOT has_table_privilege('authenticated','public.tv_displays','UPDATE'),
  'tv_stage_b_acl'
);

SELECT public.protected_nine_uat_assert(
  position('tournament_hands' in pg_get_functiondef('public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)'::regprocedure)) = 0
  AND position('hand_actions' in pg_get_functiondef('public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)'::regprocedure)) = 0
  AND position('tracker_voice' in pg_get_functiondef('public.save_tv_display_config_v1(uuid,uuid,text,text,text,text)'::regprocedure)) = 0,
  'tv_branding_writer_isolated_from_runtime_state'
);

SELECT public.protected_nine_uat_assert(
  has_function_privilege('service_role','public.claim_tracker_historical_display_jobs(integer)','EXECUTE')
  AND has_function_privilege('service_role','public.finish_tracker_historical_display_job(uuid,bigint,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.claim_tracker_historical_display_jobs(integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.finish_tracker_historical_display_job(uuid,bigint,uuid,text,text)','EXECUTE'),
  'history_worker_acl'
);

SELECT public.protected_nine_uat_assert(
  has_function_privilege('authenticated','public.report_tracker_wrong_hand_v1(uuid,uuid,uuid,bigint,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.report_tracker_wrong_hand_v1(uuid,uuid,uuid,bigint,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.undo_tracker_last_action_v1(uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE'),
  'tracker_correction_authority_surface'
);

SELECT public.protected_nine_uat_assert(
  has_function_privilege('authenticated','public.get_floor_tournament_table_inventory_v1(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.floor_plan_break_table_v1(uuid,bigint,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.floor_break_table_v5(uuid,bigint,uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.floor_break_table_v5(uuid,bigint,uuid,text,text)','EXECUTE'),
  'floor_v3_acl'
);

SELECT public.protected_nine_uat_assert(
  NOT has_function_privilege('anon','public._tracker_voice_assignment_context(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._tracker_voice_assignment_context(uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public._tracker_voice_assignment_context(uuid,uuid,uuid)','EXECUTE'),
  'tracker_voice_private_authority_helper'
);

DROP FUNCTION public.protected_nine_uat_assert(boolean,text);
SELECT 'PROTECTED_NINE_POST_NINE_RUNTIME_PASS' AS result;
