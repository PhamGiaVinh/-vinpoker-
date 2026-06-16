-- ════════════════════════════════════════════════════════════════════════════
-- Sync tournaments.itm_places  ←  MAX(tournament_prizes.position)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️  SOURCE-ONLY — NOT APPLIED here. Live apply is OWNER-GATED (controlled
--     Management-API op). NO `supabase db push`, NO `deploy_db=true`, schema_migrations
--     untouched. See docs/tournament/ITM_SYNC_ROLLOUT.md for the controlled apply plan
--     (preflight → apply trigger → guarded backfill → leaderboard golden-diff → verify).
--
-- WHAT THIS IS: an ADDITIVE trigger that keeps `tournaments.itm_places` equal to the
-- highest paid POSITION in the Floor-Ops prize structure (`tournament_prizes`). Today
-- nothing writes itm_places (it defaults to 0 / NULL and is never synced from the prize
-- table), so the leaderboard + TV + tracker ITM/bubble logic that reads it is unreliable.
-- This trigger makes the prize structure the single source of truth for "places paid".
--
-- MAX(position) (not row count) → robust to non-contiguous positions (e.g. 1,2,4,5 → 5).
--
-- ⚠️  STRUCTURAL ONLY. Applying this trigger changes NO existing row by itself — it only
--     fires on FUTURE writes to tournament_prizes. Existing tournaments are corrected by a
--     SEPARATE, guarded backfill (docs/tournament/ITM_SYNC_ROLLOUT.md) so the data change
--     can be golden-diffed independently.
--
-- IMPACT (intended): once itm_places reflects the prize structure, get_tournament_leaderboard
-- starts flagging `is_itm` correctly, and the tracker bubble/ITM story events (#245) fire.
-- itm_places is NOT used by calculate_dealer_payroll or any payroll/finance path (verified)
-- → NO money/payroll value changes.
--
-- DOES NOT TOUCH: calculate_dealer_payroll, payroll, Dealer Swing, Cashier, Online Poker,
-- Finance, GTO, prize amounts/percentages, or any tournament_prizes row.
--
-- ROLLBACK: docs/emergency_rollbacks/PRE_ITM_SYNC_20260917000000.sql (drop the trigger +
-- function; the backfilled itm_places values are non-destructive and recomputable).
-- ════════════════════════════════════════════════════════════════════════════

-- NOTE: no explicit BEGIN/COMMIT so this file can be dry-run validated inside an outer
-- BEGIN…ROLLBACK; the owner-gated apply wraps it in one transaction.

-- ── Trigger function: recompute itm_places for the affected tournament ──────────────
-- SECURITY DEFINER + locked search_path so the itm_places update succeeds regardless of
-- the (SECURITY INVOKER) caller's direct privileges / RLS on public.tournaments.
CREATE OR REPLACE FUNCTION public.sync_tournament_itm_places()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid := COALESCE(NEW.tournament_id, OLD.tournament_id);
BEGIN
  IF v_tid IS NOT NULL THEN
    UPDATE public.tournaments t
    SET itm_places = COALESCE(
      (SELECT MAX(position) FROM public.tournament_prizes WHERE tournament_id = v_tid),
      0
    )
    WHERE t.id = v_tid
      -- avoid a no-op write (and its updated_at bump / UPDATE triggers) when unchanged
      AND COALESCE(t.itm_places, 0) IS DISTINCT FROM COALESCE(
        (SELECT MAX(position) FROM public.tournament_prizes WHERE tournament_id = v_tid),
        0
      );
  END IF;
  RETURN NULL; -- AFTER trigger → return value ignored
END;
$$;

COMMENT ON FUNCTION public.sync_tournament_itm_places() IS
  'Keeps tournaments.itm_places = MAX(tournament_prizes.position) for the affected tournament. Source of truth for "places paid" (leaderboard is_itm, TV, tracker bubble/ITM). No payroll/finance impact.';

-- ── Hardening: this is a trigger function (RETURNS trigger) — it can never be called
--    directly via SQL. Revoke the default PUBLIC EXECUTE grant anyway so this
--    SECURITY DEFINER function is not directly invokable by anon/authenticated. The
--    trigger still fires (it runs in the function-owner context via the trigger
--    mechanism, NOT via the caller's EXECUTE privilege).
REVOKE ALL ON FUNCTION public.sync_tournament_itm_places() FROM PUBLIC;

-- ── Trigger: fire on every write path to the prize structure ─────────────────────────
DROP TRIGGER IF EXISTS trg_sync_tournament_itm_places ON public.tournament_prizes;
CREATE TRIGGER trg_sync_tournament_itm_places
  AFTER INSERT OR UPDATE OR DELETE ON public.tournament_prizes
  FOR EACH ROW EXECUTE FUNCTION public.sync_tournament_itm_places();
