-- P0 emergency containment for internal database-trigger dispatch only.
-- Required Vault names are provisioned outside source control before this migration is applied:
--   VINPOKER_SUPABASE_URL, VINPOKER_EDGE_PUBLISHABLE_KEY, DEALER_TRIGGER_INTERNAL_SECRET

CREATE OR REPLACE FUNCTION public.notify_dealer_ready_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_should_notify boolean := false;
  v_supabase_url text;
  v_publishable_key text;
  v_internal_secret text;
  v_club_id uuid;
  v_idempotency_key text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.current_state = 'available' THEN
    v_should_notify := true;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.current_state IS DISTINCT FROM 'available'
    AND NEW.current_state = 'available' THEN
    v_should_notify := true;
  END IF;

  IF NOT v_should_notify THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO v_supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'VINPOKER_SUPABASE_URL'
  LIMIT 1;

  SELECT decrypted_secret INTO v_publishable_key
  FROM vault.decrypted_secrets
  WHERE name = 'VINPOKER_EDGE_PUBLISHABLE_KEY'
  LIMIT 1;

  SELECT decrypted_secret INTO v_internal_secret
  FROM vault.decrypted_secrets
  WHERE name = 'DEALER_TRIGGER_INTERNAL_SECRET'
  LIMIT 1;

  IF COALESCE(v_supabase_url, '') = ''
    OR COALESCE(v_publishable_key, '') = ''
    OR COALESCE(v_internal_secret, '') = '' THEN
    RAISE WARNING 'notify_dealer_ready_v2 blocked: required Vault secret unavailable';
    RETURN NEW;
  END IF;

  SELECT d.club_id INTO v_club_id
  FROM public.dealers d
  JOIN public.dealer_attendance da ON da.dealer_id = d.id
  WHERE da.id = NEW.id
  LIMIT 1;

  IF v_club_id IS NULL THEN
    RAISE WARNING 'notify_dealer_ready_v2 blocked: attendance club is unavailable';
    RETURN NEW;
  END IF;

  v_idempotency_key := 'dealer-ready:' || NEW.id::text || ':' || NEW.xmin::text;

  BEGIN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/process-swing-on-dealer-ready',
      body := jsonb_build_object(
        'club_id', v_club_id,
        'attendance_id', NEW.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', v_publishable_key,
        'x-vinpoker-internal-secret', v_internal_secret,
        'X-Idempotency-Key', v_idempotency_key
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify_dealer_ready_v2 dispatch failed';
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_supabase_url text;
  v_publishable_key text;
  v_internal_secret text;
  v_url text;
  v_idempotency_key text;
BEGIN
  SELECT decrypted_secret INTO v_supabase_url
  FROM vault.decrypted_secrets
  WHERE name = 'VINPOKER_SUPABASE_URL'
  LIMIT 1;

  SELECT decrypted_secret INTO v_publishable_key
  FROM vault.decrypted_secrets
  WHERE name = 'VINPOKER_EDGE_PUBLISHABLE_KEY'
  LIMIT 1;

  SELECT decrypted_secret INTO v_internal_secret
  FROM vault.decrypted_secrets
  WHERE name = 'DEALER_TRIGGER_INTERNAL_SECRET'
  LIMIT 1;

  IF COALESCE(v_supabase_url, '') = ''
    OR COALESCE(v_publishable_key, '') = ''
    OR COALESCE(v_internal_secret, '') = '' THEN
    RAISE WARNING 'fn_dispatch_push blocked: required Vault secret unavailable';
    RETURN NEW;
  END IF;

  v_url := CASE NEW.type
    WHEN 'schedule_updated' THEN '/tournaments'
    WHEN 'registration_confirmed' THEN '/tournaments'
    WHEN 'chat_message' THEN '/chat/groups/' || COALESCE(NEW.data->>'group_id', '')
    ELSE COALESCE(NEW.data->>'url', '/')
  END;
  v_idempotency_key := 'push:' || NEW.id::text || ':' || NEW.xmin::text;

  BEGIN
    PERFORM net.http_post(
      url := v_supabase_url || '/functions/v1/send-push-notification',
      body := jsonb_build_object(
        'user_id', NEW.user_id::text,
        'heading', NEW.title,
        'message', NEW.body,
        'url', v_url
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', v_publishable_key,
        'x-vinpoker-internal-secret', v_internal_secret,
        'X-Idempotency-Key', v_idempotency_key
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_dispatch_push dispatch failed';
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_dealer_ready_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_dealer_ready_v2() FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_dealer_ready_v2() TO postgres;

REVOKE ALL ON FUNCTION public.fn_dispatch_push() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_dispatch_push() FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_dispatch_push() TO postgres;

COMMENT ON FUNCTION public.notify_dealer_ready_v2() IS
  'P0 containment: Vault-backed internal trigger dispatch with no credential fallback.';
COMMENT ON FUNCTION public.fn_dispatch_push() IS
  'P0 containment: Vault-backed internal push dispatch with no credential fallback.';
