-- Activate the private bounded retry introduced by exact49. No Dealer Auto,
-- notification, payroll or hand-history backfill activation.
-- Rollback: cron.unschedule the exact job after checking command/username;
-- retain request/cursor/audit data and migration receipts.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $schedule$
DECLARE job_id bigint;
  job_name constant text:='floor-mode-request-retry-v1';
  job_command constant text:='SET lock_timeout=''2s''; SET statement_timeout=''20s''; SELECT floor_private.resolve_pending_table_modes_v1(50);';
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron')
    OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'floor50_pg_cron_required';
  END IF;
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'floor50_postgres_scheduler_owner_required'; END IF;
  IF to_regprocedure('floor_private.resolve_pending_table_modes_v1(integer)') IS NULL
    OR to_regprocedure('floor_private.resolve_table_mode_request_v1(uuid)') IS NULL THEN
    RAISE EXCEPTION 'floor50_exact49_required';
  END IF;
  IF md5(replace(pg_get_functiondef('floor_private.resolve_pending_table_modes_v1(integer)'::regprocedure),chr(13),''))<>'6437645f03d75d2ab9ec1eec1632ecef'
    OR md5(replace(pg_get_functiondef('floor_private.resolve_table_mode_request_v1(uuid)'::regprocedure),chr(13),''))<>'a19c384b03b7f3256af25985125f1841' THEN
    RAISE EXCEPTION 'floor50_worker_definition_drift';
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname=job_name) THEN
    RAISE EXCEPTION 'floor50_job_exists_stop';
  END IF;
  job_id:=cron.schedule(job_name,'* * * * *',job_command);
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=job_id AND jobname=job_name
    AND command=job_command AND schedule='* * * * *' AND username='postgres'
    AND database=current_database() AND active) THEN
    RAISE EXCEPTION 'floor50_schedule_postcheck_failed';
  END IF;
END $schedule$;
COMMIT;
