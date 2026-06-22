-- EMERGENCY ROLLBACK — get_dealer_availability_requests (migration 20261021000000)
--
-- Additive: one NEW read-only SECURITY DEFINER function. Touches no table/policy/data.
-- The Shift Planner calls it with a graceful fallback to the direct table read, so dropping it
-- cannot break the planner (it just reverts to the prior RLS-limited behavior).

DROP FUNCTION IF EXISTS public.get_dealer_availability_requests(uuid[], date);
