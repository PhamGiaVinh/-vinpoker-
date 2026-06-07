-- Phase 6 (Day 0 monitoring setup): cron_metrics table for observability
-- Records each cron tick with duration, status, error count, processed count

CREATE TABLE IF NOT EXISTS public.cron_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,
  club_id UUID,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'partial')),
  error_count INTEGER NOT NULL DEFAULT 0,
  processed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_metrics_cron_name
  ON public.cron_metrics (cron_name, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_metrics_club_id
  ON public.cron_metrics (club_id, executed_at DESC)
  WHERE club_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cron_metrics_failure
  ON public.cron_metrics (executed_at DESC)
  WHERE status = 'failure';

COMMENT ON TABLE public.cron_metrics IS 'Phase 5 monitoring: logs each cron tick with duration, status, errors';
COMMENT ON COLUMN public.cron_metrics.cron_name IS 'Edge function name (e.g., process-swing, process-pre-announce-jobs)';
COMMENT ON COLUMN public.cron_metrics.duration_ms IS 'Total execution time in milliseconds';
COMMENT ON COLUMN public.cron_metrics.status IS 'success | failure | partial (some succeeded, some failed)';
COMMENT ON COLUMN public.cron_metrics.processed_count IS 'Number of items processed (e.g., dealers picked, jobs fired)';

GRANT SELECT, INSERT ON public.cron_metrics TO anon, authenticated, service_role;
