-- Disposable database only, after the pending tie-arithmetic migration.
-- No production call, no player result or money mutation.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_split jsonb;
BEGIN
  -- Arithmetic slice only: in a 47->45 boundary, ranks 46/47 are occupied.
  -- Only rank 46 has M = 12m; the group shares M once. This does not
  -- test qualification, batch confirmation, or the absence of bag #46.
  v_split := public.multi_day_equal_tie_entitlement_v1(
    ARRAY[12000000,0]::bigint[], 2);
  IF v_split->>'perPlayerVnd' <> '6000000'
     OR v_split->>'occupiedRankTotalVnd' <> '12000000'
     OR v_split->>'unallocatedVnd' <> '0' THEN
    RAISE EXCEPTION 'two-player boundary split doubled or lost the entitlement';
  END IF;

  v_split := public.multi_day_equal_tie_entitlement_v1(
    ARRAY[12000000,6000000,0]::bigint[], 3);
  IF v_split->>'perPlayerVnd' <> '6000000'
     OR v_split->>'occupiedRankTotalVnd' <> '18000000' THEN
    RAISE EXCEPTION 'three-player occupied-rank total is wrong';
  END IF;

  BEGIN
    PERFORM public.multi_day_equal_tie_entitlement_v1(
      ARRAY[12000000]::bigint[], 2);
    RAISE EXCEPTION 'missing occupied rank accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.multi_day_equal_tie_entitlement_v1(
      ARRAY[12000000,-1]::bigint[], 2);
    RAISE EXCEPTION 'negative entitlement accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.multi_day_equal_tie_entitlement_v1(
      ARRAY[1000000,0,0]::bigint[], 3);
    RAISE EXCEPTION 'indivisible VND was allocated without a policy';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  IF pg_catalog.has_function_privilege('authenticated',
       'public.multi_day_equal_tie_entitlement_v1(bigint[],integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal tie function exposed to authenticated browser';
  END IF;
END $test$;

ROLLBACK;
