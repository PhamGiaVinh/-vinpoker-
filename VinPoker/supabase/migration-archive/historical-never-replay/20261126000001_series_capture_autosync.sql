-- Series Intelligence — CAPTURE autosync (server-side, fully-automatic capture from real tournament data).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. The owner reads the SQL and applies it later in a
-- controlled session (`supabase db query --linked --file`, NOT `db push` / not deploy_db), then regen types.ts
-- in a SEPARATE step. schema_migrations is NOT touched by the controlled apply.
--
-- WHY: CAPTURE v0 (20261125000000) stood up the 4 owner-scoped tables + the manual console. The owner wants
--   capture to happen AUTOMATICALLY from real data — confirmed registrations become funnel rows, and finished
--   events get their actuals recorded — without any human typing. Forecasts stay a SUGGESTION only (client
--   prefill); the server never fabricates a human judgment.
--
-- ARCHITECTURE (locked by owner review):
--   * pg_cron periodic sync (every 10 min), NEVER an AFTER-trigger on the hot cashier/tournament paths — a
--     capture error must never roll back a live registration confirm. Kill-switch is PER-CLUB and DEFAULT OFF.
--   * Actuals live in their OWN system table (series_event_actuals) — series_decision_logs (the human
--     learning-loop) stays append-only and UNTOUCHED. No '[auto]' sentinel rows anywhere.
--   * Idempotent: registrations use a provenance key (source_entry_id) + partial UNIQUE + ON CONFLICT DO
--     NOTHING; actuals UPSERT-recompute per event (late payouts/corrections are re-picked-up). An
--     xact-scoped advisory lock serialises overlapping ticks; a bounded LIMIT per run keeps the first-enable
--     backfill from overrunning a tick.
--   * Errors are LOGGED (series_capture_runs), never swallowed — one bad club never aborts the others.
--   * SECURITY DEFINER hardened: search_path pinned, EXECUTE revoked from PUBLIC on the system fns; the UI
--     "Sync ngay" fn is owner-checked and only ever touches ONE owned club (never the global cross-club job).
--
-- PRIVACY (inherited from v0, locked): series_registration_events.player_ref_hash MUST be an opaque hash.
--   The autosync hashes player_id EXACTLY as the client hashPlayerRef() does — SHA-256 hex of
--   lower(trim(player_id::text)) — so the same person reconciles across the auto + manual paths.
--   player_ref_type='app_user_id' marks this identity space (auto). Manual phone/host_label rows are a
--   DIFFERENT space and do not cross-reconcile (by design; player_ref_type distinguishes them).
--   Shared test vector (asserted client-side in hashPlayerRef.test.ts AND in the dry-run):
--     '11111111-1111-1111-1111-111111111111' -> 'bafde89c041e1756082b933aaf16cad8e65dec48de748479352f657e89dd6da5'
--
-- PRIZE vs FEE (owner review P1-5): prize_pool = SUM(tournament_registrations.buy_in) over CONFIRMED rows =
--   the prize portion. platform_fixed_fee / total_pay are SEPARATE columns and are NOT summed here. This is
--   byte-identical to the authoritative get_tournament_prize_pool / get_club_series_events RPCs (which also
--   filter status='confirmed'). overlay = max(0, guarantee_amount - prize_pool).
--
-- Additive + idempotent: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY IF EXISTS before
--   CREATE, CREATE OR REPLACE FUNCTION. A future gated re-apply is a safe no-op. Every object is additive so
--   the ROLLBACK block at the foot is a clean DROP.

-- ===========================================================================================
-- 1. series_event_actuals — one SYSTEM-owned row per finished event (UPSERT-recompute).
--    Decision_logs is append-only, so post-event ground truth goes HERE (owner review P0-3).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.series_event_actuals (
  event_id              uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id               uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  actual_entries        integer NOT NULL DEFAULT 0,
  actual_unique_players integer NOT NULL DEFAULT 0,
  actual_reentries      integer NOT NULL DEFAULT 0,
  actual_prize_pool     bigint  NOT NULL DEFAULT 0,   -- SUM(buy_in) confirmed = prize portion (fees excluded)
  actual_overlay_amount bigint  NOT NULL DEFAULT 0,   -- max(0, guarantee_amount - prize_pool)
  source                text    NOT NULL DEFAULT 'autosync',
  captured_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sea_nonneg CHECK (
    actual_entries >= 0 AND actual_unique_players >= 0 AND actual_reentries >= 0
    AND actual_prize_pool >= 0 AND actual_overlay_amount >= 0),
  CONSTRAINT sea_reentries_chk CHECK (actual_reentries = actual_entries - actual_unique_players)
);
CREATE INDEX IF NOT EXISTS idx_sea_club ON public.series_event_actuals(club_id);

-- ===========================================================================================
-- 2. series_registration_events.source_entry_id — provenance key for idempotent auto-capture.
--    One captured row per CONFIRMED tournament_registrations.id (owner review P1-4). Manual rows
--    keep source_entry_id NULL (partial index → they never collide with auto rows).
-- ===========================================================================================
ALTER TABLE public.series_registration_events
  ADD COLUMN IF NOT EXISTS source_entry_id uuid;   -- = tournament_registrations.id (no FK: keeps the
                                                   -- cross-module coupling as loose as v0 did)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sre_source_entry
  ON public.series_registration_events(source_entry_id)
  WHERE source_entry_id IS NOT NULL;

-- ===========================================================================================
-- 3. series_capture_settings — per-club kill-switch (DEFAULT OFF), owner-scoped RLS.
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.series_capture_settings (
  club_id          uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  autosync_enabled boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid DEFAULT auth.uid()
);

-- ===========================================================================================
-- 4. series_capture_runs — run-log. Every sync (cron OR manual) writes one row; every EXCEPTION
--    writes a row too (owner review P1-8 — errors are logged, never swallowed).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.series_capture_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                timestamptz NOT NULL DEFAULT now(),
  club_id               uuid,               -- nullable: a global-scope error may have no club
  scope                 text NOT NULL,      -- 'cron' | 'manual'
  rows_reg_captured     integer NOT NULL DEFAULT 0,
  rows_actuals_upserted integer NOT NULL DEFAULT 0,
  rows_errored          integer NOT NULL DEFAULT 0,
  error_sample          text
);
CREATE INDEX IF NOT EXISTS idx_scr_club ON public.series_capture_runs(club_id, run_at DESC);

-- ===========================================================================================
-- 5. RLS — owner-scoped reads. The system tables are written ONLY by the SECURITY DEFINER sync
--    functions (which run as the table owner and bypass RLS); authenticated NEVER writes actuals
--    or the run-log. series_capture_settings is owner-writable (the toggle).
-- ===========================================================================================
ALTER TABLE public.series_event_actuals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_capture_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_capture_runs     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.series_event_actuals    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_capture_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.series_capture_runs     FROM PUBLIC, anon, authenticated;

GRANT SELECT                 ON public.series_event_actuals    TO authenticated;  -- read-only for the UI
GRANT SELECT, INSERT, UPDATE ON public.series_capture_settings TO authenticated;  -- owner toggles autosync
GRANT SELECT                 ON public.series_capture_runs     TO authenticated;  -- read-only "last sync"

-- 5.1 series_event_actuals — owner SELECT only.
DROP POLICY IF EXISTS sea_select ON public.series_event_actuals;
CREATE POLICY sea_select ON public.series_event_actuals
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

-- 5.2 series_capture_settings — owner SELECT/INSERT/UPDATE (the per-club toggle). No DELETE.
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

-- 5.3 series_capture_runs — owner SELECT only (their club's rows).
DROP POLICY IF EXISTS scr_select ON public.series_capture_runs;
CREATE POLICY scr_select ON public.series_capture_runs
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

-- ===========================================================================================
-- 6. SYNC LOGIC. One internal worker + two public entry points.
--    All three: SECURITY DEFINER, search_path pinned to public, pg_catalog.
-- ===========================================================================================

-- 6.1 series_capture_sync_one_club(club, limit) — the INTERNAL worker. Captures un-recorded confirmed
--     registrations (bounded) + UPSERTs actuals for finished events, for ONE club. Not callable by clients.
CREATE OR REPLACE FUNCTION public.series_capture_sync_one_club(
  p_club_id uuid,
  p_limit   integer DEFAULT 500,
  OUT rows_reg     integer,
  OUT rows_actuals integer
)
RETURNS record
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  rows_reg := 0;
  rows_actuals := 0;

  -- (a) Registration funnel capture — one row per un-captured CONFIRMED registration, bounded by p_limit.
  --     bullet_no is computed over the FULL confirmed set per (event,player) so chunked backfill stays
  --     correct; then we insert only rows not already captured. player hash == client hashPlayerRef().
  --     APPEND-ONLY JOURNAL: a registration captured here is NEVER revised if it later cancels/refunds
  --     (status flips off 'confirmed'). This funnel records the historical fact "an entry committed"; it is
  --     NOT the authoritative live count. The authoritative, cancellation-aware totals are series_event_actuals
  --     (recomputed over live status='confirmed' each run) and the get_*_series_events / prize_pool RPCs.
  WITH ranked AS (
    SELECT tr.id            AS reg_id,
           t.id             AS event_id,
           t.club_id        AS club_id,
           tr.player_id     AS player_id,
           tr.committed_at  AS committed_at,
           row_number() OVER (PARTITION BY tr.tournament_id, tr.player_id
                              ORDER BY tr.committed_at, tr.id) AS bullet_no
    FROM public.tournament_registrations tr
    JOIN public.tournaments t ON t.id = tr.tournament_id
    WHERE t.club_id = p_club_id
      AND t.deleted_at IS NULL
      AND tr.status = 'confirmed'
  ),
  todo AS (
    SELECT r.*
    FROM ranked r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.series_registration_events e WHERE e.source_entry_id = r.reg_id
    )
    ORDER BY r.committed_at, r.reg_id
    LIMIT GREATEST(p_limit, 0)
  ),
  ins AS (
    INSERT INTO public.series_registration_events
      (club_id, event_id, player_ref_hash, player_ref_type, registered_at,
       is_reentry, bullet, commitment_stage, source_entry_id)
    SELECT td.club_id,
           td.event_id,
           encode(extensions.digest(lower(trim(td.player_id::text)), 'sha256'), 'hex'),
           'app_user_id',
           td.committed_at,
           (td.bullet_no > 1),
           LEAST(td.bullet_no, 32767)::smallint,
           'paid',
           td.reg_id
    FROM todo td
    -- partial unique index uq_sre_source_entry is defined WHERE source_entry_id IS NOT NULL, so the
    -- ON CONFLICT arbiter MUST repeat that predicate to match it (all inserted rows have it non-null).
    ON CONFLICT (source_entry_id) WHERE source_entry_id IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int INTO rows_reg FROM ins;

  -- (b) Actuals UPSERT-recompute for FINISHED events (status='completed'). Same figures as the
  --     get_tournament_prize_pool / get_club_series_events RPCs (confirmed grain). Recompute each run so a
  --     late payout/correction is re-picked-up (owner review P2-11).
  WITH agg AS (
    SELECT t.id AS event_id, t.club_id, t.guarantee_amount,
           coalesce(a.total, 0)                     AS total,
           coalesce(a.uniq, 0)                      AS uniq,
           coalesce(a.pool, 0)                      AS pool
    FROM public.tournaments t
    LEFT JOIN LATERAL (
      SELECT count(*)                        AS total,
             count(distinct tr.player_id)    AS uniq,
             coalesce(sum(tr.buy_in), 0)     AS pool
      FROM public.tournament_registrations tr
      WHERE tr.tournament_id = t.id
        AND tr.status = 'confirmed'
    ) a ON true
    WHERE t.club_id = p_club_id
      AND t.deleted_at IS NULL
      AND t.status = 'completed'
  ),
  up AS (
    INSERT INTO public.series_event_actuals
      (event_id, club_id, actual_entries, actual_unique_players, actual_reentries,
       actual_prize_pool, actual_overlay_amount, source, captured_at)
    SELECT agg.event_id, agg.club_id,
           agg.total::int, agg.uniq::int, (agg.total - agg.uniq)::int,
           -- guarantee_amount is an UNBOUNDED, un-CHECK'd numeric (owner/floor-entered): a fat-fingered GTD past
           -- the bigint ceiling would raise 22003 in the ::bigint cast and — since capture + actuals share one
           -- subtransaction — roll back the whole club's capture every tick. So do the math in numeric and clamp
           -- to [0, bigint max] BEFORE the cast. pool = SUM(buy_in) is also clamped for the same reason.
           LEAST(agg.pool, 9223372036854775807::numeric)::bigint,
           LEAST(GREATEST(0::numeric, coalesce(agg.guarantee_amount, 0) - agg.pool), 9223372036854775807::numeric)::bigint,
           'autosync', now()
    FROM agg
    ON CONFLICT (event_id) DO UPDATE SET
      actual_entries        = EXCLUDED.actual_entries,
      actual_unique_players = EXCLUDED.actual_unique_players,
      actual_reentries      = EXCLUDED.actual_reentries,
      actual_prize_pool     = EXCLUDED.actual_prize_pool,
      actual_overlay_amount = EXCLUDED.actual_overlay_amount,
      source                = EXCLUDED.source,
      captured_at           = EXCLUDED.captured_at
    RETURNING 1
  )
  SELECT count(*)::int INTO rows_actuals FROM up;
END;
$$;
REVOKE ALL ON FUNCTION public.series_capture_sync_one_club(uuid, integer) FROM PUBLIC, anon, authenticated;

-- 6.2 series_capture_autosync() — GLOBAL cron entry point. Loops enabled clubs, each isolated so one bad
--     club never aborts the rest; every club (ok OR error) writes a run-log row. NOT client-callable.
CREATE OR REPLACE FUNCTION public.series_capture_autosync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  rec record;
  v_reg int;
  v_act int;
BEGIN
  FOR rec IN
    SELECT club_id FROM public.series_capture_settings WHERE autosync_enabled ORDER BY club_id
  LOOP
    BEGIN
      -- per-club xact lock: serialises against another tick OR a manual "Sync ngay" on the same club.
      PERFORM pg_advisory_xact_lock(778201, hashtext(rec.club_id::text));
      SELECT s.rows_reg, s.rows_actuals INTO v_reg, v_act
      FROM public.series_capture_sync_one_club(rec.club_id, 500) s;
      INSERT INTO public.series_capture_runs
        (club_id, scope, rows_reg_captured, rows_actuals_upserted, rows_errored)
        VALUES (rec.club_id, 'cron', coalesce(v_reg, 0), coalesce(v_act, 0), 0);
    EXCEPTION WHEN others THEN
      -- subtransaction rolled back this club's partial work; log and continue with the next club.
      INSERT INTO public.series_capture_runs (club_id, scope, rows_errored, error_sample)
        VALUES (rec.club_id, 'cron', 1, left(SQLERRM, 500));
    END;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.series_capture_autosync() FROM PUBLIC, anon, authenticated;

-- 6.3 series_capture_autosync_club(club) — UI "Sync ngay". Owner-checked; touches ONE owned club only;
--     NEVER the global cross-club job (owner review P0-2c). Returns a small json for the client.
CREATE OR REPLACE FUNCTION public.series_capture_autosync_club(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reg int;
  v_act int;
BEGIN
  IF p_club_id IS NULL OR NOT public.is_club_owner(auth.uid(), p_club_id) THEN
    RAISE EXCEPTION 'not_authorized' USING errcode = '42501';
  END IF;
  -- NON-BLOCKING: the interactive "Sync ngay" must never hang. If a cron tick (or another manual sync) already
  -- holds this club's lock, return busy immediately so the UI can say "đang đồng bộ nền, thử lại" instead of
  -- waiting on the whole cron pass. (Re-entrant within the same session, so the dry-run's own prior ticks are OK.)
  IF NOT pg_try_advisory_xact_lock(778201, hashtext(p_club_id::text)) THEN
    RETURN jsonb_build_object('ok', false, 'busy', true, 'run_at', now());
  END IF;
  SELECT s.rows_reg, s.rows_actuals INTO v_reg, v_act
  FROM public.series_capture_sync_one_club(p_club_id, 500) s;
  INSERT INTO public.series_capture_runs
    (club_id, scope, rows_reg_captured, rows_actuals_upserted, rows_errored)
    VALUES (p_club_id, 'manual', coalesce(v_reg, 0), coalesce(v_act, 0), 0);
  RETURN jsonb_build_object(
    'ok', true,
    'busy', false,
    'rows_reg', coalesce(v_reg, 0),
    'rows_actuals', coalesce(v_act, 0),
    'run_at', now()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.series_capture_autosync_club(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.series_capture_autosync_club(uuid) TO authenticated;

-- ===========================================================================================
-- 7. SCHEDULE — pg_cron every 10 min. Safe no-op while all clubs are OFF (loop body never runs).
--    Idempotent (unschedule-if-exists, then schedule). Guarded so it is skipped if pg_cron is absent.
--    The gated apply session may instead leave this commented and schedule manually — either is fine.
-- ===========================================================================================
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'series-capture-autosync') THEN
      PERFORM cron.unschedule('series-capture-autosync');
    END IF;
    PERFORM cron.schedule('series-capture-autosync', '*/10 * * * *',
                          'SELECT public.series_capture_autosync();');
  END IF;
END;
$cron$;

-- ===========================================================================================
-- ROLLBACK (undo this migration) — all objects additive; safe to drop:
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')
--        AND EXISTS (SELECT 1 FROM cron.job WHERE jobname='series-capture-autosync')
--     THEN PERFORM cron.unschedule('series-capture-autosync'); END IF;
--   END $$;
--   DROP FUNCTION IF EXISTS public.series_capture_autosync_club(uuid);
--   DROP FUNCTION IF EXISTS public.series_capture_autosync();
--   DROP FUNCTION IF EXISTS public.series_capture_sync_one_club(uuid, integer);
--   DROP TABLE IF EXISTS public.series_capture_runs;
--   DROP TABLE IF EXISTS public.series_capture_settings;
--   DROP TABLE IF EXISTS public.series_event_actuals;
--   DROP INDEX IF EXISTS public.uq_sre_source_entry;
--   ALTER TABLE public.series_registration_events DROP COLUMN IF EXISTS source_entry_id;
--   -- (soft kill-switch without a drop: UPDATE public.series_capture_settings SET autosync_enabled=false;)
-- ===========================================================================================
