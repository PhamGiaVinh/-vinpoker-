-- Forward-only scheduler auth repair. No secret value is stored in this source or cron command.
-- Prerequisite: existing PROCESS_SWING_INTERNAL_SECRET matches Vault and Edge.
-- Deploy the matching backup Edge after this caller; keep Daybreak and policy unchanged.
-- ROLLBACK: disable only run-dealer-ready-backup through reviewed cron.alter_job(active:=false).
-- Preserve this audit and receipts. Never restore the anonymous credential or delete history.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dealer_ready_backup_cron_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint UNIQUE,
  requested_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  result_state text NOT NULL CHECK (result_state IN ('pending','success','failed')),
  response_status integer,
  observed_at timestamptz,
  error_code text CHECK (error_code IS NULL OR error_code IN (
    'secret_missing','enqueue_failed','http_failed','timeout'
  ))
);
CREATE INDEX IF NOT EXISTS dealer_ready_backup_cron_runs_requested_idx
  ON public.dealer_ready_backup_cron_runs(requested_at DESC);
ALTER TABLE public.dealer_ready_backup_cron_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealer_ready_backup_cron_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.dealer_ready_backup_cron_runs TO service_role;

CREATE OR REPLACE FUNCTION public.run_dealer_ready_backup_cron_v1()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_secret text;
  v_request_id bigint;
  v_url text;
BEGIN
  -- pg_net enqueue is not a completed job. Observe only status, never response bodies/headers.
  UPDATE public.dealer_ready_backup_cron_runs r
  SET response_status=h.status_code, observed_at=pg_catalog.now(),
      result_state=CASE WHEN NOT COALESCE(h.timed_out,false) AND h.status_code BETWEEN 200 AND 299
        THEN 'success' ELSE 'failed' END,
      error_code=CASE WHEN h.timed_out OR h.status_code IS NULL THEN 'timeout'
        WHEN h.status_code BETWEEN 200 AND 299 THEN NULL ELSE 'http_failed' END
  FROM net._http_response h WHERE h.id=r.request_id AND r.result_state='pending';
  UPDATE public.dealer_ready_backup_cron_runs
  SET result_state='failed',error_code='timeout',observed_at=pg_catalog.now()
  WHERE result_state='pending' AND requested_at < pg_catalog.now()-interval '2 minutes';

  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
  WHERE name='PROCESS_SWING_INTERNAL_SECRET';
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret)='' THEN
    INSERT INTO public.dealer_ready_backup_cron_runs(result_state,error_code)
      VALUES('failed','secret_missing');
    RETURN NULL;
  END IF;
  -- A caller-controlled GUC must never redirect a Vault credential to another host.
  v_url := 'https://orlesggcjamwuknxwcpk.supabase.co';
  BEGIN
    SELECT net.http_post(
      url:=v_url||'/functions/v1/run-dealer-ready-backup',
      headers:=pg_catalog.jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_secret),
      body:='{}'::jsonb,timeout_milliseconds:=8000
    ) INTO v_request_id;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.dealer_ready_backup_cron_runs(result_state,error_code)
      VALUES('failed','enqueue_failed');
    RETURN NULL;
  END;
  IF v_request_id IS NULL THEN
    INSERT INTO public.dealer_ready_backup_cron_runs(result_state,error_code)
      VALUES('failed','enqueue_failed');
    RETURN NULL;
  END IF;
  INSERT INTO public.dealer_ready_backup_cron_runs(request_id,result_state)
    VALUES(v_request_id,'pending');
  RETURN v_request_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.run_dealer_ready_backup_cron_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_dealer_ready_backup_cron_v1() TO service_role;

-- Update the existing single job in place: retain its identity, schedule and enabled state.
DO $migration$
DECLARE v_job_id bigint; v_count integer;
BEGIN
  SELECT count(*),min(jobid) INTO v_count,v_job_id FROM cron.job
    WHERE jobname='run-dealer-ready-backup';
  IF v_count<>1 THEN RAISE EXCEPTION 'READY_BACKUP_CRON_IDENTITY_AMBIGUOUS'; END IF;
  PERFORM cron.alter_job(job_id:=v_job_id,
    command:='SELECT public.run_dealer_ready_backup_cron_v1();');
END;
$migration$;
COMMIT;
