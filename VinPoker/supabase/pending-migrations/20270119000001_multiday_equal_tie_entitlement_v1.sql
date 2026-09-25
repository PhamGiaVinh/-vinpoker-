-- Source only. This is internal arithmetic for a TD-confirmed elimination batch;
-- it does not identify who tied, finalize a flight, create a bag, or pay money.
-- Occupied rank amounts are passed once each (e.g. ranks 46/47 = [M,M]
-- when both adjacent places pay M). Do not collapse equal-paying ranks.
-- ROLLBACK: revoke the function in an owner-gated migration. Do not rewrite
-- finalized obligations; any correction must be an audited adjustment.

CREATE OR REPLACE FUNCTION public.multi_day_equal_tie_entitlement_v1(
  p_occupied_rank_amounts_vnd bigint[], p_tied_player_count integer
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_amount bigint;
  v_total numeric := 0;
  v_share numeric;
  v_player_total numeric;
  v_club_remainder numeric;
BEGIN
  IF p_tied_player_count IS NULL OR p_tied_player_count < 2
     OR p_tied_player_count > 500
     OR p_occupied_rank_amounts_vnd IS NULL
     OR pg_catalog.cardinality(p_occupied_rank_amounts_vnd) <> p_tied_player_count THEN
    RAISE EXCEPTION 'multiday_tie_ranks_invalid' USING ERRCODE = '22023';
  END IF;
  FOREACH v_amount IN ARRAY p_occupied_rank_amounts_vnd LOOP
    IF v_amount IS NULL OR v_amount < 0 THEN
      RAISE EXCEPTION 'multiday_tie_amount_invalid' USING ERRCODE = '22023';
    END IF;
    v_total := v_total + v_amount::numeric;
  END LOOP;
  IF v_total > 9007199254740991 THEN
    RAISE EXCEPTION 'multiday_tie_amount_overflow' USING ERRCODE = '22003';
  END IF;
  -- Owner rule: pay each tied player equally, rounded DOWN to 1,000 VND.
  -- The remaining amount is a separate club-retained line, not another
  -- player's obligation and not a silently negative/unallocated pool.
  v_share := pg_catalog.floor(v_total / (p_tied_player_count::numeric * 1000)) * 1000;
  v_player_total := v_share * p_tied_player_count::numeric;
  v_club_remainder := v_total - v_player_total;
  RETURN pg_catalog.jsonb_build_object(
    'tiedPlayerCount', p_tied_player_count,
    'occupiedRankTotalVnd', v_total::bigint::text,
    'perPlayerVnd', v_share::bigint::text,
    'totalPlayerObligationVnd', v_player_total::bigint::text,
    'clubRetainedRemainderVnd', v_club_remainder::bigint::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.multi_day_equal_tie_entitlement_v1(bigint[],integer)
  FROM PUBLIC, anon, authenticated, service_role;
