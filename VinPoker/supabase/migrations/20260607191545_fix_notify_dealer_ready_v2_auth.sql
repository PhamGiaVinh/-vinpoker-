-- Source-catalog containment: preserve the trigger function signature without
-- a hard-coded target or credential. A later runtime-config containment
-- migration installs the production-capable implementation.

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
