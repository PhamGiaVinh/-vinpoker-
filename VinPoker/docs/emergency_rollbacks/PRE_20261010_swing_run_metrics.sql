-- EMERGENCY ROLLBACK — C3 swing_run_metrics (migration 20261010000000)
--
-- 20261010000000 is purely additive: one NEW telemetry table. It touches no existing object/data.
-- process-swing writes to it best-effort (try/catch → non-fatal) and also emits the same data as a
-- structured log line, so dropping the table cannot affect swing behavior.

DROP TABLE IF EXISTS public.swing_run_metrics;
