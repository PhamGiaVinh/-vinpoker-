-- Source-catalog containment: retain the trigger contract without a fallback
-- production target or HTTP side effect. The current runtime-config migration
-- later in the catalog defines the operational implementation.

CREATE OR REPLACE FUNCTION public.notify_dealer_ready_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
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
  'Contained bootstrap trigger. Runtime-config migration owns Edge dispatch.';
