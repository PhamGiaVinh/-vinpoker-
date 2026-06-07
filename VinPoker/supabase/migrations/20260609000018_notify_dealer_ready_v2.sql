-- Phase 5 PR #1 - BUG #1: NOTIFY trigger v2 for state transition
-- Detects when dealer becomes 'available' (INSERT or state transition UPDATE)
-- Uses pg_net.http_post to call process-swing-on-dealer-ready edge function
-- Idempotency: uses PostgreSQL xmin (transaction ID) as unique key

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
BEGIN
  -- ═══ Layer 1: Detect STATE TRANSITION, not just any update ═══
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

  -- ═══ Get Supabase config from GUCs (set by edge function deploy) ═══
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

  -- Fallback to project URL if GUC not set
  IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
    v_supabase_url := 'https://orlesggcjamwuknxwcpk.supabase.co';
  END IF;

  -- ═══ Layer 2: Idempotency via xmin (PostgreSQL transaction ID) ═══
  -- xmin is unique per transaction; same transaction = same xmin = dedupe
  v_idempotency_key := 'notify-' || NEW.id::TEXT || '-' || NEW.xmin::TEXT;

  -- ═══ Fire HTTP POST to edge function ═══
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
        'X-Idempotency-Key', v_idempotency_key
      ) || CASE
        WHEN v_function_secret IS NOT NULL AND v_function_secret != ''
        THEN jsonb_build_object('Authorization', 'Bearer ' || v_function_secret)
        ELSE '{}'::jsonb
      END,
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

DROP TRIGGER IF EXISTS trg_notify_dealer_ready_v2 ON public.dealer_attendance;
CREATE TRIGGER trg_notify_dealer_ready_v2
  AFTER INSERT OR UPDATE OF current_state ON public.dealer_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dealer_ready_v2();

GRANT EXECUTE ON FUNCTION public.notify_dealer_ready_v2() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.notify_dealer_ready_v2 IS
  'Phase 5 PR #1 BUG #1: NOTIFY trigger that fires on state transition to available.
   Uses pg_net.http_post to call process-swing-on-dealer-ready edge function.
   Idempotency via xmin (PostgreSQL transaction ID).';
