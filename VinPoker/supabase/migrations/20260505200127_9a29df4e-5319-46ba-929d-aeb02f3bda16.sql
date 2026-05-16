
-- Soft-hide cho tournaments sau 24h kể từ start_time (bảng không có end_date)
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_tournaments_deleted_at ON public.tournaments(deleted_at);

-- Function ẩn tournaments quá hạn 24h
CREATE OR REPLACE FUNCTION public.auto_soft_delete_old_tournaments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cnt integer := 0;
BEGIN
  WITH upd AS (
    UPDATE public.tournaments
    SET deleted_at = now(), updated_at = now()
    WHERE deleted_at IS NULL
      AND start_time IS NOT NULL
      AND start_time < (now() - INTERVAL '24 hours')
    RETURNING 1
  )
  SELECT count(*) INTO cnt FROM upd;
  RETURN cnt;
END;
$$;

-- Enable pg_cron + schedule mỗi giờ
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-soft-delete-old-tournaments') THEN
    PERFORM cron.unschedule('auto-soft-delete-old-tournaments');
  END IF;
END $$;

SELECT cron.schedule(
  'auto-soft-delete-old-tournaments',
  '0 * * * *',
  $$ SELECT public.auto_soft_delete_old_tournaments(); $$
);

-- Backfill ngay lập tức
SELECT public.auto_soft_delete_old_tournaments();
