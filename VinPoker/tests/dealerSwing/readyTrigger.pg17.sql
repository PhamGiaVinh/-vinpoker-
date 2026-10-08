BEGIN;
CREATE TRIGGER trg_notify_dealer_ready_v2 AFTER INSERT OR UPDATE OF current_state
  ON public.dealer_attendance FOR EACH ROW EXECUTE FUNCTION public.notify_dealer_ready_v2();
DO $test$
DECLARE v_club uuid:='00000000-0000-4000-8000-000000000001';
  v_dealer uuid:='00000000-0000-4000-8000-000000000002';
  v_attendance uuid:='00000000-0000-4000-8000-000000000003'; v_count bigint;
BEGIN
  IF has_function_privilege('anon','public.notify_dealer_ready_v2()','EXECUTE')
    OR has_function_privilege('authenticated','public.notify_dealer_ready_v2()','EXECUTE')
    OR has_function_privilege('service_role','public.notify_dealer_ready_v2()','EXECUTE') THEN
    RAISE EXCEPTION 'trigger exposed directly'; END IF;
  INSERT INTO public.dealers VALUES(v_dealer,v_club);
  INSERT INTO public.club_settings VALUES(v_club,false);
  INSERT INTO public.dealer_attendance VALUES(v_attendance,v_dealer,'available','checked_in',NULL);
  IF EXISTS(SELECT 1 FROM net.test_requests) THEN RAISE EXCEPTION 'OFF enqueued'; END IF;
  UPDATE public.club_settings SET auto_swing_enabled=true WHERE club_id=v_club;
  UPDATE public.dealer_attendance SET current_state='available' WHERE id=v_attendance;
  IF EXISTS(SELECT 1 FROM net.test_requests) THEN RAISE EXCEPTION 'unchanged available enqueued'; END IF;
  UPDATE public.dealer_attendance SET current_state='on_break' WHERE id=v_attendance;
  UPDATE public.dealer_attendance SET current_state='available' WHERE id=v_attendance;
  IF EXISTS(SELECT 1 FROM net.test_requests) THEN RAISE EXCEPTION 'missing secret enqueued'; END IF;
  INSERT INTO vault.decrypted_secrets VALUES('PROCESS_SWING_INTERNAL_SECRET','local-only-fixture');
  PERFORM set_config('app.supabase_url','https://attacker.invalid',true);
  UPDATE public.dealer_attendance SET current_state='on_break' WHERE id=v_attendance;
  UPDATE public.dealer_attendance SET current_state='available' WHERE id=v_attendance;
  IF (SELECT count(*) FROM net.test_requests)<>1 OR NOT EXISTS(SELECT 1 FROM net.test_requests
    WHERE url='https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/process-swing-on-dealer-ready'
      AND headers->>'Authorization'='Bearer local-only-fixture'
      AND headers->>'X-Idempotency-Key'='notify-'||v_attendance::text||'-'||pg_current_xact_id()::text
      AND body->>'club_id'=v_club::text AND body->>'attendance_id'=v_attendance::text) THEN
    RAISE EXCEPTION 'private transition caller mismatch'; END IF;
  UPDATE public.dealer_attendance SET current_state='on_break',status='checked_out',check_out_time=now() WHERE id=v_attendance;
  UPDATE public.dealer_attendance SET current_state='available' WHERE id=v_attendance;
  IF (SELECT count(*) FROM net.test_requests)<>1 THEN RAISE EXCEPTION 'checked-out enqueued'; END IF;
  INSERT INTO public.dealer_attendance VALUES('00000000-0000-4000-8000-000000000004',v_dealer,'available','checked_in',NULL);
  IF (SELECT count(*) FROM net.test_requests)<>2 THEN RAISE EXCEPTION 'available insert not enqueued'; END IF;
  PERFORM set_config('test.enqueue_failure','on',true);
  INSERT INTO public.dealer_attendance VALUES('00000000-0000-4000-8000-000000000005',v_dealer,'available','checked_in',NULL);
  IF NOT EXISTS(SELECT 1 FROM public.dealer_attendance WHERE id='00000000-0000-4000-8000-000000000005')
    OR (SELECT count(*) FROM net.test_requests)<>2 THEN RAISE EXCEPTION 'enqueue failure broke check-in'; END IF;
END;
$test$;
ROLLBACK;
