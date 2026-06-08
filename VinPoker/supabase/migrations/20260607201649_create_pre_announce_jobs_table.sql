-- Phase 5 PR #2: BUG #2 (no duplicate pre-announce) + Gap #1 (DB queue) + Gap #3 (timeout/retry)
-- Creates pre_announce_jobs table for reliable, retryable Telegram delivery
-- Solves: in-memory queue lost on crash, duplicate Telegrams, no retry on failure

CREATE TABLE IF NOT EXISTS public.pre_announce_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL,
  table_id UUID NOT NULL,
  assignment_id UUID NOT NULL,
  attendance_id UUID NOT NULL,
  out_attendance_id UUID,
  table_name TEXT NOT NULL,
  zone TEXT,
  in_dealer_name TEXT NOT NULL,
  in_dealer_username TEXT,
  out_dealer_name TEXT,
  out_dealer_username TEXT,
  swing_at TIMESTAMPTZ NOT NULL,
  minutes_left INT NOT NULL,
  rest_deficit_min INT NOT NULL DEFAULT 0,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pre_announce_active
  ON public.pre_announce_jobs (club_id, attendance_id, table_id)
  WHERE status IN ('pending', 'processing', 'sent');

CREATE INDEX IF NOT EXISTS idx_pre_announce_jobs_pending_expires
  ON public.pre_announce_jobs (status, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pre_announce_jobs_pending_created
  ON public.pre_announce_jobs (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pre_announce_jobs_table
  ON public.pre_announce_jobs (table_id, status);

CREATE INDEX IF NOT EXISTS idx_pre_announce_jobs_club_attendance
  ON public.pre_announce_jobs (club_id, attendance_id);

CREATE INDEX IF NOT EXISTS idx_pre_announce_jobs_failure
  ON public.pre_announce_jobs (status, last_attempt_at)
  WHERE status = 'failed';

ALTER TABLE public.pre_announce_jobs ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.pre_announce_jobs TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION public.bump_pre_announce_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_pre_announce_jobs_updated_at ON public.pre_announce_jobs;
CREATE TRIGGER trg_bump_pre_announce_jobs_updated_at
  BEFORE UPDATE ON public.pre_announce_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_pre_announce_jobs_updated_at();

COMMENT ON TABLE public.pre_announce_jobs IS
  'Phase 5 PR #2 BUG #2 fix: DB-backed queue for pre-announce Telegram notifications.
   Idempotency via uq_pre_announce_active partial unique index.
   Retry via attempts/max_attempts + last_error.
   Cleanup via expires_at + status=failed/cancelled.';
