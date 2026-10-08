BEGIN;
DO $test$
DECLARE v_request bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=30 AND active
    AND schedule='* * * * *' AND command='SELECT public.run_dealer_ready_backup_cron_v1();') THEN
    RAISE EXCEPTION 'cron identity/schedule/active changed'; END IF;
  IF has_function_privilege('anon','public.run_dealer_ready_backup_cron_v1()','EXECUTE')
    OR has_function_privilege('authenticated','public.run_dealer_ready_backup_cron_v1()','EXECUTE') THEN
    RAISE EXCEPTION 'browser caller privilege'; END IF;
  v_request:=public.run_dealer_ready_backup_cron_v1();
  IF v_request IS NOT NULL
    OR EXISTS(SELECT 1 FROM net.test_requests)
    OR NOT EXISTS(SELECT 1 FROM public.dealer_ready_backup_cron_runs WHERE error_code='secret_missing') THEN
    RAISE EXCEPTION 'missing secret did not fail closed'; END IF;
  INSERT INTO vault.decrypted_secrets VALUES('PROCESS_SWING_INTERNAL_SECRET','local-only-fixture');
  PERFORM set_config('app.supabase_url','https://attacker.invalid',true);
  v_request:=public.run_dealer_ready_backup_cron_v1();
  IF NOT EXISTS(SELECT 1 FROM net.test_requests WHERE id=v_request
    AND headers->>'Authorization'='Bearer local-only-fixture'
    AND url='https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/run-dealer-ready-backup') THEN
    RAISE EXCEPTION 'wrong private caller credential'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.dealer_ready_backup_cron_runs WHERE request_id=v_request AND result_state='pending') THEN
    RAISE EXCEPTION 'enqueue claimed completion'; END IF;
  INSERT INTO net._http_response VALUES(v_request,401,false);
  PERFORM public.run_dealer_ready_backup_cron_v1();
  IF NOT EXISTS(SELECT 1 FROM public.dealer_ready_backup_cron_runs WHERE request_id=v_request
    AND result_state='failed' AND error_code='http_failed') THEN RAISE EXCEPTION '401 claimed success'; END IF;
  SELECT max(request_id) INTO v_request FROM public.dealer_ready_backup_cron_runs;
  INSERT INTO net._http_response VALUES(v_request,200,false);
  PERFORM public.run_dealer_ready_backup_cron_v1();
  IF NOT EXISTS(SELECT 1 FROM public.dealer_ready_backup_cron_runs WHERE request_id=v_request
    AND result_state='success' AND error_code IS NULL) THEN RAISE EXCEPTION '200 not observed'; END IF;
  SELECT max(request_id) INTO v_request FROM public.dealer_ready_backup_cron_runs;
  UPDATE public.dealer_ready_backup_cron_runs SET requested_at=now()-interval '3 minutes' WHERE request_id=v_request;
  PERFORM public.run_dealer_ready_backup_cron_v1();
  IF NOT EXISTS(SELECT 1 FROM public.dealer_ready_backup_cron_runs WHERE request_id=v_request
    AND error_code='timeout' AND result_state='failed') THEN RAISE EXCEPTION 'unanswered request not timed out'; END IF;
END;
$test$;
ROLLBACK;
