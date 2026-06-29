-- ============================================================================================
-- Migration: 20261120000000_payout_engine.sql   (PR-2a — Payout "Engine 3-neo" backend)
-- ============================================================================================
-- STATUS: SOURCE-ONLY. NOT APPLIED. No db push. schema_migrations NOT touched. Nothing deployed.
--         To be applied later ONLY via the owner-approved controlled Management-API runbook
--         (preflight -> dry-run BEGIN..ROLLBACK using the companion *_dryrun.sql -> owner phrase ->
--         BEGIN..COMMIT -> verify). The safety hook must stay enabled.
--
-- WHY ----------------------------------------------------------------------------------------
--   The Prizes panel today stores manual rows with no computation. PR-1 shipped the pure-TS payout
--   engine (flag OFF). This migration adds the SERVER-AUTHORITATIVE persistence + guards so the
--   official payout table is a CLOSE-REGISTRATION SNAPSHOT, never a live-recomputed value:
--       before close = forecast/preview only (no writes here);
--       at close     = freeze paid-entries + pool + floor -> Edge computes -> DB applies + audits;
--       after close  = stored tournament_prizes is the source of truth; registration never reopens.
--
-- WHAT (objects created — all additive; nothing existing is altered or dropped) ---------------
--   tournaments (+columns): registration_closed_at, planned_itm_percent, planned_payout_archetype,
--                           planned_min_cash_x, planned_rounding_unit   (nullable, no volatile default)
--   TABLE  tournament_payout_runs        — audit/snapshot of every finalize/edit attempt
--   TABLE  payout_templates              — saved payout PLANS per club (settings, not rows)
--   INDEX  uq_payout_applied             — PARTIAL UNIQUE: at most ONE status='applied' run / tournament
--   FUNC   is_tournament_registration_closed(uuid)
--   FUNC   assert_tournament_registration_open()  + TRIGGER trg_entries_registration_open
--   FUNC   prepare_payout_snapshot(...)  — locks + freezes the snapshot (the "close & generate" step)
--   FUNC   apply_payout_run(...)         — re-verifies invariants + writes the official payout
--   FUNC   save_tournament_prizes_v2(...)— guarded manual edit after close
--   RLS    on the two new tables (read = owner/admin/cashier/floor; writes deny-direct via DEFINER fns)
--
-- CLOSE-GUARD — every path that can add a paid entry is covered by ONE choke point ------------
--   Instead of editing each live cashier RPC (regression risk), a BEFORE INSERT trigger on
--   public.tournament_entries rejects inserts once registration_closed_at IS NOT NULL, and takes a
--   `FOR SHARE` lock on the parent tournament row so it serialises against prepare_payout_snapshot's
--   `FOR UPDATE` (no count race). This single trigger guards ALL known writers of tournament_entries:
--     - confirm_registration_and_assign_seat   (20260807000001 / 20260811000000)
--     - create_offline_buyin_and_seat           (20260826000002 / 20260826000003)
--     - reenter_tournament_player / re-entry     (20260901000001)   [add_player_with_reentry too]
--     - floor_assign_player_to_seat             (20260913000000)
--     - seat_day2_qualifiers                    (20261027000000)   [multi-day; also blocked earlier]
--     - any direct INSERT INTO tournament_entries (incl. future paths)
--   NOTE: closing for payout therefore also ends re-entry for that tournament (intended — the field
--   is frozen once the prize structure is locked).
--
-- REAL-SCHEMA NOTES (verified on origin/main 324591c) -----------------------------------------
--   tournaments has event_id (so the multi-day block is compile-safe), buy_in INTEGER,
--   rake_amount integer, prize_pool NUMERIC, itm_places INTEGER, live_status text, NO
--   registration_closed_at/planned_*. tournament_entries has no `paid` column — official entry
--   count = count(*) per tournament (re-entries are distinct rows / entry_no). tournament_prizes.amount
--   is NUMERIC(12,2) (pre-existing ~10^10 ceiling; out of scope to widen here).
--
-- INVARIANTS the DB re-checks in apply_payout_run (last line of defence; the curve SHAPE is owned
--   by the PR-1 golden tests + the Edge/client drift guard — the DB cannot run TS) ------------
--     prize_pool == prize_pool_snapshot;  Σ amount == prize_pool_snapshot;  positions = 1..N (no
--     gap/dupe);  amount >= 0;  monotone non-increasing;  itm_places == row count;  effective_floor
--     in [0, pool];  min-cash: if N>=2 and NOT POOL_BELOW_MIN_CASH -> last == effective_floor; if N=1
--     -> last == pool (winner takes the whole pool, which is >= floor).
--
-- IDEMPOTENCY / SAFETY -----------------------------------------------------------------------
--   * prepare NEVER supersedes an applied run; it only creates/resumes a draft. Supersede happens
--     ONLY inside apply_payout_run AFTER the new rows pass every invariant, so an Edge/apply crash
--     leaves the old official payout intact.
--   * Concurrent finalize: two prepares resume the SAME draft (no duplicate); the partial unique
--     index makes a second apply fail cleanly -> exactly one applied run per tournament.
--   * Manual edit creates a NEW applied run that supersedes the old in the same transaction.
--   * All write functions are SECURITY DEFINER, auth.uid()-gated to owner/admin/cashier/floor of the
--     tournament's club (a non-admin cannot apply even with a run_id). The Edge forwards the caller
--     JWT; it does NOT use the service role to bypass these checks.
--
-- ROLLBACK -----------------------------------------------------------------------------------
--   Fully additive. Down-migration = drop the 3 functions + trigger + trigger-fn + 2 tables + index
--   + 5 columns. `update_tournament_prizes` / `get_tournament_prizes` are KEPT untouched, so the
--   existing manual panel keeps working when the payoutEngine flag is OFF.
-- ============================================================================================

-- -------------------------------------------------------------------------------------------
-- 1. tournaments: terminal close marker + planned (create/edit) settings
-- -------------------------------------------------------------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS registration_closed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS planned_itm_percent      numeric,
  ADD COLUMN IF NOT EXISTS planned_payout_archetype text,
  ADD COLUMN IF NOT EXISTS planned_min_cash_x       numeric,
  ADD COLUMN IF NOT EXISTS planned_rounding_unit    bigint;

COMMENT ON COLUMN public.tournaments.registration_closed_at IS
  'Terminal one-way marker set by prepare_payout_snapshot ("Đóng đăng ký & tạo payout"). Once set, no new tournament_entries (trigger) and registration is never reopened.';

-- -------------------------------------------------------------------------------------------
-- 2. tournament_payout_runs — every finalize/regenerate/manual-edit attempt (audit + snapshot)
-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournament_payout_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id         uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'draft_snapshot'
                          CHECK (status IN ('draft_snapshot','applied','superseded')),
  supersedes_run_id     uuid REFERENCES public.tournament_payout_runs(id) ON DELETE SET NULL,
  -- frozen snapshot (immutable once written)
  entries_snapshot      integer NOT NULL,
  buy_in_snapshot       bigint  NOT NULL,
  rake_snapshot         bigint  NOT NULL DEFAULT 0,
  prize_pool_snapshot   bigint  NOT NULL,
  prize_pool_overridden boolean NOT NULL DEFAULT false,
  override_reason       text,
  effective_floor       bigint  NOT NULL,
  -- chosen settings (the Edge must compute with exactly these)
  itm_percent           numeric NOT NULL,
  archetype             text    NOT NULL CHECK (archetype IN ('DAILY','INTL','MULTI','TRITON')),
  min_cash_x            numeric NOT NULL,
  rounding_unit         bigint  NOT NULL,
  -- result (set at apply)
  itm_places            integer,
  engine_version        text,
  alpha_version         text,
  warnings              jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- provenance
  source                text NOT NULL CHECK (source IN ('close','regenerate','manual_edit')),
  reason                text,
  generated_by          uuid,
  generated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payout_runs_tournament ON public.tournament_payout_runs(tournament_id);

-- P0-1 HARD GUARD: at most one applied payout run per tournament (concurrent apply -> clean reject).
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_applied
  ON public.tournament_payout_runs(tournament_id) WHERE status = 'applied';

-- -------------------------------------------------------------------------------------------
-- 3. payout_templates — saved PLANS per club (settings only; rows depend on real entries/pool)
-- -------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name          text NOT NULL,
  archetype     text NOT NULL CHECK (archetype IN ('DAILY','INTL','MULTI','TRITON')),
  itm_percent   numeric NOT NULL,
  min_cash_x    numeric NOT NULL,
  rounding_unit bigint,
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payout_templates_club ON public.payout_templates(club_id);

-- -------------------------------------------------------------------------------------------
-- 4. is_tournament_registration_closed — explicit, pause-proof (no wall-clock)
-- -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_tournament_registration_closed(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT registration_closed_at IS NOT NULL OR live_status = 'finished'
       FROM public.tournaments WHERE id = p_tournament_id),
    false);
$$;

-- -------------------------------------------------------------------------------------------
-- 5. Close-guard trigger on tournament_entries (single choke point for ALL insert paths)
-- -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_tournament_registration_open()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_closed timestamptz;
BEGIN
  -- FOR SHARE serialises against prepare_payout_snapshot's FOR UPDATE => no snapshot-count race.
  SELECT registration_closed_at INTO v_closed
    FROM public.tournaments WHERE id = NEW.tournament_id FOR SHARE;
  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION 'REGISTRATION_CLOSED: tournament % payout is finalized — no new entries', NEW.tournament_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entries_registration_open ON public.tournament_entries;
CREATE TRIGGER trg_entries_registration_open
  BEFORE INSERT ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.assert_tournament_registration_open();

-- -------------------------------------------------------------------------------------------
-- 6. prepare_payout_snapshot — locks, closes registration (terminal), freezes the snapshot.
--    This IS the "Đóng đăng ký & tạo payout" server step. Returns the run + frozen values for
--    the Edge to compute from. NEVER supersedes an applied run.
-- -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prepare_payout_snapshot(
  p_tournament_id      uuid,
  p_itm_percent        numeric,
  p_archetype          text,
  p_min_cash_x         numeric,
  p_rounding_unit      bigint,
  p_prize_pool_override bigint  DEFAULT NULL,
  p_override_reason    text     DEFAULT NULL,
  p_regenerate         boolean  DEFAULT false,
  p_reason             text     DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_t            public.tournaments%ROWTYPE;
  v_paid         integer;
  v_default_pool bigint;
  v_pool         bigint;
  v_floor        bigint;
  v_overridden   boolean := false;
  v_applied      public.tournament_payout_runs%ROWTYPE;
  v_draft        public.tournament_payout_runs%ROWTYPE;
  v_supersedes   uuid := NULL;
  v_run          public.tournament_payout_runs%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  -- lock tournament (serialises vs the entry-insert trigger's FOR SHARE)
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND'; END IF;

  IF NOT (public.is_club_owner(v_uid, v_t.club_id)
       OR public.is_club_admin(v_uid, v_t.club_id)
       OR public.is_club_cashier(v_uid, v_t.club_id)
       OR public.is_club_floor(v_uid, v_t.club_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF v_t.event_id IS NOT NULL THEN RAISE EXCEPTION 'MULTIDAY_UNSUPPORTED'; END IF;

  IF p_archetype NOT IN ('DAILY','INTL','MULTI','TRITON') THEN RAISE EXCEPTION 'BAD_ARCHETYPE'; END IF;
  IF p_itm_percent IS NULL OR p_itm_percent <= 0 OR p_itm_percent >= 1 THEN RAISE EXCEPTION 'BAD_ITM_PERCENT'; END IF;
  IF p_min_cash_x IS NULL OR p_min_cash_x <= 0 THEN RAISE EXCEPTION 'BAD_MIN_CASH_X'; END IF;
  IF p_rounding_unit IS NULL OR p_rounding_unit <= 0 THEN RAISE EXCEPTION 'BAD_ROUNDING_UNIT'; END IF;

  -- terminal close (one-way; idempotent)
  IF v_t.registration_closed_at IS NULL THEN
    UPDATE public.tournaments SET registration_closed_at = now() WHERE id = p_tournament_id;
  END IF;

  -- official paid entries (re-entries each count). Defensive exclusion of void/cancel statuses if any.
  SELECT count(*) INTO v_paid
    FROM public.tournament_entries
    WHERE tournament_id = p_tournament_id
      AND COALESCE(status, '') NOT IN ('void','voided','cancelled','canceled','refunded','rejected');
  IF v_paid < 1 THEN RAISE EXCEPTION 'NO_PAID_ENTRIES'; END IF;

  -- pool: default = paid x buy_in; override allowed but must differ-with-reason
  v_default_pool := v_paid::bigint * v_t.buy_in::bigint;
  IF p_prize_pool_override IS NOT NULL AND p_prize_pool_override <> v_default_pool THEN
    IF p_prize_pool_override <= 0 THEN RAISE EXCEPTION 'BAD_PRIZE_POOL_OVERRIDE'; END IF;
    IF p_override_reason IS NULL OR length(btrim(p_override_reason)) = 0 THEN
      RAISE EXCEPTION 'PRIZE_POOL_OVERRIDE_REASON_REQUIRED';
    END IF;
    v_pool := p_prize_pool_override;
    v_overridden := true;
  ELSE
    v_pool := v_default_pool;
  END IF;

  v_floor := floor(p_min_cash_x * (v_t.buy_in::numeric + COALESCE(v_t.rake_amount, 0)::numeric))::bigint;

  -- single-applied resume / regenerate (never supersede here)
  SELECT * INTO v_applied FROM public.tournament_payout_runs
    WHERE tournament_id = p_tournament_id AND status = 'applied' LIMIT 1;

  IF v_applied.id IS NOT NULL AND NOT p_regenerate THEN
    RETURN jsonb_build_object('status','already_applied','run_id', v_applied.id,
      'entries_snapshot', v_applied.entries_snapshot, 'buy_in_snapshot', v_applied.buy_in_snapshot,
      'rake_snapshot', v_applied.rake_snapshot, 'prize_pool_snapshot', v_applied.prize_pool_snapshot,
      'effective_floor', v_applied.effective_floor, 'itm_percent', v_applied.itm_percent,
      'archetype', v_applied.archetype, 'min_cash_x', v_applied.min_cash_x, 'rounding_unit', v_applied.rounding_unit);
  END IF;

  IF p_regenerate THEN
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'REGENERATE_REASON_REQUIRED'; END IF;
    v_supersedes := v_applied.id;  -- recorded on the draft; applied is touched ONLY in apply_payout_run
    DELETE FROM public.tournament_payout_runs
      WHERE tournament_id = p_tournament_id AND status = 'draft_snapshot';  -- clear stale drafts
  ELSE
    -- resume an existing draft instead of creating a duplicate (concurrent prepare)
    SELECT * INTO v_draft FROM public.tournament_payout_runs
      WHERE tournament_id = p_tournament_id AND status = 'draft_snapshot'
      ORDER BY generated_at DESC LIMIT 1;
    IF v_draft.id IS NOT NULL THEN
      RETURN jsonb_build_object('status','resumed','run_id', v_draft.id,
        'entries_snapshot', v_draft.entries_snapshot, 'buy_in_snapshot', v_draft.buy_in_snapshot,
        'rake_snapshot', v_draft.rake_snapshot, 'prize_pool_snapshot', v_draft.prize_pool_snapshot,
        'effective_floor', v_draft.effective_floor, 'itm_percent', v_draft.itm_percent,
        'archetype', v_draft.archetype, 'min_cash_x', v_draft.min_cash_x, 'rounding_unit', v_draft.rounding_unit);
    END IF;
  END IF;

  INSERT INTO public.tournament_payout_runs(
    tournament_id, status, supersedes_run_id, entries_snapshot, buy_in_snapshot, rake_snapshot,
    prize_pool_snapshot, prize_pool_overridden, override_reason, effective_floor,
    itm_percent, archetype, min_cash_x, rounding_unit, source, reason, generated_by)
  VALUES (
    p_tournament_id, 'draft_snapshot', v_supersedes, v_paid, v_t.buy_in, COALESCE(v_t.rake_amount,0),
    v_pool, v_overridden, CASE WHEN v_overridden THEN p_override_reason END, v_floor,
    p_itm_percent, p_archetype, p_min_cash_x, p_rounding_unit,
    CASE WHEN p_regenerate THEN 'regenerate' ELSE 'close' END, p_reason, v_uid)
  RETURNING * INTO v_run;

  RETURN jsonb_build_object('status','prepared','run_id', v_run.id,
    'entries_snapshot', v_run.entries_snapshot, 'buy_in_snapshot', v_run.buy_in_snapshot,
    'rake_snapshot', v_run.rake_snapshot, 'prize_pool_snapshot', v_run.prize_pool_snapshot,
    'effective_floor', v_run.effective_floor, 'itm_percent', v_run.itm_percent,
    'archetype', v_run.archetype, 'min_cash_x', v_run.min_cash_x, 'rounding_unit', v_run.rounding_unit);
END;
$$;

-- -------------------------------------------------------------------------------------------
-- 7. apply_payout_run — re-verify EVERY invariant, then write the official payout atomically.
-- -------------------------------------------------------------------------------------------
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
  v_pool_below boolean := (p_warnings @> '["POOL_BELOW_MIN_CASH"]'::jsonb);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  SELECT * INTO v_run FROM public.tournament_payout_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RUN_NOT_FOUND'; END IF;
  IF v_run.status <> 'draft_snapshot' THEN RAISE EXCEPTION 'RUN_NOT_DRAFT'; END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = v_run.tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND'; END IF;

  IF NOT (public.is_club_owner(v_uid, v_t.club_id)
       OR public.is_club_admin(v_uid, v_t.club_id)
       OR public.is_club_cashier(v_uid, v_t.club_id)
       OR public.is_club_floor(v_uid, v_t.club_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT public.is_tournament_registration_closed(v_run.tournament_id) THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_CLOSED';
  END IF;

  -- snapshot binding
  IF p_prize_pool <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'POOL_MISMATCH'; END IF;
  IF p_effective_floor < 0 OR p_effective_floor > v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'FLOOR_RANGE'; END IF;
  IF NOT v_pool_below AND p_effective_floor <> v_run.effective_floor THEN RAISE EXCEPTION 'FLOOR_MISMATCH'; END IF;

  -- structural validation of p_rows (set-based)
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
         COALESCE(bool_and(position = rn), true),
         COALESCE(bool_and(amount >= 0), true),
         COALESCE(bool_and(prev_amt IS NULL OR amount <= prev_amt), true),
         (SELECT amount FROM ord WHERE rn = (SELECT max(rn) FROM ord))
    INTO v_count, v_sum, v_contig, v_nonneg, v_monotone, v_last
  FROM ord;

  IF v_count < 1                       THEN RAISE EXCEPTION 'EMPTY_ROWS'; END IF;
  IF v_count <> p_itm_places           THEN RAISE EXCEPTION 'ITM_PLACES_MISMATCH'; END IF;
  IF NOT v_contig                      THEN RAISE EXCEPTION 'POSITION_GAP_OR_DUP'; END IF;
  IF NOT v_nonneg                      THEN RAISE EXCEPTION 'NEGATIVE_AMOUNT'; END IF;
  IF NOT v_monotone                    THEN RAISE EXCEPTION 'NOT_MONOTONE'; END IF;
  IF v_sum <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'SUM_MISMATCH'; END IF;

  -- min-cash invariant (N>=2: last = floor; N=1: winner takes whole pool)
  IF v_count >= 2 AND NOT v_pool_below THEN
    IF v_last <> p_effective_floor THEN RAISE EXCEPTION 'LAST_NOT_FLOOR'; END IF;
  ELSIF v_count = 1 THEN
    IF v_last <> v_run.prize_pool_snapshot THEN RAISE EXCEPTION 'SINGLE_NOT_WHOLE_POOL'; END IF;
  END IF;

  -- write official payout (percentage recomputed server-side, never trusted from input)
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

  -- supersede the prior official run ONLY now (after success); the partial unique index guarantees
  -- exactly one applied run remains.
  IF v_run.supersedes_run_id IS NOT NULL THEN
    UPDATE public.tournament_payout_runs SET status = 'superseded'
      WHERE id = v_run.supersedes_run_id AND status = 'applied';
  END IF;

  UPDATE public.tournament_payout_runs
     SET status = 'applied', itm_places = p_itm_places, warnings = COALESCE(p_warnings, '[]'::jsonb),
         engine_version = p_engine_version, alpha_version = p_alpha_version, generated_at = now()
   WHERE id = p_run_id;

  RETURN jsonb_build_object('status','applied','run_id', p_run_id, 'itm_places', p_itm_places,
    'prize_pool', v_run.prize_pool_snapshot);
END;
$$;

-- -------------------------------------------------------------------------------------------
-- 8. save_tournament_prizes_v2 — guarded manual edit AFTER an official payout exists.
--    Keeps the pool locked; creates a NEW applied run (source=manual_edit) superseding the old.
-- -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_tournament_prizes_v2(
  p_tournament_id uuid,
  p_rows          jsonb,
  p_reason        text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_t        public.tournaments%ROWTYPE;
  v_applied  public.tournament_payout_runs%ROWTYPE;
  v_count    integer;
  v_sum      numeric;
  v_contig   boolean;
  v_nonneg   boolean;
  v_monotone boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN RAISE EXCEPTION 'MANUAL_EDIT_REASON_REQUIRED'; END IF;

  SELECT * INTO v_t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TOURNAMENT_NOT_FOUND'; END IF;

  IF NOT (public.is_club_owner(v_uid, v_t.club_id)
       OR public.is_club_admin(v_uid, v_t.club_id)
       OR public.is_club_cashier(v_uid, v_t.club_id)
       OR public.is_club_floor(v_uid, v_t.club_id)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT public.is_tournament_registration_closed(p_tournament_id) THEN RAISE EXCEPTION 'REGISTRATION_NOT_CLOSED'; END IF;

  SELECT * INTO v_applied FROM public.tournament_payout_runs
    WHERE tournament_id = p_tournament_id AND status = 'applied' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'NO_APPLIED_RUN'; END IF;  -- generate an official payout first

  WITH r AS (
    SELECT (e.value->>'position')::int AS position, (e.value->>'amount')::numeric AS amount
    FROM jsonb_array_elements(p_rows) e
  ), ord AS (
    SELECT position, amount, row_number() OVER (ORDER BY position) AS rn,
           lag(amount) OVER (ORDER BY position) AS prev_amt
    FROM r
  )
  SELECT count(*), COALESCE(sum(amount),0),
         COALESCE(bool_and(position = rn), true),
         COALESCE(bool_and(amount >= 0), true),
         COALESCE(bool_and(prev_amt IS NULL OR amount <= prev_amt), true)
    INTO v_count, v_sum, v_contig, v_nonneg, v_monotone
  FROM ord;

  IF v_count < 1                          THEN RAISE EXCEPTION 'EMPTY_ROWS'; END IF;
  IF NOT v_contig                         THEN RAISE EXCEPTION 'POSITION_GAP_OR_DUP'; END IF;
  IF NOT v_nonneg                         THEN RAISE EXCEPTION 'NEGATIVE_AMOUNT'; END IF;
  IF NOT v_monotone                       THEN RAISE EXCEPTION 'NOT_MONOTONE'; END IF;
  IF v_sum <> v_applied.prize_pool_snapshot THEN RAISE EXCEPTION 'SUM_MISMATCH'; END IF;  -- pool stays locked

  DELETE FROM public.tournament_prizes WHERE tournament_id = p_tournament_id;
  INSERT INTO public.tournament_prizes (tournament_id, position, percentage, amount)
  SELECT p_tournament_id, (e.value->>'position')::int,
         round(((e.value->>'amount')::numeric / NULLIF(v_applied.prize_pool_snapshot, 0)) * 100, 2),
         (e.value->>'amount')::numeric
  FROM jsonb_array_elements(p_rows) e;

  UPDATE public.tournaments SET itm_places = v_count WHERE id = p_tournament_id;  -- pool unchanged

  UPDATE public.tournament_payout_runs SET status = 'superseded' WHERE id = v_applied.id;
  INSERT INTO public.tournament_payout_runs(
    tournament_id, status, supersedes_run_id, entries_snapshot, buy_in_snapshot, rake_snapshot,
    prize_pool_snapshot, prize_pool_overridden, override_reason, effective_floor, itm_percent,
    archetype, min_cash_x, rounding_unit, itm_places, engine_version, alpha_version, warnings,
    source, reason, generated_by)
  VALUES (
    p_tournament_id, 'applied', v_applied.id, v_applied.entries_snapshot, v_applied.buy_in_snapshot,
    v_applied.rake_snapshot, v_applied.prize_pool_snapshot, v_applied.prize_pool_overridden,
    v_applied.override_reason, v_applied.effective_floor, v_applied.itm_percent, v_applied.archetype,
    v_applied.min_cash_x, v_applied.rounding_unit, v_count, v_applied.engine_version,
    v_applied.alpha_version, v_applied.warnings, 'manual_edit', p_reason, v_uid);

  RETURN jsonb_build_object('status','saved','itm_places', v_count);
END;
$$;

-- -------------------------------------------------------------------------------------------
-- 9. GRANTS / RLS
--    Write functions: authenticated only (they self-check club role); anon/public revoked.
--    Tables: RLS ON; SELECT = owner/admin/cashier/floor; NO insert/update/delete policies on
--    tournament_payout_runs (writes only via the SECURITY DEFINER functions, which bypass RLS as
--    the table owner). payout_templates allows owner/admin direct CRUD (low-risk config).
-- -------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.prepare_payout_snapshot(uuid,numeric,text,numeric,bigint,bigint,text,boolean,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prepare_payout_snapshot(uuid,numeric,text,numeric,bigint,bigint,text,boolean,text) TO authenticated;
REVOKE ALL ON FUNCTION public.apply_payout_run(uuid,jsonb,bigint,integer,bigint,jsonb,text,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.apply_payout_run(uuid,jsonb,bigint,integer,bigint,jsonb,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.save_tournament_prizes_v2(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_tournament_prizes_v2(uuid,jsonb,text) TO authenticated;
REVOKE ALL ON FUNCTION public.is_tournament_registration_closed(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_tournament_registration_closed(uuid) TO authenticated;

ALTER TABLE public.tournament_payout_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_runs_select ON public.tournament_payout_runs;
CREATE POLICY payout_runs_select ON public.tournament_payout_runs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = tournament_payout_runs.tournament_id
      AND (public.is_club_owner(auth.uid(), t.club_id)
        OR public.is_club_admin(auth.uid(), t.club_id)
        OR public.is_club_cashier(auth.uid(), t.club_id)
        OR public.is_club_floor(auth.uid(), t.club_id))));

ALTER TABLE public.payout_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payout_templates_select ON public.payout_templates;
CREATE POLICY payout_templates_select ON public.payout_templates FOR SELECT TO authenticated
  USING (public.is_club_owner(auth.uid(), club_id)
      OR public.is_club_admin(auth.uid(), club_id)
      OR public.is_club_cashier(auth.uid(), club_id)
      OR public.is_club_floor(auth.uid(), club_id));
DROP POLICY IF EXISTS payout_templates_write ON public.payout_templates;
CREATE POLICY payout_templates_write ON public.payout_templates FOR ALL TO authenticated
  USING (public.is_club_owner(auth.uid(), club_id) OR public.is_club_admin(auth.uid(), club_id))
  WITH CHECK (public.is_club_owner(auth.uid(), club_id) OR public.is_club_admin(auth.uid(), club_id));

-- ============================================================================================
-- END migration. Down-migration (for reference; run only to fully revert):
--   DROP TRIGGER IF EXISTS trg_entries_registration_open ON public.tournament_entries;
--   DROP FUNCTION IF EXISTS public.assert_tournament_registration_open();
--   DROP FUNCTION IF EXISTS public.save_tournament_prizes_v2(uuid,jsonb,text);
--   DROP FUNCTION IF EXISTS public.apply_payout_run(uuid,jsonb,bigint,integer,bigint,jsonb,text,text);
--   DROP FUNCTION IF EXISTS public.prepare_payout_snapshot(uuid,numeric,text,numeric,bigint,bigint,text,boolean,text);
--   DROP FUNCTION IF EXISTS public.is_tournament_registration_closed(uuid);
--   DROP INDEX  IF EXISTS public.uq_payout_applied;
--   DROP TABLE  IF EXISTS public.payout_templates;
--   DROP TABLE  IF EXISTS public.tournament_payout_runs;
--   ALTER TABLE public.tournaments
--     DROP COLUMN IF EXISTS registration_closed_at, DROP COLUMN IF EXISTS planned_itm_percent,
--     DROP COLUMN IF EXISTS planned_payout_archetype, DROP COLUMN IF EXISTS planned_min_cash_x,
--     DROP COLUMN IF EXISTS planned_rounding_unit;
-- ============================================================================================
