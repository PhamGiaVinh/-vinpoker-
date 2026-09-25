-- Disposable database only, after the pending tie-arithmetic migration.
-- No production call, no player result or money mutation.
\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_split jsonb;
BEGIN
  -- Normal payout structure: ranks 45/46/47 each pay 1m. In a 47->45
  -- boundary, two people share the occupied ranks 46/47: 2m total,
  -- 1m each. This does NOT test qualification or absence of bag #46.
  v_split := public.multi_day_equal_tie_entitlement_v1(
    ARRAY[1000000,1000000]::bigint[], 2);
  IF v_split->>'perPlayerVnd' <> '1000000'
     OR v_split->>'occupiedRankTotalVnd' <> '2000000'
     OR v_split->>'totalPlayerObligationVnd' <> '2000000'
     OR v_split->>'clubRetainedRemainderVnd' <> '0' THEN
    RAISE EXCEPTION 'two-player boundary split doubled or lost the entitlement';
  END IF;

  -- Three simultaneous busts occupy ranks 45/46/47. Their 3m total is
  -- shared once; nobody receives the entire three-rank sum alone.
  v_split := public.multi_day_equal_tie_entitlement_v1(
    ARRAY[1000000,1000000,1000000]::bigint[], 3);
  IF v_split->>'perPlayerVnd' <> '1000000'
     OR v_split->>'occupiedRankTotalVnd' <> '3000000'
     OR v_split->>'totalPlayerObligationVnd' <> '3000000'
     OR v_split->>'clubRetainedRemainderVnd' <> '0' THEN
    RAISE EXCEPTION 'three-player occupied-rank total is wrong';
  END IF;

  -- Rare edge case, not the usual adjacent equal payout structure:
  -- if the occupied rank amounts really total only 1m, then 333k each
  -- and the club retains the remaining 1k.
  v_split := public.multi_day_equal_tie_entitlement_v1(
    ARRAY[1000000,0,0]::bigint[], 3);
  IF v_split->>'perPlayerVnd' <> '333000'
     OR v_split->>'totalPlayerObligationVnd' <> '999000'
     OR v_split->>'clubRetainedRemainderVnd' <> '1000'
     OR (v_split->>'occupiedRankTotalVnd')::bigint <>
        (v_split->>'totalPlayerObligationVnd')::bigint
        + (v_split->>'clubRetainedRemainderVnd')::bigint THEN
    RAISE EXCEPTION 'three-player club remainder or conservation mismatch';
  END IF;

  v_split := public.multi_day_equal_tie_entitlement_v1(
    ARRAY[1000001,0,0]::bigint[], 3);
  IF v_split->>'perPlayerVnd' <> '333000'
     OR v_split->>'clubRetainedRemainderVnd' <> '1001' THEN
    RAISE EXCEPTION 'sub-thousand remainder was lost';
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
  IF pg_catalog.has_function_privilege('authenticated',
       'public.multi_day_equal_tie_entitlement_v1(bigint[],integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal tie function exposed to authenticated browser';
  END IF;
END $test$;

ROLLBACK;
