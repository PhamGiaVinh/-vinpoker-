-- Player History — Phase 1 follow-up: wire finalize_tournament_results into the real flow.
-- WHY: Phase 1 (20261208/09/10) built bust_order capture + finalize_tournament_results +
-- get_member_history, but NOTHING in the app ever called finalize — so "out 9th: 5.5M" would
-- never actually be recorded no matter how many tournaments ran. This migration closes that gap
-- with TWO hooks:
--
--   (A) THE RELIABLE FIX — auto-finalize the moment the field naturally narrows to 1 survivor.
--       apply_payout_run is NOT a safe single hook point: is_tournament_registration_closed()
--       (its own gate) is true once EITHER registration_closed_at is set OR live_status='finished' —
--       and registration typically closes hours before the tournament's last hand, while
--       live_status='finished' is a manually-edited TD field that 0 live tournaments currently have
--       set. So a payout apply is usually NOT the moment there is exactly one winner. The one event
--       that is ALWAYS guaranteed to fire exactly when the field narrows to 1 is the bust of the
--       second-to-last player — captured via a NEW AFTER UPDATE trigger (separate from the BEFORE
--       UPDATE trg_capture_bust_order, so it only fires once bust_order is already committed and
--       visible to finalize_tournament_results' own SELECT queries).
--   (B) WHAT WAS EXPLICITLY REQUESTED — a best-effort, non-blocking call to
--       finalize_tournament_results from inside apply_payout_run too, as a safety-net re-sync (e.g.
--       if a payout gets corrected/regenerated after the tournament already ended). This NEVER blocks
--       or alters the payout money-flow itself — apply_payout_run's own logic is untouched apart from
--       this one additive, exception-swallowed call placed after the transaction's real work is done.
--
-- Both hooks are best-effort (wrapped in their own BEGIN..EXCEPTION), gated on the per-club
-- player_history_enabled flag, and reuse the EXISTING finalize_tournament_results guards
-- (tournament_not_finished / no_bust_order_captured) unchanged — this migration adds callers, it
-- does not change finalize's own logic at all.
-- Depends on: M1/M2/M3 (20261208/09/10, applied live). SOURCE-ONLY — owner-gated controlled apply.

-- (A) Auto-finalize trigger — fires AFTER a bust is committed, checks if exactly one player remains.
CREATE OR REPLACE FUNCTION public.auto_finalize_on_last_bust()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_club      uuid;
  v_enabled   boolean;
  v_survivors integer;
BEGIN
  IF NEW.status <> 'busted' OR COALESCE(OLD.status, '') = 'busted' THEN
    RETURN NEW;
  END IF;
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = NEW.tournament_id;
  IF v_club IS NULL THEN RETURN NEW; END IF;
  SELECT player_history_enabled INTO v_enabled FROM public.club_settings WHERE club_id = v_club;
  IF NOT COALESCE(v_enabled, false) THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_survivors FROM public.tournament_entries
    WHERE tournament_id = NEW.tournament_id AND COALESCE(status, '') <> 'busted';
  IF v_survivors <= 1 THEN
    BEGIN
      PERFORM public.finalize_tournament_results(NEW.tournament_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.player_history_link_errors (club_id, context, detail)
      VALUES (v_club, 'auto_finalize_on_last_bust', left(SQLERRM, 500));
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_finalize_on_last_bust ON public.tournament_entries;
CREATE TRIGGER trg_auto_finalize_on_last_bust
  AFTER UPDATE ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.auto_finalize_on_last_bust();


-- (B) apply_payout_run — same signature as live (post-20261127), body byte-identical except the ONE
-- additive best-effort block inserted right after the payout run is marked 'applied' and before RETURN.
CREATE OR REPLACE FUNCTION public.apply_payout_run(
  p_run_id         uuid,
  p_rows           jsonb,
  p_prize_pool     bigint,
  p_itm_places     integer,
  p_effective_floor bigint,
  p_warnings       jsonb DEFAULT '[]'::jsonb,
  p_engine_version text  DEFAULT NULL,
  p_alpha_version  text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_run        public.tournament_payout_runs%ROWTYPE;
  v_t          public.tournaments%ROWTYPE;
  v_count      integer;
  v_sum        numeric;
  v_contig     boolean;
  v_nonneg     boolean;
  v_monotone   boolean;
  v_last       numeric;
  v_max        numeric;
  v_pool_below boolean := (p_warnings @> '["POOL_BELOW_MIN_CASH"]'::jsonb);
  v_is_custom  boolean := false;
  v_is_banded  boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_run FROM public.tournament_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RUN_NOT_FOUND'; END IF;
  IF v_run.status <> 'draft_snapshot' THEN RAISE EXCEPTION 'RUN_NOT_DRAFT'; END IF;
  -- Defense-in-depth (audit finding, non-blocking but cheap): p_itm_places is REQUIRED (no DEFAULT)
  -- and the sole real caller (compute-payouts Edge) always supplies it, but fail LOUDLY rather than
  -- silently disabling the LAST_NOT_FLOOR bypass (NULL > 9 → NULL → treated as false) if some future
  -- caller ever omits it.
  IF p_itm_places IS NULL THEN RAISE EXCEPTION 'ITM_PLACES_REQUIRED'; END IF;
  v_is_custom := (v_run.archetype = 'CUSTOM');
  -- WIDENED (was: archetype = 'LIVE_STANDARD' only): ranks 10+ now band by default for EVERY
  -- archetype (engine v1.1), so the LAST_NOT_FLOOR bypass below must key on "did banding actually
  -- apply" (p_itm_places > 9), not on the archetype label. p_itm_places is the fresh call
  -- parameter — v_run.itm_places (the column) is NULL until the UPDATE at the end of this
  -- function, so it cannot be used here.
  v_is_banded := (v_run.archetype = 'LIVE_STANDARD') OR (p_itm_places > 9);

  SELECT * INTO v_t FROM public.tournaments WHERE id = v_run.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND'; END IF;

  IF NOT (public.is_club_owner(v_uid, v_t.club_id)
       OR public.is_club_admin(v_uid, v_t.club_id)
       OR public.is_club_cashier(v_uid, v_t.club_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT public.is_tournament_registration_closed(v_run.tournament_id) THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_CLOSED';
  END IF;

  -- snapshot binding (CUSTOM bypasses floor=0; banded runs keep the real min-cash floor → FLOOR_MISMATCH enforced)
  IF p_prize_pool <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'POOL_MISMATCH'; END IF;
  IF p_effective_floor < 0 OR p_effective_floor > v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'FLOOR_RANGE'; END IF;
  IF NOT v_is_custom AND NOT v_pool_below AND p_effective_floor <> v_run.effective_floor THEN RAISE EXCEPTION 'FLOOR_MISMATCH'; END IF;

  -- structural validation of p_rows — applies to ALL archetypes (contiguous, Σ=pool, non-increasing)
  WITH r AS (
    SELECT (e.value->>'position')::int AS position, (e.value->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_rows) e
  ), ord AS (
    SELECT position, amount,
           row_number() OVER (ORDER BY position) AS rn,
           lag(amount)  OVER (ORDER BY position) AS prev_amt
    FROM r
  )
  SELECT count(*),
         COALESCE(sum(amount), 0),
         COALESCE(max(amount), 0),
         COALESCE(bool_and(position = rn), true),
         COALESCE(bool_and(amount >= 0), true),
         COALESCE(bool_and(prev_amt IS NULL OR amount <= prev_amt), true),
         (SELECT amount FROM ord WHERE rn = (SELECT max(rn) FROM ord))
    INTO v_count, v_sum, v_max, v_contig, v_nonneg, v_monotone, v_last
  FROM ord;

  IF v_count < 1                       THEN RAISE EXCEPTION 'EMPTY_ROWS'; END IF;
  IF v_count <> p_itm_places           THEN RAISE EXCEPTION 'ITM_PLACES_MISMATCH'; END IF;
  IF NOT v_contig                      THEN RAISE EXCEPTION 'POSITION_GAP_OR_DUP'; END IF;
  IF NOT v_nonneg                      THEN RAISE EXCEPTION 'NEGATIVE_AMOUNT'; END IF;
  IF NOT v_monotone                    THEN RAISE EXCEPTION 'NOT_MONOTONE'; END IF;
  IF v_sum <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'SUM_MISMATCH'; END IF;
  IF v_max > 9999999999.99             THEN RAISE EXCEPTION 'PAYOUT_AMOUNT_EXCEEDS_COLUMN_LIMIT'; END IF;
  -- CUSTOM + banded additionally require every paid rank > 0 (monotone ⇒ checking the last/smallest suffices)
  IF v_is_custom AND v_last <= 0       THEN RAISE EXCEPTION 'CUSTOM_ZERO_AMOUNT'; END IF;
  IF v_is_banded AND v_last <= 0       THEN RAISE EXCEPTION 'BANDED_ZERO_AMOUNT'; END IF;

  -- min-cash invariant — PRESET/INDIVIDUAL ONLY. CUSTOM bypasses entirely; a banded run's last
  -- group sits above (or at) the floor, so it skips LAST_NOT_FLOOR (but FLOOR_MISMATCH above still
  -- binds its floor).
  IF NOT v_is_custom AND NOT v_is_banded THEN
    IF v_count >= 2 AND NOT v_pool_below THEN
      IF v_last <> p_effective_floor THEN RAISE EXCEPTION 'LAST_NOT_FLOOR'; END IF;
    ELSIF v_count = 1 THEN
      IF v_last <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'SINGLE_NOT_WHOLE_POOL'; END IF;
    END IF;
  END IF;

  DELETE FROM public.tournament_prizes WHERE tournament_id = v_run.tournament_id;
  INSERT INTO public.tournament_prizes (tournament_id, position, percentage, amount)
  SELECT v_run.tournament_id,
         (e.value->>'position')::int,
         round(((e.value->>'amount')::numeric / NULLIF(v_run.prize_pool_snapshot, 0)) * 100, 2),
         (e.value->>'amount')::numeric
  FROM jsonb_array_elements(p_rows) e;

  UPDATE public.tournaments
     SET prize_pool = v_run.prize_pool_snapshot, itm_places = p_itm_places
   WHERE id = v_run.tournament_id;

  IF v_run.supersedes_run_id IS NOT NULL THEN
    UPDATE public.tournament_payout_runs SET status = 'superseded'
      WHERE id = v_run.supersedes_run_id AND status = 'applied';
  END IF;

  UPDATE public.tournament_payout_runs
     SET status = 'applied', itm_places = p_itm_places, warnings = COALESCE(p_warnings, '[]'::jsonb),
         engine_version = p_engine_version, alpha_version = p_alpha_version, generated_at = now()
   WHERE id = p_run_id;

  -- Player History (post-audit addition, best-effort, additive-only): re-sync official finish/prize
  -- if the field already has a single survivor by the time payout is (re-)applied. Normally a no-op —
  -- the AFTER-UPDATE trigger auto_finalize_on_last_bust already finalizes at the moment the last bust
  -- happens — this is purely a safety net for a payout correction made after the tournament ended.
  -- Never blocks or alters the payout money-flow above: any error here is swallowed, and this line
  -- runs strictly AFTER the payout run is already committed to 'applied'.
  BEGIN
    PERFORM public.finalize_tournament_results(v_run.tournament_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.player_history_link_errors (club_id, context, detail)
    VALUES (v_t.club_id, 'apply_payout_run', left(SQLERRM, 500));
  END;

  RETURN jsonb_build_object('status','applied','run_id', p_run_id, 'itm_places', p_itm_places,
    'prize_pool', v_run.prize_pool_snapshot);
END;
$$;
