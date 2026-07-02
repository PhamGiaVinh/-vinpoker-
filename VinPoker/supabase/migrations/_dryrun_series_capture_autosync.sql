-- =====================================================================================================
-- CONTROLLED DRY-RUN for 20261126000000_series_capture_autosync.sql (SOURCE-ONLY — _-prefixed, NOT a migration)
-- The leading underscore keeps it OUT of the migration sequence (runner never auto-applies it). It applies the
-- migration body (minus the cron.schedule block) INSIDE a transaction, seeds disposable fixtures, exercises the
-- sync functions, proves structure + behavior, then ROLLBACKs. NOTHING persists — not even the new objects.
--
-- WHAT THIS PROVES (one returned result set = a PASS/FAIL matrix):
--   S1..S4  structure: new tables + source_entry_id column + unique index exist; RLS on; grant shape
--           (SELECT-only on actuals/runs, no DELETE anywhere, settings owner-writable); the 3 functions are
--           SECURITY DEFINER with EXECUTE revoked from PUBLIC on the system fns and granted on the _club fn.
--   G1..G11 behavior of the GLOBAL cron path (series_capture_autosync):
--           G1 confirmed regs captured (pending excluded); G2 re-entry bullet/flag correct; G3 actuals row
--           (entries/unique/reentries/prize_pool/overlay); G4 fee excluded from prize_pool; G5 player hash ==
--           client hashPlayerRef vector + type='app_user_id'; G6 a DISABLED club is untouched; G7 a poison
--           (error-injected) club captures NOTHING (its subtransaction rolled back); G8 that error is LOGGED;
--           G9 the good club logs a clean run; G10 idempotent across 3 runs (no dupes, actuals not doubled);
--           G11 advisory locks are xact-scoped (held now, released at ROLLBACK).
--   M1..M2  the UI "Sync ngay" fn: a NON-owner is rejected (42501); the OWNER is accepted (ok=true, manual run).
--   H1      hash parity: server encode(digest(...)) == the client test vector byte-for-byte.
--   I1      owner-scoped read isolation on series_event_actuals (owner sees own; a non-owner sees 0).
--
-- HOW TO RUN (only in the owner-gated apply session, as the DRY-RUN step BEFORE apply):
--   1) Edit the single fixture UUID in the _fix INSERT: 'owner' = a REAL auth.users.id you control (it becomes
--      owner_id of 3 disposable fixture clubs created + rolled back here — nothing real is modified).
--   2) supabase db query --linked --file VinPoker/supabase/migrations/_dryrun_series_capture_autosync.sql
--   3) Read the matrix: EVERY row must say PASS.
--   4) MANDATORY SAFETY RE-CHECK afterwards: re-run the liveness probe (to_regclass of the 3 new tables MUST be
--      NULL; no advisory locks left for your backend). If anything persists, your client did NOT honor ROLLBACK.
--
-- RUN-MODEL NOTES (same as the v0 dry-run):
--   * `supabase db query --file` returns ONLY the LAST statement's rows and ABORTS on the first uncaught error,
--     so every assertion lives in a plpgsql DO sub-block (BEGIN/EXCEPTION = implicit savepoint); an expected
--     failure is CAUGHT and recorded as PASS. The single final SELECT over _dryrun_results is the result set.
--   * Fixtures are inserted with 3 app triggers on clubs/tournaments briefly DISABLED (single-club-per-owner
--     enforcement, club-table initializer, tournament audit) so 3 clubs can share one owner and no audit side
--     effects fire; re-ENABLED immediately after. All of it is inside the transaction and rolled back.
--   * The sync functions run as the privileged login role (definer=postgres) exactly as pg_cron would.
-- =====================================================================================================

BEGIN;

-- Single fixture: a REAL auth.users id you control (owner of the 3 disposable fixture clubs). All-zero = rejected.
CREATE TEMP TABLE _fix (k text PRIMARY KEY, v uuid) ON COMMIT DROP;
INSERT INTO _fix (k, v) VALUES ('owner', '00000000-0000-0000-0000-000000000000');

DO $preflight$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
BEGIN
  IF v_owner = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION 'PRE-FLIGHT: fixture owner is still the all-zero placeholder — edit the _fix INSERT.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_owner) THEN
    RAISE EXCEPTION 'PRE-FLIGHT: owner % not found in auth.users.', v_owner; END IF;
  RAISE NOTICE 'PRE-FLIGHT OK: owner % exists.', v_owner;
END
$preflight$;

-- =====================================================================================================
-- MIGRATION BODY (verbatim from 20261126000000_series_capture_autosync.sql, sections 1-6; cron block omitted)
-- =====================================================================================================
CREATE TABLE IF NOT EXISTS public.series_event_actuals (
  event_id              uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id               uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  actual_entries        integer NOT NULL DEFAULT 0,
  actual_unique_players integer NOT NULL DEFAULT 0,
  actual_reentries      integer NOT NULL DEFAULT 0,
  actual_prize_pool     bigint  NOT NULL DEFAULT 0,
  actual_overlay_amount bigint  NOT NULL DEFAULT 0,
  source                text    NOT NULL DEFAULT 'autosync',
  captured_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sea_nonneg CHECK (
    actual_entries >= 0 AND actual_unique_players >= 0 AND actual_reentries >= 0
    AND actual_prize_pool >= 0 AND actual_overlay_amount >= 0),
  CONSTRAINT sea_reentries_chk CHECK (actual_reentries = actual_entries - actual_unique_players)
);
CREATE INDEX IF NOT EXISTS idx_sea_club ON public.series_event_actuals(club_id);

ALTER TABLE public.series_registration_events ADD COLUMN IF NOT EXISTS source_entry_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sre_source_entry
  ON public.series_registration_events(source_entry_id) WHERE source_entry_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.series_capture_settings (
  club_id          uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  autosync_enabled boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid DEFAULT auth.uid()
);

CREATE TABLE IF NOT EXISTS public.series_capture_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                timestamptz NOT NULL DEFAULT now(),
  club_id               uuid,
  scope                 text NOT NULL,
  rows_reg_captured     integer NOT NULL DEFAULT 0,
  rows_actuals_upserted integer NOT NULL DEFAULT 0,
  rows_errored          integer NOT NULL DEFAULT 0,
  error_sample          text
);
CREATE INDEX IF NOT EXISTS idx_scr_club ON public.series_capture_runs(club_id, run_at DESC);

ALTER TABLE public.series_event_actuals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_capture_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_capture_runs     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.series_event_actuals    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_capture_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_capture_runs     FROM PUBLIC, anon, authenticated;

GRANT SELECT                 ON public.series_event_actuals    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.series_capture_settings TO authenticated;
GRANT SELECT                 ON public.series_capture_runs     TO authenticated;

DROP POLICY IF EXISTS sea_select ON public.series_event_actuals;
CREATE POLICY sea_select ON public.series_event_actuals
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS scs_select ON public.series_capture_settings;
CREATE POLICY scs_select ON public.series_capture_settings
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));
DROP POLICY IF EXISTS scs_insert ON public.series_capture_settings;
CREATE POLICY scs_insert ON public.series_capture_settings
  FOR INSERT TO authenticated
  WITH CHECK (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));
DROP POLICY IF EXISTS scs_update ON public.series_capture_settings;
CREATE POLICY scs_update ON public.series_capture_settings
  FOR UPDATE TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id))
  WITH CHECK (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS scr_select ON public.series_capture_runs;
CREATE POLICY scr_select ON public.series_capture_runs
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

CREATE OR REPLACE FUNCTION public.series_capture_sync_one_club(
  p_club_id uuid, p_limit integer DEFAULT 500, OUT rows_reg integer, OUT rows_actuals integer)
RETURNS record LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
BEGIN
  rows_reg := 0; rows_actuals := 0;
  WITH ranked AS (
    SELECT tr.id AS reg_id, t.id AS event_id, t.club_id AS club_id, tr.player_id AS player_id,
           tr.committed_at AS committed_at,
           row_number() OVER (PARTITION BY tr.tournament_id, tr.player_id ORDER BY tr.committed_at, tr.id) AS bullet_no
    FROM public.tournament_registrations tr
    JOIN public.tournaments t ON t.id = tr.tournament_id
    WHERE t.club_id = p_club_id AND t.deleted_at IS NULL AND tr.status = 'confirmed'
  ),
  todo AS (
    SELECT r.* FROM ranked r
    WHERE NOT EXISTS (SELECT 1 FROM public.series_registration_events e WHERE e.source_entry_id = r.reg_id)
    ORDER BY r.committed_at, r.reg_id LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.series_registration_events
      (club_id, event_id, player_ref_hash, player_ref_type, registered_at, is_reentry, bullet, commitment_stage, source_entry_id)
    SELECT td.club_id, td.event_id,
           encode(extensions.digest(lower(trim(td.player_id::text)), 'sha256'), 'hex'),
           'app_user_id', td.committed_at, (td.bullet_no > 1), LEAST(td.bullet_no, 32767)::smallint, 'paid', td.reg_id
    FROM todo td
    ON CONFLICT (source_entry_id) WHERE source_entry_id IS NOT NULL DO NOTHING RETURNING 1
  )
  SELECT count(*)::int INTO rows_reg FROM ins;

  WITH agg AS (
    SELECT t.id AS event_id, t.club_id, t.guarantee_amount,
           coalesce(a.total, 0) AS total, coalesce(a.uniq, 0) AS uniq, coalesce(a.pool, 0) AS pool
    FROM public.tournaments t
    LEFT JOIN LATERAL (
      SELECT count(*) AS total, count(distinct tr.player_id) AS uniq, coalesce(sum(tr.buy_in), 0) AS pool
      FROM public.tournament_registrations tr
      WHERE tr.tournament_id = t.id AND tr.status = 'confirmed'
    ) a ON true
    WHERE t.club_id = p_club_id AND t.deleted_at IS NULL AND t.status = 'completed'
  ),
  up AS (
    INSERT INTO public.series_event_actuals
      (event_id, club_id, actual_entries, actual_unique_players, actual_reentries, actual_prize_pool, actual_overlay_amount, source, captured_at)
    SELECT agg.event_id, agg.club_id, agg.total::int, agg.uniq::int, (agg.total - agg.uniq)::int,
           LEAST(agg.pool, 9223372036854775807::numeric)::bigint,
           LEAST(GREATEST(0::numeric, coalesce(agg.guarantee_amount, 0) - agg.pool), 9223372036854775807::numeric)::bigint,
           'autosync', now()
    FROM agg
    ON CONFLICT (event_id) DO UPDATE SET
      actual_entries=EXCLUDED.actual_entries, actual_unique_players=EXCLUDED.actual_unique_players,
      actual_reentries=EXCLUDED.actual_reentries, actual_prize_pool=EXCLUDED.actual_prize_pool,
      actual_overlay_amount=EXCLUDED.actual_overlay_amount, source=EXCLUDED.source, captured_at=EXCLUDED.captured_at
    RETURNING 1
  )
  SELECT count(*)::int INTO rows_actuals FROM up;
END;
$$;
REVOKE ALL ON FUNCTION public.series_capture_sync_one_club(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.series_capture_autosync()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE rec record; v_reg int; v_act int;
BEGIN
  FOR rec IN SELECT club_id FROM public.series_capture_settings WHERE autosync_enabled ORDER BY club_id LOOP
    BEGIN
      PERFORM pg_advisory_xact_lock(778201, hashtext(rec.club_id::text));
      SELECT s.rows_reg, s.rows_actuals INTO v_reg, v_act FROM public.series_capture_sync_one_club(rec.club_id, 500) s;
      INSERT INTO public.series_capture_runs (club_id, scope, rows_reg_captured, rows_actuals_upserted, rows_errored)
        VALUES (rec.club_id, 'cron', coalesce(v_reg, 0), coalesce(v_act, 0), 0);
    EXCEPTION WHEN others THEN
      INSERT INTO public.series_capture_runs (club_id, scope, rows_errored, error_sample)
        VALUES (rec.club_id, 'cron', 1, left(SQLERRM, 500));
    END;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.series_capture_autosync() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.series_capture_autosync_club(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
AS $$
DECLARE v_reg int; v_act int;
BEGIN
  IF p_club_id IS NULL OR NOT public.is_club_owner(auth.uid(), p_club_id) THEN
    RAISE EXCEPTION 'not_authorized' USING errcode = '42501'; END IF;
  IF NOT pg_try_advisory_xact_lock(778201, hashtext(p_club_id::text)) THEN
    RETURN jsonb_build_object('ok', false, 'busy', true, 'run_at', now()); END IF;
  SELECT s.rows_reg, s.rows_actuals INTO v_reg, v_act FROM public.series_capture_sync_one_club(p_club_id, 500) s;
  INSERT INTO public.series_capture_runs (club_id, scope, rows_reg_captured, rows_actuals_upserted, rows_errored)
    VALUES (p_club_id, 'manual', coalesce(v_reg, 0), coalesce(v_act, 0), 0);
  RETURN jsonb_build_object('ok', true, 'busy', false, 'rows_reg', coalesce(v_reg, 0), 'rows_actuals', coalesce(v_act, 0), 'run_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.series_capture_autosync_club(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.series_capture_autosync_club(uuid) TO authenticated;

-- =====================================================================================================
-- RESULTS SINK + fixture-id carry (temp, ON COMMIT DROP — moot under ROLLBACK).
-- =====================================================================================================
CREATE TEMP TABLE _dryrun_results (check_name text PRIMARY KEY, expected text, got text, pass boolean) ON COMMIT DROP;
CREATE TEMP TABLE _ids (k text PRIMARY KEY, v uuid) ON COMMIT DROP;

-- The shared client/server hash test vector (also asserted in hashPlayerRef.test.ts).
CREATE TEMP TABLE _const (k text PRIMARY KEY, v text) ON COMMIT DROP;
INSERT INTO _const VALUES
  ('u1', '11111111-1111-1111-1111-111111111111'),
  ('u1_hash', 'bafde89c041e1756082b933aaf16cad8e65dec48de748479352f657e89dd6da5');

-- =====================================================================================================
-- FIXTURES — 3 clubs (enabled / poison / disabled), tournaments + confirmed registrations. App triggers on
-- clubs/tournaments briefly disabled so 3 clubs share one owner and no audit side effects fire.
-- =====================================================================================================
DO $fix$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
  v_enabled uuid; v_poison uuid; v_disabled uuid;
  v_t1 uuid; v_tp uuid; v_t2 uuid;
  u1 uuid := (SELECT v::uuid FROM _const WHERE k='u1');
  u2 uuid := '22222222-2222-2222-2222-222222222222';
  u3 uuid := '33333333-3333-3333-3333-333333333333';
  t0 timestamptz := timestamptz '2026-01-01 10:00:00+00';
BEGIN
  ALTER TABLE public.clubs DISABLE TRIGGER trg_enforce_single_club_per_owner;
  ALTER TABLE public.clubs DISABLE TRIGGER trg_initialize_club_tables;
  ALTER TABLE public.tournaments DISABLE TRIGGER trg_tournament_audit;
  ALTER TABLE public.tournament_entries DISABLE TRIGGER trg_entries_registration_open;

  INSERT INTO public.clubs (name, region, owner_id) VALUES ('DRYRUN enabled','dryrun', v_owner) RETURNING id INTO v_enabled;
  -- poison club gets a FIXED id so the injected failure trigger (created below) can target it.
  INSERT INTO public.clubs (id, name, region, owner_id) VALUES ('0000dead-0000-0000-0000-00000000dead', 'DRYRUN poison','dryrun', v_owner) RETURNING id INTO v_poison;
  INSERT INTO public.clubs (name, region, owner_id) VALUES ('DRYRUN disabled','dryrun', v_owner) RETURNING id INTO v_disabled;
  INSERT INTO _ids VALUES ('enabled', v_enabled), ('poison', v_poison), ('disabled', v_disabled);

  -- kill-switch: enabled + poison ON; disabled OFF
  INSERT INTO public.series_capture_settings (club_id, autosync_enabled)
    VALUES (v_enabled, true), (v_poison, true), (v_disabled, false);

  -- tournaments (completed). The poison club's actuals INSERT is failed by an injected temp trigger (created
  -- below) to prove per-club isolation — the old out-of-bigint-range GTD trick no longer errors now that the
  -- migration clamps the overlay cast in numeric (finding F1). So Tp uses a perfectly normal GTD.
  INSERT INTO public.tournaments (club_id, name, status, guarantee_amount)
    VALUES (v_enabled, 'DRYRUN T1', 'completed', 100000000) RETURNING id INTO v_t1;
  INSERT INTO public.tournaments (club_id, name, status, guarantee_amount)
    VALUES (v_poison, 'DRYRUN Tp', 'completed', 100000000) RETURNING id INTO v_tp;
  INSERT INTO public.tournaments (club_id, name, status, guarantee_amount)
    VALUES (v_disabled, 'DRYRUN T2', 'completed', 50000000) RETURNING id INTO v_t2;
  INSERT INTO _ids VALUES ('t1', v_t1), ('tp', v_tp), ('t2', v_t2);

  -- fixture bullet the re-entry registration points at (satisfies tournament_registrations_source_entry_id_fkey).
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no)
    VALUES ('000000e2-0000-0000-0000-000000000000', v_t1, u1, 2);

  -- T1 confirmed: u1 (bullet1 = initial), u1 (bullet2 = re-entry), u2 (bullet1); u3 PENDING = excluded.
  -- Each carries a 200k platform_fixed_fee to prove prize_pool = SUM(buy_in) excludes the fee.
  -- NOTE: the live schema models a re-entry as a SECOND tournament_registrations row whose OWN
  -- source_entry_id is NON-NULL (the initial keeps source_entry_id NULL). Two NULL-source rows for one
  -- (tournament,player) would violate uniq_treg_active_initial — so DR-2 sets its source_entry_id. (Our
  -- capture keys off tournament_registrations.id, never off tr.source_entry_id, so this is fixture-only.)
  INSERT INTO public.tournament_registrations
    (tournament_id, player_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, committed_at, source_entry_id)
  VALUES
    (v_t1, u1, 1000000, 200000, 1200000, 'DR-1', 'confirmed', t0,                        NULL),
    (v_t1, u1, 1000000, 200000, 1200000, 'DR-2', 'confirmed', t0 + interval '1 minute',  '000000e2-0000-0000-0000-000000000000'),
    (v_t1, u2, 1000000, 200000, 1200000, 'DR-3', 'confirmed', t0 + interval '2 minute',  NULL),
    (v_t1, u3, 1000000, 200000, 1200000, 'DR-4', 'pending',   t0 + interval '3 minute',  NULL);

  -- poison Tp: 1 confirmed (would capture 1 if the club didn't error out -> proves rollback isolation).
  INSERT INTO public.tournament_registrations
    (tournament_id, player_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, committed_at)
  VALUES (v_tp, u1, 1000000, 0, 1000000, 'DR-P1', 'confirmed', t0);

  -- disabled T2: 1 confirmed (must remain uncaptured while the club is OFF).
  INSERT INTO public.tournament_registrations
    (tournament_id, player_id, buy_in, platform_fixed_fee, total_pay, reference_code, status, committed_at)
  VALUES (v_t2, u2, 1000000, 0, 1000000, 'DR-D1', 'confirmed', t0);

  ALTER TABLE public.clubs ENABLE TRIGGER trg_enforce_single_club_per_owner;
  ALTER TABLE public.clubs ENABLE TRIGGER trg_initialize_club_tables;
  ALTER TABLE public.tournaments ENABLE TRIGGER trg_tournament_audit;
  ALTER TABLE public.tournament_entries ENABLE TRIGGER trg_entries_registration_open;
END
$fix$;

-- POISON INJECTION (dry-run only): a BEFORE INSERT trigger that fails the poison club's actuals INSERT, so we
-- can prove per-club isolation + error-logging independently of any arithmetic. Rolled back with the transaction.
CREATE OR REPLACE FUNCTION public.dryrun_poison_actuals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.club_id = '0000dead-0000-0000-0000-00000000dead'::uuid THEN
    RAISE EXCEPTION 'dryrun: injected failure for club isolation test';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dryrun_poison_trg BEFORE INSERT ON public.series_event_actuals
  FOR EACH ROW EXECUTE FUNCTION public.dryrun_poison_actuals();

-- =====================================================================================================
-- RUN the global cron sync 3× (idempotency) + capture advisory-lock liveness.
-- =====================================================================================================
DO $run$
DECLARE v_locks int;
BEGIN
  PERFORM public.series_capture_autosync();  -- run 1
  PERFORM public.series_capture_autosync();  -- run 2 (no dupes)
  PERFORM public.series_capture_autosync();  -- run 3 (overlap re-entry; lock re-entrant)
  SELECT count(*) INTO v_locks FROM pg_locks WHERE locktype='advisory' AND pid = pg_backend_pid();
  INSERT INTO _dryrun_results VALUES
    ('G11_advisory_xact_locks', '>=1 advisory lock held (xact-scoped)', v_locks::text, v_locks >= 1);
END
$run$;

-- =====================================================================================================
-- BEHAVIORAL ASSERTIONS G1..G10 (privileged reads over the captured data + run-log).
-- =====================================================================================================
DO $g$
DECLARE
  v_t1 uuid := (SELECT v FROM _ids WHERE k='t1');
  v_tp uuid := (SELECT v FROM _ids WHERE k='tp');
  v_t2 uuid := (SELECT v FROM _ids WHERE k='t2');
  v_enabled uuid := (SELECT v FROM _ids WHERE k='enabled');
  v_poison  uuid := (SELECT v FROM _ids WHERE k='poison');
  u1 uuid := (SELECT v::uuid FROM _const WHERE k='u1');
  u1_hash text := (SELECT v FROM _const WHERE k='u1_hash');
  n int; n2 int; r record; a record;
BEGIN
  -- G1: 3 confirmed regs captured for T1 (pending u3 excluded).
  SELECT count(*) INTO n FROM public.series_registration_events WHERE event_id=v_t1;
  INSERT INTO _dryrun_results VALUES ('G1_confirmed_captured','T1 reg events = 3', n::text, n=3);

  -- G2: exactly one re-entry, bullet=2, belonging to u1.
  SELECT count(*) INTO n  FROM public.series_registration_events WHERE event_id=v_t1 AND is_reentry;
  SELECT count(*) INTO n2 FROM public.series_registration_events
    WHERE event_id=v_t1 AND is_reentry AND bullet=2 AND player_ref_hash=u1_hash;
  INSERT INTO _dryrun_results VALUES ('G2_reentry_bullet','1 reentry, bullet=2, player=u1', n::text||'/'||n2::text, n=1 AND n2=1);

  -- G3: actuals row for T1.
  SELECT * INTO a FROM public.series_event_actuals WHERE event_id=v_t1;
  INSERT INTO _dryrun_results VALUES ('G3_actuals_row',
    'entries=3 uniq=2 re=1 pool=3000000 overlay=97000000',
    coalesce('e='||a.actual_entries||' u='||a.actual_unique_players||' r='||a.actual_reentries||
             ' pool='||a.actual_prize_pool||' ov='||a.actual_overlay_amount,'<no row>'),
    a.actual_entries=3 AND a.actual_unique_players=2 AND a.actual_reentries=1
      AND a.actual_prize_pool=3000000 AND a.actual_overlay_amount=97000000);

  -- G4: prize_pool excludes the 200k/reg fee (3*1,000,000 = 3,000,000; NOT 3,600,000).
  INSERT INTO _dryrun_results VALUES ('G4_fee_excluded','prize_pool=3000000 (fee excluded)',
    coalesce(a.actual_prize_pool::text,'<no row>'), a.actual_prize_pool=3000000);

  -- G5: player hash == client vector + type app_user_id.
  SELECT count(*) INTO n FROM public.series_registration_events
    WHERE event_id=v_t1 AND player_ref_hash=u1_hash AND player_ref_type='app_user_id';
  INSERT INTO _dryrun_results VALUES ('G5_hash_and_type','u1 rows hashed to vector, type=app_user_id (>=1)', n::text, n>=1);

  -- G6: disabled club untouched (no regs, no actuals).
  SELECT count(*) INTO n  FROM public.series_registration_events WHERE event_id=v_t2;
  SELECT count(*) INTO n2 FROM public.series_event_actuals       WHERE event_id=v_t2;
  INSERT INTO _dryrun_results VALUES ('G6_disabled_untouched','disabled: regs=0 actuals=0', n::text||'/'||n2::text, n=0 AND n2=0);

  -- G7: poison club captured NOTHING (its subtransaction rolled back on the error).
  SELECT count(*) INTO n  FROM public.series_registration_events WHERE event_id=v_tp;
  SELECT count(*) INTO n2 FROM public.series_event_actuals       WHERE event_id=v_tp;
  INSERT INTO _dryrun_results VALUES ('G7_poison_rolled_back','poison: regs=0 actuals=0', n::text||'/'||n2::text, n=0 AND n2=0);

  -- G8: the poison error was LOGGED (>=1 cron run-log row, rows_errored>=1, error_sample present).
  SELECT count(*) INTO n FROM public.series_capture_runs
    WHERE club_id=v_poison AND scope='cron' AND rows_errored>=1 AND error_sample IS NOT NULL;
  INSERT INTO _dryrun_results VALUES ('G8_error_logged','poison error logged (>=1)', n::text, n>=1);

  -- G9: the good club logged a clean run (>=1 cron row, rows_errored=0).
  SELECT count(*) INTO n FROM public.series_capture_runs
    WHERE club_id=v_enabled AND scope='cron' AND rows_errored=0;
  INSERT INTO _dryrun_results VALUES ('G9_clean_run_logged','enabled clean run logged (>=1)', n::text, n>=1);

  -- G10: idempotent across the 3 runs — T1 still 3 regs, exactly 1 actuals row.
  SELECT count(*) INTO n  FROM public.series_registration_events WHERE event_id=v_t1;
  SELECT count(*) INTO n2 FROM public.series_event_actuals       WHERE event_id=v_t1;
  INSERT INTO _dryrun_results VALUES ('G10_idempotent','after 3 runs: regs=3, actuals rows=1', n::text||'/'||n2::text, n=3 AND n2=1);
END
$g$;

-- =====================================================================================================
-- MANUAL "Sync ngay" path M1..M2 (role switch) + read isolation I1.
-- =====================================================================================================
DO $m$
DECLARE
  v_owner uuid := (SELECT v FROM _fix WHERE k='owner');
  v_enabled uuid := (SELECT v FROM _ids WHERE k='enabled');
  v_rand uuid := '99999999-9999-9999-9999-999999999999';  -- guaranteed non-owner
  v_json jsonb;
  v_msg text;
  n int;
BEGIN
  -- M1: NON-owner calling the club sync must be rejected with 42501.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rand::text, 'role','authenticated')::text, true);
    PERFORM public.series_capture_autosync_club(v_enabled);
    RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
    INSERT INTO _dryrun_results VALUES ('M1_nonowner_rejected','rejected (42501)','ACCEPTED (LEAK!)', false);
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
      INSERT INTO _dryrun_results VALUES ('M1_nonowner_rejected','rejected (42501)','rejected: not_authorized', true);
    WHEN others THEN
      RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      INSERT INTO _dryrun_results VALUES ('M1_nonowner_rejected','rejected (42501)','WRONG-REASON: '||v_msg, false);
  END;

  -- M2: OWNER calling the club sync is accepted (ok=true), idempotent, writes a 'manual' run-log row.
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role','authenticated')::text, true);
    SELECT public.series_capture_autosync_club(v_enabled) INTO v_json;
    RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
    INSERT INTO _dryrun_results VALUES ('M2_owner_accepted','ok=true', coalesce(v_json->>'ok','<null>'), (v_json->>'ok')='true');
  EXCEPTION WHEN others THEN
    RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    INSERT INTO _dryrun_results VALUES ('M2_owner_accepted','ok=true','REJECTED: '||v_msg, false);
  END;

  SELECT count(*) INTO n FROM public.series_capture_runs WHERE club_id=v_enabled AND scope='manual';
  INSERT INTO _dryrun_results VALUES ('M2b_manual_run_logged','manual run-log row (>=1)', n::text, n>=1);

  -- I1: owner-scoped read isolation on series_event_actuals (owner sees own; a non-owner sees 0).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text,'role','authenticated')::text, true);
  SELECT count(*) INTO n FROM public.series_event_actuals WHERE club_id=v_enabled;
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
  DECLARE n_foreign int;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_rand::text,'role','authenticated')::text, true);
    SELECT count(*) INTO n_foreign FROM public.series_event_actuals WHERE club_id=v_enabled;
    RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
    INSERT INTO _dryrun_results VALUES ('I1_actuals_isolation','owner>=1 & non-owner=0', 'owner='||n||' other='||n_foreign, n>=1 AND n_foreign=0);
  END;
END
$m$;

-- =====================================================================================================
-- STRUCTURAL S1..S4 + hash parity H1 (privileged catalog reads; never abort).
-- =====================================================================================================
DO $s$
DECLARE
  v_col_exists boolean;
  v_idx_exists boolean;
  u1_hash text := (SELECT v FROM _const WHERE k='u1_hash');
  v_server_hash text;
BEGIN
  -- S1: new tables + source_entry_id column + unique index all present.
  v_col_exists := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='series_registration_events' AND column_name='source_entry_id');
  v_idx_exists := to_regclass('public.uq_sre_source_entry') IS NOT NULL;
  INSERT INTO _dryrun_results VALUES ('S1_new_objects','3 tables + column + unique index exist',
    'actuals='||(to_regclass('public.series_event_actuals') IS NOT NULL)::text||
    ' settings='||(to_regclass('public.series_capture_settings') IS NOT NULL)::text||
    ' runs='||(to_regclass('public.series_capture_runs') IS NOT NULL)::text||
    ' col='||v_col_exists::text||' idx='||v_idx_exists::text,
    to_regclass('public.series_event_actuals') IS NOT NULL
      AND to_regclass('public.series_capture_settings') IS NOT NULL
      AND to_regclass('public.series_capture_runs') IS NOT NULL
      AND v_col_exists AND v_idx_exists);

  -- S2: RLS enabled on the 3 new tables.
  INSERT INTO _dryrun_results
  SELECT 'S2_rls_enabled','relrowsecurity=true on all 3', bool_and(relrowsecurity)::text, bool_and(relrowsecurity)
  FROM pg_class WHERE oid IN (
    'public.series_event_actuals'::regclass,'public.series_capture_settings'::regclass,'public.series_capture_runs'::regclass);

  -- S3: grant shape — actuals/runs SELECT-only (no I/U/D); settings SELECT+INSERT+UPDATE, no DELETE; no DELETE anywhere.
  INSERT INTO _dryrun_results VALUES ('S3_grant_shape','actuals/runs read-only; settings owner-writable; no DELETE',
    'actualsSEL='||has_table_privilege('authenticated','public.series_event_actuals','SELECT')::text||
    ' actualsINS='||has_table_privilege('authenticated','public.series_event_actuals','INSERT')::text||
    ' settingsUPD='||has_table_privilege('authenticated','public.series_capture_settings','UPDATE')::text||
    ' settingsDEL='||has_table_privilege('authenticated','public.series_capture_settings','DELETE')::text,
    has_table_privilege('authenticated','public.series_event_actuals','SELECT')
    AND NOT has_table_privilege('authenticated','public.series_event_actuals','INSERT')
    AND NOT has_table_privilege('authenticated','public.series_event_actuals','UPDATE')
    AND NOT has_table_privilege('authenticated','public.series_event_actuals','DELETE')
    AND has_table_privilege('authenticated','public.series_capture_runs','SELECT')
    AND NOT has_table_privilege('authenticated','public.series_capture_runs','INSERT')
    AND NOT has_table_privilege('authenticated','public.series_capture_runs','DELETE')
    AND has_table_privilege('authenticated','public.series_capture_settings','SELECT')
    AND has_table_privilege('authenticated','public.series_capture_settings','INSERT')
    AND has_table_privilege('authenticated','public.series_capture_settings','UPDATE')
    AND NOT has_table_privilege('authenticated','public.series_capture_settings','DELETE'));

  -- S4: function security — all 3 SECURITY DEFINER + search_path pinned; EXECUTE revoked from PUBLIC on the
  --     system fns (global + internal) and granted on the _club fn (authenticated).
  INSERT INTO _dryrun_results VALUES ('S4_func_security',
    'defsec+searchpath; authd EXEC: _club=yes global=no internal=no',
    'club_exec='||has_function_privilege('authenticated','public.series_capture_autosync_club(uuid)','EXECUTE')::text||
    ' global_exec='||has_function_privilege('authenticated','public.series_capture_autosync()','EXECUTE')::text||
    ' internal_exec='||has_function_privilege('authenticated','public.series_capture_sync_one_club(uuid,integer)','EXECUTE')::text,
    (SELECT bool_and(p.prosecdef) FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
       WHERE nsp.nspname='public' AND p.proname IN
       ('series_capture_autosync','series_capture_autosync_club','series_capture_sync_one_club'))
    AND (SELECT bool_and(array_to_string(p.proconfig,',') LIKE '%search_path=%')
         FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
         WHERE nsp.nspname='public' AND p.proname IN
         ('series_capture_autosync','series_capture_autosync_club','series_capture_sync_one_club'))
    AND has_function_privilege('authenticated','public.series_capture_autosync_club(uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.series_capture_autosync()','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.series_capture_sync_one_club(uuid,integer)','EXECUTE'));

  -- H1: server hash of the vector == the client constant (byte-for-byte parity).
  v_server_hash := encode(extensions.digest(lower(trim('11111111-1111-1111-1111-111111111111')), 'sha256'), 'hex');
  INSERT INTO _dryrun_results VALUES ('H1_hash_parity','server hash == client vector', left(v_server_hash,16)||'…', v_server_hash = u1_hash);
END
$s$;

-- F1 regression: the overlay clamp must absorb an out-of-bigint-range GTD (numeric math + clamp) instead of
-- raising 22003. Exercises the exact expression from series_capture_sync_one_club section (b).
DO $clamp$
DECLARE v bigint; v_ok boolean := true; v_msg text;
BEGIN
  BEGIN
    v := LEAST(GREATEST(0::numeric, 1e30::numeric - 0::numeric), 9223372036854775807::numeric)::bigint;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT; v_ok := false;
  END;
  INSERT INTO _dryrun_results VALUES ('F1_overflow_clamped', '1e30 GTD clamps to bigint max, no 22003',
    CASE WHEN v_ok THEN v::text ELSE 'RAISED: ' || v_msg END, v_ok AND v = 9223372036854775807);
END
$clamp$;

-- =====================================================================================================
-- THE ONE RETURNED RESULT SET — full pass/fail matrix. A clean run = every verdict 'PASS'.
-- =====================================================================================================
SELECT check_name, CASE WHEN pass THEN 'PASS' ELSE 'FAIL' END AS verdict, expected, got
FROM _dryrun_results ORDER BY check_name;

-- =====================================================================================================
-- UNDO EVERYTHING — no DDL, no data, no advisory locks, no role/claims persist.
-- (Then run the liveness probe to confirm: the 3 new tables' to_regclass MUST be NULL.)
-- =====================================================================================================
ROLLBACK;
