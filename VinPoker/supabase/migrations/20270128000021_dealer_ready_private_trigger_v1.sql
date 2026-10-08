-- Forward-only repair of the existing available-state trigger; preserve attendance/history.
-- Caller uses existing Vault PROCESS_SWING_INTERNAL_SECRET, matched by the ready Edge.
-- ROLLBACK: disable trg_notify_dealer_ready_v2 until a reviewed caller is restored;
-- the private backup cron remains the fallback. Never restore embedded anonymous JWTs.
BEGIN;
CREATE OR REPLACE FUNCTION public.notify_dealer_ready_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_club_id uuid; v_secret text; v_request_id bigint; v_key text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.current_state IS DISTINCT FROM 'available' THEN RETURN NEW; END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.current_state IS NOT DISTINCT FROM 'available'
      OR NEW.current_state IS DISTINCT FROM 'available' THEN RETURN NEW; END IF;
  ELSE RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'checked_in' OR NEW.check_out_time IS NOT NULL THEN RETURN NEW; END IF;
  SELECT d.club_id INTO v_club_id FROM public.dealers d WHERE d.id=NEW.dealer_id;
  IF v_club_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.club_settings s
    WHERE s.club_id=v_club_id AND s.auto_swing_enabled IS TRUE) THEN RETURN NEW; END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
    WHERE name='PROCESS_SWING_INTERNAL_SECRET';
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret)='' THEN
    RAISE WARNING 'DEALER_READY_TRIGGER_SECRET_MISSING'; RETURN NEW;
  END IF;
  -- Trigger row records have no xmin field. Transaction identity fences notification retries.
  v_key:='notify-'||NEW.id::text||'-'||pg_catalog.pg_current_xact_id()::text;
  BEGIN
    SELECT net.http_post(
      url:='https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/process-swing-on-dealer-ready',
      headers:=pg_catalog.jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_secret,'X-Idempotency-Key',v_key),
      body:=pg_catalog.jsonb_build_object('club_id',v_club_id,'attendance_id',NEW.id,
        'dealer_id',NEW.dealer_id,'current_state',NEW.current_state,'fired_at',pg_catalog.now()),
      timeout_milliseconds:=5000
    ) INTO v_request_id;
    IF v_request_id IS NULL THEN RAISE WARNING 'DEALER_READY_TRIGGER_ENQUEUE_FAILED'; END IF;
  EXCEPTION WHEN OTHERS THEN
    -- No SQLERRM: transport errors can contain headers or credentials.
    RAISE WARNING 'DEALER_READY_TRIGGER_ENQUEUE_FAILED';
  END;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_dealer_ready_v2() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
