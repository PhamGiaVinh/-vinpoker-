-- ═══════════════════════════════════════════════════════════════════════════
-- C3 — swing_run_metrics: per-run trace + per-pass durations (SOURCE-ONLY; apply later)
-- Date: 2026-10-10
--
-- WHY: process-swing logs are unstructured console output with no run correlation or per-pass
--   timing — you can't tell which pass (0c/1/1b/R/3/…) ate the budget, or correlate one club-run's
--   events. C3 adds a per-club-run trace_id + per-pass durations, written best-effort each run.
--   process-swing also emits a structured `run_metrics trace=… club=… total_ms=… {pass:ms}` log,
--   so observability works even before this table is applied (the insert just no-ops on absence).
--
-- SHAPE: one row per club-run. pass_durations = jsonb {pass0c: ms, pass1: ms, …} (ms spent from
--   each mark to the next). total_ms = run_start→run_end. lock_token ties back to the B2 lease.
--
-- SECURITY: service_role-only (process-swing writes via the service-role key). RLS ENABLED with NO
--   policy (service_role bypasses RLS) + grants stripped from anon/authenticated → internal telemetry.
--   A future read RPC (C2-style, club-scoped) can surface it to operators; not exposed directly here.
--
-- RETENTION: ~1 row/club/minute → schedule a prune cron at apply time (mirror cleanup-locks-pass1b /
--   cleanup-pre_announce-jobs), e.g. delete WHERE created_at < now() - interval '14 days'. Not
--   auto-pruned per-insert (avoids a scan on the hot path).
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Additive + idempotent.
--   Apply = separate owner-gated controlled op. Rollback: PRE_20261010_swing_run_metrics.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.swing_run_metrics (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id       uuid        NOT NULL,
  club_id        uuid,
  total_ms       integer,
  pass_durations jsonb,
  lock_token     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swing_run_metrics_club_created
  ON public.swing_run_metrics (club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swing_run_metrics_trace
  ON public.swing_run_metrics (trace_id);

ALTER TABLE public.swing_run_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.swing_run_metrics FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.swing_run_metrics TO service_role;

COMMENT ON TABLE public.swing_run_metrics IS
  'C3: per-club-run process-swing telemetry — trace_id correlation + per-pass durations (jsonb).
   service_role-only (internal). Written best-effort each run; prune via a retention cron.';

COMMIT;
