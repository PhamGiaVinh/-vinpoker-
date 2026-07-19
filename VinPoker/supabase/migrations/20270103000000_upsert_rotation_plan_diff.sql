-- ============================================================================
-- 20270103000000_upsert_rotation_plan_diff.sql
--
-- Source-only performance hardening for Dealer Swing rotation planning.
--
-- Keeps the public signature unchanged while replacing full-plan churn with a
-- set-based diff. An identical plan performs no UPDATE/INSERT, changed or
-- removed predicted slots are superseded, and announced/executing rows remain
-- sticky. A per-club transaction advisory lock serializes overlapping planners.
--
-- OWNER-GATED APPLY. Do not apply autonomously.
--
-- ROLLBACK (owner-gated): recreate public.upsert_rotation_plan(uuid,uuid,jsonb,
-- uuid[]) from 20260813000001_rotation_rpcs.sql, then re-run the privilege
-- checks below. Rolling back restores the old write-heavy behavior.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.upsert_rotation_plan(
  p_club_id     uuid,
  p_plan_run_id uuid,
  p_rows        jsonb,
  p_table_ids   uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_input_count int := 0;
  v_unchanged   int := 0;
  v_superseded  int := 0;
  v_inserted    int := 0;
  v_skipped     int := 0;
BEGIN
  IF p_rows IS NOT NULL AND jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object(
      'outcome', 'error',
      'detail', 'p_rows must be a JSON array',
      'sqlstate', '22023'
    );
  END IF;

  -- One writer per club. This closes the race where two planner invocations
  -- both retire/insert the same live (table_id, slot_index) concurrently.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('upsert_rotation_plan:' || p_club_id::text, 0)
  );

  -- Count distinct incoming slots in scope. Duplicate keys retain the first
  -- row, matching the previous function's first-insert-wins behavior.
  WITH raw AS (
    SELECT value AS row_data, ordinality
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
         WITH ORDINALITY
  ), parsed AS (
    SELECT
      (row_data->>'table_id')::uuid AS table_id,
      NULLIF(row_data->>'assignment_id', '')::uuid AS assignment_id,
      COALESCE(NULLIF(row_data->>'slot_index', '')::int, 0) AS slot_index,
      NULLIF(row_data->>'out_attendance_id', '')::uuid AS out_attendance_id,
      NULLIF(row_data->>'in_attendance_id', '')::uuid AS in_attendance_id,
      (row_data->>'planned_relief_at')::timestamptz AS planned_relief_at,
      NULLIF(row_data->>'announce_at', '')::timestamptz AS announce_at,
      COALESCE((row_data->>'is_shortage')::boolean, false) AS is_shortage,
      COALESCE((row_data->>'is_emergency')::boolean, false) AS is_emergency,
      COALESCE(row_data->>'solver_version', 'unknown') AS solver_version,
      NULLIF(row_data->>'score', '')::numeric AS score,
      COALESCE(row_data->'reason', '{}'::jsonb) AS reason,
      ordinality
    FROM raw
  ), incoming AS (
    SELECT DISTINCT ON (table_id, slot_index)
      table_id, assignment_id, slot_index,
      out_attendance_id, in_attendance_id,
      planned_relief_at, announce_at,
      is_shortage, is_emergency,
      solver_version, score, reason
    FROM parsed
    WHERE p_table_ids IS NULL OR table_id = ANY(p_table_ids)
    ORDER BY table_id, slot_index, ordinality
  )
  SELECT count(*)::int INTO v_input_count FROM incoming;

  -- Run-local metadata is intentionally excluded from semantic equality.
  -- planned_relief_at/announce_at, score and reason can drift with Date.now()
  -- even when the selected assignment/dealers are unchanged. Keeping the
  -- existing row preserves the earliest accepted schedule instead of pushing
  -- it forward and generating WAL every minute. Operational changes still
  -- replace the row through assignment/dealer/shortage/emergency/version.
  WITH raw AS (
    SELECT value AS row_data, ordinality
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
         WITH ORDINALITY
  ), parsed AS (
    SELECT
      (row_data->>'table_id')::uuid AS table_id,
      NULLIF(row_data->>'assignment_id', '')::uuid AS assignment_id,
      COALESCE(NULLIF(row_data->>'slot_index', '')::int, 0) AS slot_index,
      NULLIF(row_data->>'out_attendance_id', '')::uuid AS out_attendance_id,
      NULLIF(row_data->>'in_attendance_id', '')::uuid AS in_attendance_id,
      (row_data->>'planned_relief_at')::timestamptz AS planned_relief_at,
      NULLIF(row_data->>'announce_at', '')::timestamptz AS announce_at,
      COALESCE((row_data->>'is_shortage')::boolean, false) AS is_shortage,
      COALESCE((row_data->>'is_emergency')::boolean, false) AS is_emergency,
      COALESCE(row_data->>'solver_version', 'unknown') AS solver_version,
      NULLIF(row_data->>'score', '')::numeric AS score,
      COALESCE(row_data->'reason', '{}'::jsonb) AS reason,
      ordinality
    FROM raw
  ), incoming AS (
    SELECT DISTINCT ON (table_id, slot_index)
      table_id, assignment_id, slot_index,
      out_attendance_id, in_attendance_id,
      planned_relief_at, announce_at,
      is_shortage, is_emergency,
      solver_version, score, reason
    FROM parsed
    WHERE p_table_ids IS NULL OR table_id = ANY(p_table_ids)
    ORDER BY table_id, slot_index, ordinality
  )
  SELECT count(*)::int INTO v_unchanged
  FROM incoming AS i
  JOIN public.dealer_rotation_schedule AS s
    ON s.club_id = p_club_id
   AND s.table_id = i.table_id
   AND s.slot_index = i.slot_index
   AND s.status = 'predicted'
  WHERE ROW(
          s.assignment_id,
          s.out_attendance_id,
          s.in_attendance_id,
          s.is_shortage,
          s.is_emergency,
          s.solver_version
        ) IS NOT DISTINCT FROM ROW(
          i.assignment_id,
          i.out_attendance_id,
          i.in_attendance_id,
          i.is_shortage,
          i.is_emergency,
          i.solver_version
        );

  -- Retire only predicted rows that disappeared or changed inside this plan's
  -- scope. Sticky announced/executing rows are never candidates for this UPDATE.
  WITH raw AS (
    SELECT value AS row_data, ordinality
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
         WITH ORDINALITY
  ), parsed AS (
    SELECT
      (row_data->>'table_id')::uuid AS table_id,
      NULLIF(row_data->>'assignment_id', '')::uuid AS assignment_id,
      COALESCE(NULLIF(row_data->>'slot_index', '')::int, 0) AS slot_index,
      NULLIF(row_data->>'out_attendance_id', '')::uuid AS out_attendance_id,
      NULLIF(row_data->>'in_attendance_id', '')::uuid AS in_attendance_id,
      (row_data->>'planned_relief_at')::timestamptz AS planned_relief_at,
      NULLIF(row_data->>'announce_at', '')::timestamptz AS announce_at,
      COALESCE((row_data->>'is_shortage')::boolean, false) AS is_shortage,
      COALESCE((row_data->>'is_emergency')::boolean, false) AS is_emergency,
      COALESCE(row_data->>'solver_version', 'unknown') AS solver_version,
      NULLIF(row_data->>'score', '')::numeric AS score,
      COALESCE(row_data->'reason', '{}'::jsonb) AS reason,
      ordinality
    FROM raw
  ), incoming AS (
    SELECT DISTINCT ON (table_id, slot_index)
      table_id, assignment_id, slot_index,
      out_attendance_id, in_attendance_id,
      planned_relief_at, announce_at,
      is_shortage, is_emergency,
      solver_version, score, reason
    FROM parsed
    WHERE p_table_ids IS NULL OR table_id = ANY(p_table_ids)
    ORDER BY table_id, slot_index, ordinality
  )
  UPDATE public.dealer_rotation_schedule AS s
  SET status = 'superseded',
      version = s.version + 1,
      updated_at = now()
  WHERE s.club_id = p_club_id
    AND s.status = 'predicted'
    AND (p_table_ids IS NULL OR s.table_id = ANY(p_table_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM incoming AS i
      WHERE i.table_id = s.table_id
        AND i.slot_index = s.slot_index
        AND ROW(
              s.assignment_id,
              s.out_attendance_id,
              s.in_attendance_id,
              s.is_shortage,
              s.is_emergency,
              s.solver_version
            ) IS NOT DISTINCT FROM ROW(
              i.assignment_id,
              i.out_attendance_id,
              i.in_attendance_id,
              i.is_shortage,
              i.is_emergency,
              i.solver_version
            )
    );
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  -- Existing identical predictions conflict on uq_rotation_active_slot and are
  -- intentionally ignored. Announced/executing ownership also remains sticky.
  WITH raw AS (
    SELECT value AS row_data, ordinality
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
         WITH ORDINALITY
  ), parsed AS (
    SELECT
      (row_data->>'table_id')::uuid AS table_id,
      NULLIF(row_data->>'assignment_id', '')::uuid AS assignment_id,
      COALESCE(NULLIF(row_data->>'slot_index', '')::int, 0) AS slot_index,
      NULLIF(row_data->>'out_attendance_id', '')::uuid AS out_attendance_id,
      NULLIF(row_data->>'in_attendance_id', '')::uuid AS in_attendance_id,
      (row_data->>'planned_relief_at')::timestamptz AS planned_relief_at,
      NULLIF(row_data->>'announce_at', '')::timestamptz AS announce_at,
      COALESCE((row_data->>'is_shortage')::boolean, false) AS is_shortage,
      COALESCE((row_data->>'is_emergency')::boolean, false) AS is_emergency,
      COALESCE(row_data->>'solver_version', 'unknown') AS solver_version,
      NULLIF(row_data->>'score', '')::numeric AS score,
      COALESCE(row_data->'reason', '{}'::jsonb) AS reason,
      ordinality
    FROM raw
  ), incoming AS (
    SELECT DISTINCT ON (table_id, slot_index)
      table_id, assignment_id, slot_index,
      out_attendance_id, in_attendance_id,
      planned_relief_at, announce_at,
      is_shortage, is_emergency,
      solver_version, score, reason
    FROM parsed
    WHERE p_table_ids IS NULL OR table_id = ANY(p_table_ids)
    ORDER BY table_id, slot_index, ordinality
  )
  INSERT INTO public.dealer_rotation_schedule (
    club_id,
    table_id,
    assignment_id,
    slot_index,
    out_attendance_id,
    in_attendance_id,
    planned_relief_at,
    announce_at,
    status,
    is_shortage,
    is_emergency,
    plan_run_id,
    solver_version,
    score,
    reason
  )
  SELECT
    p_club_id,
    i.table_id,
    i.assignment_id,
    i.slot_index,
    i.out_attendance_id,
    i.in_attendance_id,
    i.planned_relief_at,
    i.announce_at,
    'predicted',
    i.is_shortage,
    i.is_emergency,
    p_plan_run_id,
    i.solver_version,
    i.score,
    i.reason
  FROM incoming AS i
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  v_skipped := GREATEST(v_input_count - v_unchanged - v_inserted, 0);

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'unchanged', v_unchanged,
    'superseded', v_superseded,
    'inserted', v_inserted,
    'skipped', v_skipped,
    'plan_run_id', p_plan_run_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'outcome', 'error',
      'detail', SQLERRM,
      'sqlstate', SQLSTATE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rotation_plan(uuid, uuid, jsonb, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_rotation_plan(uuid, uuid, jsonb, uuid[])
  TO service_role;

COMMIT;
