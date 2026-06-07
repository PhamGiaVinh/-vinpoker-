-- PR #1 Hotfix v1+v2: Fix notify_dealer_ready_v2 trigger auth header
-- The original trigger relied on GUC app.function_secret which is not set
-- in this DB, so the Authorization header was NOT being sent.
-- EF was returning 401 Unauthorized on every NOTIFY call.
--
-- Fix: Use hardcoded anon key as fallback (same JWT other crons use).
-- The anon key is a valid JWT; EF's verify_jwt accepts it.
-- First attempt had a typo (dropped K) - corrected in v2.

CREATE OR REPLACE FUNCTION public.notify_dealer_ready_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_should_notify BOOLEAN := FALSE;
  v_supabase_url TEXT;
  v_function_secret TEXT;
  v_idempotency_key TEXT;
  v_request_id BIGINT;
  v_auth_header TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.current_state = 'available' THEN
    v_should_notify := TRUE;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.current_state IS DISTINCT FROM 'available'
    AND NEW.current_state = 'available' THEN
    v_should_notify := TRUE;
  END IF;

  IF NOT v_should_notify THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_supabase_url := current_setting('app.supabase_url', TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_supabase_url := NULL;
  END;

  BEGIN
    v_function_secret := current_setting('app.function_secret', TRUE);
  EXCEPTION WHEN OTHERS THEN
    v_function_secret := NULL;
  END;

  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    v_supabase_url := 'https://orlesggcjamwuknxwcpk.supabase.co';
  END IF;

  IF v_function_secret IS NOT NULL AND v_function_secret != '' THEN
    v_auth_header := 'Bearer ' || v_function_secret;
  ELSE
    v_auth_header := 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ybGVzZ2djamFtd3Vrbnh3Y3BrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5NTIwMjIsImV4cCI6MjA5NDUyODAyMn0.gz_aeoSFLP6tHzdXbFwFM6xK1Wk32JOfz9ugM_BC91A';
  END IF;

  v_idempotency_key := 'notify-' || NEW.id::TEXT || '-' || NEW.xmin::TEXT;

  BEGIN
    v_request_id := net.http_post(
      url := v_supabase_url || '/functions/v1/process-swing-on-dealer-ready',
      body := jsonb_build_object(
        'club_id', (
          SELECT d.club_id FROM public.dealers d
          INNER JOIN public.dealer_attendance da ON da.dealer_id = d.id
          WHERE da.id = NEW.id
          LIMIT 1
        ),
        'attendance_id', NEW.id,
        'dealer_id', NEW.dealer_id,
        'current_state', NEW.current_state,
        'xmin', NEW.xmin::TEXT,
        'fired_at', now()
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', v_auth_header,
        'X-Idempotency-Key', v_idempotency_key
      ),
      timeout_milliseconds := 5000
    );

    RAISE LOG 'notify_dealer_ready_v2: fired for attendance_id=%, xmin=%, request_id=%',
      NEW.id, NEW.xmin, v_request_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_dealer_ready_v2: http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
