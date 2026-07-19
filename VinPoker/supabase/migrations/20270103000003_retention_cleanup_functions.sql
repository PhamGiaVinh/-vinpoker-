-- ============================================================================
-- 20270103000003_retention_cleanup_functions.sql
--
-- Source-only bounded retention helpers. This migration DEFINES functions but
-- schedules nothing. Every delete is capped at 5,000 rows per transaction and
-- uses SKIP LOCKED so cleanup cannot wait behind active operational work.
--
-- Retention:
--   dealer_rotation_schedule.superseded                 24 hours
--   dealer_rotation_schedule.executed/cancelled/no_show 90 days
--   cron.job_run_details (finished only)                 7 days
--   diagnostic_logs                                      7 days
--   cron_metrics (one cron_name per transaction)         30 days
--
-- predicted/announced/executing rotation rows and running/connecting cron rows
-- are never eligible.
--
-- OWNER-GATED APPLY. Do not apply autonomously.
--
-- ROLLBACK (owner-gated): unschedule the four retention jobs first (see the
-- follow-up schedule migration), then DROP only the functions created here.
-- Deleting source functions does not restore rows already removed; backup and
-- the 24-hour observation gate are mandatory before activation.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_dealer_rotation_schedule(
  p_club_id uuid,
  p_batch_size int DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit   int := LEAST(GREATEST(COALESCE(p_batch_size, 5000), 1), 5000);
  v_deleted int := 0;
BEGIN
  IF p_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'error', 'detail', 'club_id is required');
  END IF;

  WITH candidates AS (
    SELECT s.id
    FROM public.dealer_rotation_schedule AS s
    WHERE s.club_id = p_club_id
      AND (
        (s.status = 'superseded'
         AND s.planned_relief_at < now() - interval '24 hours')
        OR
        (s.status IN ('executed', 'cancelled', 'no_show')
         AND s.planned_relief_at < now() - interval '90 days')
      )
    ORDER BY s.planned_relief_at, s.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.dealer_rotation_schedule AS target
  USING candidates
  WHERE target.id = candidates.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_deleted = 0 THEN 'no_work' ELSE 'ok' END,
    'club_id', p_club_id,
    'deleted', v_deleted,
    'batch_cap', v_limit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_next_dealer_rotation_schedule(
  p_batch_size int DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit   int := LEAST(GREATEST(COALESCE(p_batch_size, 5000), 1), 5000);
  v_club_id uuid;
BEGIN
  -- Two bounded index probes per club use idx_rotation_due's
  -- (club_id, status, planned_relief_at) leading columns. This avoids a global
  -- scan of the large schedule table just to choose the next club.
  SELECT c.id INTO v_club_id
  FROM public.clubs AS c
  CROSS JOIN LATERAL (
    SELECT eligible.planned_relief_at AS oldest_eligible
    FROM (
      (
        SELECT s.planned_relief_at
        FROM public.dealer_rotation_schedule AS s
        WHERE s.club_id = c.id
          AND s.status = 'superseded'
          AND s.planned_relief_at < now() - interval '24 hours'
        ORDER BY s.planned_relief_at
        LIMIT 1
      )
      UNION ALL
      (
        SELECT s.planned_relief_at
        FROM public.dealer_rotation_schedule AS s
        WHERE s.club_id = c.id
          AND s.status IN ('executed', 'cancelled', 'no_show')
          AND s.planned_relief_at < now() - interval '90 days'
        ORDER BY s.planned_relief_at
        LIMIT 1
      )
    ) AS eligible
    ORDER BY eligible.planned_relief_at
    LIMIT 1
  ) AS due
  ORDER BY due.oldest_eligible, c.id
  LIMIT 1;

  IF v_club_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_work', 'deleted', 0, 'batch_cap', v_limit);
  END IF;

  RETURN public.cleanup_dealer_rotation_schedule(v_club_id, v_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_cron_job_run_details(
  p_batch_size int DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit   int := LEAST(GREATEST(COALESCE(p_batch_size, 5000), 1), 5000);
  v_deleted int := 0;
BEGIN
  WITH candidates AS (
    SELECT d.runid
    FROM cron.job_run_details AS d
    WHERE d.start_time < now() - interval '7 days'
      AND d.end_time IS NOT NULL
      AND d.status NOT IN ('running', 'connecting')
    ORDER BY d.start_time, d.runid
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM cron.job_run_details AS target
  USING candidates
  WHERE target.runid = candidates.runid;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_deleted = 0 THEN 'no_work' ELSE 'ok' END,
    'deleted', v_deleted,
    'batch_cap', v_limit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_diagnostic_logs(
  p_batch_size int DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit   int := LEAST(GREATEST(COALESCE(p_batch_size, 5000), 1), 5000);
  v_deleted int := 0;
BEGIN
  WITH candidates AS (
    SELECT d.id
    FROM public.diagnostic_logs AS d
    WHERE d.timestamp < now() - interval '7 days'
    ORDER BY d.timestamp, d.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.diagnostic_logs AS target
  USING candidates
  WHERE target.id = candidates.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_deleted = 0 THEN 'no_work' ELSE 'ok' END,
    'deleted', v_deleted,
    'batch_cap', v_limit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_cron_metrics(
  p_cron_name text,
  p_batch_size int DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit   int := LEAST(GREATEST(COALESCE(p_batch_size, 5000), 1), 5000);
  v_deleted int := 0;
BEGIN
  IF p_cron_name IS NULL OR btrim(p_cron_name) = '' THEN
    RETURN jsonb_build_object('outcome', 'error', 'detail', 'cron_name is required');
  END IF;

  WITH candidates AS (
    SELECT m.id
    FROM public.cron_metrics AS m
    WHERE m.cron_name = p_cron_name
      AND m.executed_at < now() - interval '30 days'
    ORDER BY m.executed_at, m.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.cron_metrics AS target
  USING candidates
  WHERE target.id = candidates.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_deleted = 0 THEN 'no_work' ELSE 'ok' END,
    'cron_name', p_cron_name,
    'deleted', v_deleted,
    'batch_cap', v_limit
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_next_cron_metrics(
  p_batch_size int DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit     int := LEAST(GREATEST(COALESCE(p_batch_size, 5000), 1), 5000);
  v_cron_name text;
BEGIN
  -- Existing idx_cron_metrics_cron_name(cron_name, executed_at DESC) supplies
  -- one bounded oldest-row probe per distinct cron name.
  SELECT names.cron_name INTO v_cron_name
  FROM (
    SELECT DISTINCT m.cron_name
    FROM public.cron_metrics AS m
  ) AS names
  CROSS JOIN LATERAL (
    SELECT m.executed_at
    FROM public.cron_metrics AS m
    WHERE m.cron_name = names.cron_name
      AND m.executed_at < now() - interval '30 days'
    ORDER BY m.executed_at
    LIMIT 1
  ) AS due
  ORDER BY due.executed_at, names.cron_name
  LIMIT 1;

  IF v_cron_name IS NULL THEN
    RETURN jsonb_build_object('outcome', 'no_work', 'deleted', 0, 'batch_cap', v_limit);
  END IF;

  RETURN public.cleanup_cron_metrics(v_cron_name, v_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_dealer_rotation_schedule(uuid, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_next_dealer_rotation_schedule(int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_cron_job_run_details(int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_diagnostic_logs(int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_cron_metrics(text, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_next_cron_metrics(int)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_dealer_rotation_schedule(uuid, int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_next_dealer_rotation_schedule(int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_cron_job_run_details(int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_diagnostic_logs(int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_cron_metrics(text, int)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_next_cron_metrics(int)
  TO service_role;

COMMIT;
