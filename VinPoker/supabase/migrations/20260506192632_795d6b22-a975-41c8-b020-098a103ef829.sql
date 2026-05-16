-- Revoke EXECUTE from anon and public on all SECURITY DEFINER functions in public schema
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
  END LOOP;
END $$;

-- Re-grant EXECUTE to authenticated only on functions actually called from the app via PostgREST/RPC
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_club_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_deal_club_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_deal_purchase_breakdown(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_compute_staking_payouts(bigint, integer, numeric) TO authenticated;