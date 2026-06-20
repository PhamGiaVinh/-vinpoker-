-- EMERGENCY ROLLBACK — C2 get_dealer_swing_health (migration 20261008000000)
--
-- 20261008000000 only CREATEs a NEW read-only function (get_dealer_swing_health(uuid[])); it
-- touches no existing object, no table, no data. Pre-apply state: the function did not exist.
-- Rollback = drop it. The frontend hook (useDealerSwingHealth) degrades gracefully when the RPC
-- is absent (the infra-health strip simply hides), so dropping it cannot break the console.

DROP FUNCTION IF EXISTS public.get_dealer_swing_health(uuid[]);
