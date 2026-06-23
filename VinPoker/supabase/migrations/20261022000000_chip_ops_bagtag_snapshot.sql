-- Chip Ops — Phase 2D.1: locked Bag & Tag day shows the STORED day_close snapshot (not a live recompute).
-- DEPENDS ON 2D (20261021000000). SOURCE-ONLY. Apply in a controlled session (Supabase SQL Editor).
--
-- WHY (strict-review P0-5): get_bag_tag_state recomputed reconciliation LIVE for every day. For a LOCKED day
-- that is wrong in principle — the locked day is a historical record; if a player's active-seat chip_count
-- changes afterwards (next-day play, a correction), reopening/viewing the locked day would show drifted live
-- numbers instead of what was signed off. day_close already PERSISTS the snapshot
-- (expected_total_value / counted_total_value / variance_by_player / all_zero), so a locked day must read those.
--
-- Single object: CREATE OR REPLACE get_bag_tag_state. Open days keep the live reconcile (unchanged). No schema,
-- no UI change (the UI already keys off reconciliation.*). Idempotent.

CREATE OR REPLACE FUNCTION public.get_bag_tag_state(p_tournament_id uuid, p_day_number integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club    uuid;
  v_recon   jsonb; v_texp bigint; v_tcnt bigint; v_allzero boolean; v_snapshot boolean := false;
  v_day     jsonb; v_bags jsonb; v_players jsonb; v_days jsonb;
  v_dc      public.day_close%ROWTYPE;
  v_has_dc  boolean;
BEGIN
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF v_uid IS NULL OR NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT * INTO v_dc FROM public.day_close WHERE tournament_id = p_tournament_id AND day_number = p_day_number;
  v_has_dc := FOUND;

  IF v_has_dc AND v_dc.status = 'locked' THEN
    -- SNAPSHOT path: the locked day is a record — return exactly what was stored at lock time.
    v_snapshot := true;
    v_texp     := v_dc.expected_total_value;
    v_tcnt     := v_dc.counted_total_value;
    v_allzero  := v_dc.all_zero;
    v_recon    := v_dc.variance_by_player;   -- stored per-player {player_id,player_name,expected,counted,variance}
  ELSE
    -- LIVE path (open day): recompute per-player reconciliation from current state.
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object('player_id',player_id,'player_name',player_name,'table_name',table_name,
        'seat_number',seat_number,'expected',expected,'counted',counted,'variance',variance,'sealed',sealed,'bag_code',bag_code)
        ORDER BY table_name NULLS LAST, seat_number NULLS LAST),'[]'),
      COALESCE(SUM(expected),0)::bigint, COALESCE(SUM(counted),0)::bigint, COALESCE(bool_and(variance=0),true)
    INTO v_recon, v_texp, v_tcnt, v_allzero
    FROM public.chip_ops_day_reconcile(p_tournament_id, p_day_number);
  END IF;

  IF v_has_dc THEN
    v_day := jsonb_build_object('status',v_dc.status,'version',v_dc.version,'signed_off',v_dc.signed_off,
      'signoff_reason',v_dc.signoff_reason,'locked_at',v_dc.locked_at);
  ELSE
    v_day := jsonb_build_object('status','open','version',0,'signed_off',false);
  END IF;

  -- bags + active players + day list are always live (bags are immutable once sealed; the active-seat list is
  -- just "who is at the table now" for the entry UI on an OPEN day).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',b.id,'player_id',b.player_id,'player_name',b.player_name,
    'table_id',b.table_id,'seat_number',b.seat_number,'bag_code',b.bag_code,'stack_value',b.stack_value,
    'total_value',b.total_value,'sealed',b.sealed) ORDER BY b.seat_number NULLS LAST),'[]'::jsonb)
  INTO v_bags FROM public.chip_bag b WHERE b.tournament_id = p_tournament_id AND b.day_number = p_day_number;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id',s.player_id,'player_name',s.player_name,'table_id',s.table_id,
    'table_name',gt.table_name,'seat_number',s.seat_number,'chip_count',s.chip_count)
    ORDER BY gt.table_name NULLS LAST, s.seat_number NULLS LAST),'[]'::jsonb)
  INTO v_players FROM public.tournament_seats s
  LEFT JOIN public.game_tables gt ON gt.id = s.table_id
  WHERE s.tournament_id = p_tournament_id AND s.is_active = true;

  SELECT COALESCE(jsonb_agg(d ORDER BY d),'[]'::jsonb) INTO v_days
  FROM (SELECT DISTINCT day_number AS d FROM (
          SELECT day_number FROM public.day_close WHERE tournament_id = p_tournament_id
          UNION SELECT day_number FROM public.chip_bag WHERE tournament_id = p_tournament_id
        ) u) q;

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id, 'day_number', p_day_number, 'day', v_day,
    'reconciliation', jsonb_build_object('players', v_recon, 'total_expected_value', v_texp,
      'total_counted_value', v_tcnt, 'total_variance_value', (v_tcnt - v_texp), 'all_zero', v_allzero,
      'snapshot', v_snapshot),
    'bags', v_bags, 'players', v_players, 'days', v_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_bag_tag_state(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_bag_tag_state(uuid,integer) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 1a+1b+2B+2C+2D+this; BEGIN; … ROLLBACK).
--   BEGIN;
--     -- bag every remaining player == stack, seal, close day 1 (locked, snapshot stored):
--     SELECT public.chip_ops_close_day('<t>',1,0);
--     -- now mutate a seat (simulate next-day change):
--     UPDATE public.tournament_seats SET chip_count = chip_count + 999 WHERE tournament_id='<t>' AND is_active;
--     -- locked day STILL shows the stored snapshot (unchanged), with reconciliation.snapshot=true:
--     SELECT public.get_bag_tag_state('<t>',1);   -- EXPECT total_expected_value unchanged, snapshot=true
--     -- an OPEN day reflects the live change:
--     SELECT public.get_bag_tag_state('<t>',2);   -- EXPECT live numbers, snapshot=false
--   ROLLBACK;
-- ===========================================================================================
--
-- ROLLBACK (undo 2D.1 → restore the 2D live-recompute body):
--   Re-apply the get_bag_tag_state definition from 20261021000000_chip_ops_bag_tag.sql.
-- ===========================================================================================
