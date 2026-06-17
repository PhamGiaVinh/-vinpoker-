-- =====================================================================
-- Club Intelligence — F1 Write-Path RPCs (source-only)
-- =====================================================================
-- Adds the server-authoritative write path on top of the F1 foundation
-- (20260921000000_club_intel_f1_foundation.sql). The five club_intel_*
-- tables are SELECT-only to `authenticated` with NO client write policies,
-- so all writes flow through these SECURITY DEFINER RPCs only.
--
-- Guards (locked):
--   * Owner/admin only      -> is_club_owner(auth.uid(), club_id)
--                              (covers club owner + super_admin).
--   * Per-club feature gate  -> is_ci_enabled(club_id) on create/append/promote
--                              (ci_set_enabled is exempt: it sets the gate).
--   * No client INSERT/UPDATE/DELETE RLS policies added.
--   * No new table grants (tables stay SELECT-only; writes run as DEFINER).
--   * Promotion is transactional; invalid rows are skipped, never fail batch.
--   * Server recomputes ALL derived values (rake_yield_pct) — client numbers
--     are never trusted. No profit / expected / projected columns. No AI.
--
-- Idempotent: CREATE OR REPLACE + ON CONFLICT + re-runnable grants.
-- NOT applied by this migration's merge (DB step is gated in CI).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ci_set_enabled — owner toggles per-club CI enablement.
--    Exempt from is_ci_enabled (this is the function that enables it).
--    Write to club_intel_config is audited by trg_ci_audit_config.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ci_set_enabled(
  p_club_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := COALESCE(p_enabled, false);
BEGIN
  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_id is required';
  END IF;
  IF NOT public.is_club_owner(auth.uid(), p_club_id) THEN
    RAISE EXCEPTION 'not authorized for this club';
  END IF;

  INSERT INTO public.club_intel_config (club_id, enabled, created_by)
  VALUES (p_club_id, v_enabled, auth.uid())
  ON CONFLICT (club_id) DO UPDATE
    SET enabled    = EXCLUDED.enabled,
        updated_at = now();

  RETURN jsonb_build_object('success', true, 'club_id', p_club_id, 'enabled', v_enabled);
END;
$$;

-- ---------------------------------------------------------------------
-- 2. ci_create_dataset — owner opens a new CSV import batch (status=importing).
--    F1 supports source='csv' only (native = F2, shadow = F7).
--    INSERT into club_intel_datasets is audited by trg_ci_audit_datasets.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ci_create_dataset(
  p_club_id      uuid,
  p_source       text,
  p_label        text DEFAULT NULL,
  p_period_start date DEFAULT NULL,
  p_period_end   date DEFAULT NULL,
  p_provenance   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_club_id IS NULL THEN
    RAISE EXCEPTION 'club_id is required';
  END IF;
  IF NOT public.is_club_owner(auth.uid(), p_club_id) THEN
    RAISE EXCEPTION 'not authorized for this club';
  END IF;
  IF NOT public.is_ci_enabled(p_club_id) THEN
    RAISE EXCEPTION 'club intelligence is not enabled for this club';
  END IF;
  IF COALESCE(p_source, 'csv') <> 'csv' THEN
    RAISE EXCEPTION 'F1 supports csv import only (got %)', p_source;
  END IF;

  INSERT INTO public.club_intel_datasets
    (club_id, source, label, schema_version, period_start, period_end, status, provenance, created_by)
  VALUES
    (p_club_id, 'csv'::public.ci_dataset_source, p_label, 'club_internal_memory_v1',
     p_period_start, p_period_end, 'importing', p_provenance, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'dataset_id', v_id);
END;
$$;

-- ---------------------------------------------------------------------
-- 3. ci_append_import_rows — stage client-parsed rows (untrusted raw_json)
--    and compute parse_errors server-side. Dataset is locked FOR UPDATE so
--    concurrent appends cannot race on row_index. Validity is decided by the
--    server, never the client. Required fields mirror the prototype:
--    time, event (non-empty strings) + buyin, final_entries (JSON numbers).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ci_append_import_rows(
  p_dataset_id uuid,
  p_rows       jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club      uuid;
  v_status    text;
  v_count     int;
  v_incoming  int;
  v_inserted  int := 0;
  v_invalid   int := 0;
  v_idx       int;
  v_elem      jsonb;
  v_errors    jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  v_incoming := jsonb_array_length(p_rows);
  IF v_incoming > 2000 THEN
    RAISE EXCEPTION 'too many rows in one call (max 2000, got %)', v_incoming;
  END IF;

  -- Lock the dataset row to serialize row_index assignment across callers.
  SELECT club_id, status, row_count
    INTO v_club, v_status, v_count
  FROM public.club_intel_datasets
  WHERE id = p_dataset_id
  FOR UPDATE;

  IF v_club IS NULL THEN
    RAISE EXCEPTION 'dataset not found';
  END IF;
  IF NOT public.is_club_owner(auth.uid(), v_club) THEN
    RAISE EXCEPTION 'not authorized for this club';
  END IF;
  IF NOT public.is_ci_enabled(v_club) THEN
    RAISE EXCEPTION 'club intelligence is not enabled for this club';
  END IF;
  IF v_status <> 'importing' THEN
    RAISE EXCEPTION 'dataset is not in importing state (status=%)', v_status;
  END IF;
  IF v_count + v_incoming > 2000 THEN
    RAISE EXCEPTION 'dataset would exceed 2000 rows (current=%, incoming=%)', v_count, v_incoming;
  END IF;

  IF v_incoming = 0 THEN
    RETURN jsonb_build_object('success', true, 'inserted', 0,
      'total_rows', v_count, 'invalid_rows', 0);
  END IF;

  FOR v_idx IN 0 .. v_incoming - 1 LOOP
    v_elem   := p_rows -> v_idx;
    v_errors := '[]'::jsonb;

    IF v_elem IS NULL OR jsonb_typeof(v_elem) <> 'object' THEN
      v_errors := v_errors || jsonb_build_object('field', NULL, 'message', 'row is not a JSON object');
    ELSE
      IF COALESCE(v_elem->>'time', '') = '' THEN
        v_errors := v_errors || jsonb_build_object('field', 'time', 'message', 'missing required field: time');
      END IF;
      IF COALESCE(v_elem->>'event', '') = '' THEN
        v_errors := v_errors || jsonb_build_object('field', 'event', 'message', 'missing required field: event');
      END IF;
      IF v_elem->'buyin' IS NULL OR jsonb_typeof(v_elem->'buyin') <> 'number' THEN
        v_errors := v_errors || jsonb_build_object('field', 'buyin', 'message', 'buyin must be a number');
      END IF;
      IF v_elem->'final_entries' IS NULL OR jsonb_typeof(v_elem->'final_entries') <> 'number' THEN
        v_errors := v_errors || jsonb_build_object('field', 'final_entries', 'message', 'final_entries must be a number');
      END IF;
    END IF;

    IF jsonb_array_length(v_errors) > 0 THEN
      v_invalid := v_invalid + 1;
    END IF;

    INSERT INTO public.club_intel_import_rows
      (club_id, dataset_id, row_index, raw_json, parse_errors, promoted, created_by)
    VALUES
      (v_club, p_dataset_id, v_count + v_idx,
       CASE WHEN jsonb_typeof(v_elem) = 'object' THEN v_elem ELSE jsonb_build_object('_raw', v_elem) END,
       v_errors, false, auth.uid());

    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE public.club_intel_datasets
  SET row_count = row_count + v_inserted
  WHERE id = p_dataset_id;

  RETURN jsonb_build_object('success', true, 'inserted', v_inserted,
    'total_rows', v_count + v_inserted, 'invalid_rows', v_invalid);
END;
$$;

-- ---------------------------------------------------------------------
-- 4. ci_promote_dataset — transactionally promote valid staged rows into
--    canonical observations. Invalid rows (parse_errors <> []) are skipped.
--    All derived values are recomputed server-side; optional numeric fields
--    are safe-cast only when jsonb_typeof = 'number'. Writes an explicit
--    audit row (observations has no trigger). Idempotent: re-run promotes
--    only still-unpromoted valid rows.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ci_promote_dataset(
  p_dataset_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club      uuid;
  v_status    text;
  v_promoted  int := 0;
  v_skipped   int := 0;
  v_readiness jsonb;
  r           record;
  v_raw       jsonb;
  v_buyin     numeric;
  v_prize     numeric;
  v_rake      numeric;
  v_yield     numeric;
  v_final     int;
  v_l1        int;
  v_cap       int;
  v_occurred  date;
BEGIN
  -- Lock the dataset to serialize promote calls.
  SELECT club_id, status
    INTO v_club, v_status
  FROM public.club_intel_datasets
  WHERE id = p_dataset_id
  FOR UPDATE;

  IF v_club IS NULL THEN
    RAISE EXCEPTION 'dataset not found';
  END IF;
  IF NOT public.is_club_owner(auth.uid(), v_club) THEN
    RAISE EXCEPTION 'not authorized for this club';
  END IF;
  IF NOT public.is_ci_enabled(v_club) THEN
    RAISE EXCEPTION 'club intelligence is not enabled for this club';
  END IF;

  -- Count invalid rows still pending (reported as skipped).
  SELECT count(*) INTO v_skipped
  FROM public.club_intel_import_rows
  WHERE dataset_id = p_dataset_id
    AND promoted = false
    AND parse_errors <> '[]'::jsonb;

  -- Promote valid, unpromoted rows. Lock them to avoid double-promote.
  FOR r IN
    SELECT id, raw_json
    FROM public.club_intel_import_rows
    WHERE dataset_id = p_dataset_id
      AND promoted = false
      AND parse_errors = '[]'::jsonb
    ORDER BY row_index
    FOR UPDATE
  LOOP
    v_raw := r.raw_json;

    v_buyin    := CASE WHEN jsonb_typeof(v_raw->'buyin')          = 'number' THEN (v_raw->>'buyin')::numeric          ELSE NULL END;
    v_prize    := CASE WHEN jsonb_typeof(v_raw->'prize_comp')     = 'number' THEN (v_raw->>'prize_comp')::numeric     ELSE NULL END;
    v_rake     := CASE WHEN jsonb_typeof(v_raw->'rake_comp')      = 'number' THEN (v_raw->>'rake_comp')::numeric      ELSE NULL END;
    v_final    := CASE WHEN jsonb_typeof(v_raw->'final_entries')  = 'number' THEN (v_raw->>'final_entries')::int      ELSE NULL END;
    v_l1       := CASE WHEN jsonb_typeof(v_raw->'level1_entries') = 'number' THEN (v_raw->>'level1_entries')::int     ELSE NULL END;
    v_cap      := CASE WHEN jsonb_typeof(v_raw->'freerake_cap')   = 'number' THEN (v_raw->>'freerake_cap')::int       ELSE NULL END;
    v_occurred := CASE WHEN v_raw->>'date' ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_raw->>'date')::date ELSE NULL END;

    -- Server-authoritative: rake yield is recomputed, never trusted from client.
    v_yield := CASE
                 WHEN v_rake IS NOT NULL AND v_buyin IS NOT NULL AND v_buyin > 0
                 THEN round(v_rake / v_buyin * 100, 1)
                 ELSE NULL
               END;

    INSERT INTO public.club_intel_observations
      (club_id, dataset_id, source, occurred_on, slot_time, event_name, game_type,
       buy_in, prize_component, rake_component, rake_yield_pct,
       final_entries, level1_entries, free_rake_cap, label, provenance, created_by)
    VALUES
      (v_club, p_dataset_id, 'csv'::public.ci_dataset_source, v_occurred,
       v_raw->>'time', v_raw->>'event', NULL,
       v_buyin, v_prize, v_rake, v_yield,
       v_final, v_l1, v_cap, 'observed_pattern'::public.ci_label_tier,
       'csv_import:' || p_dataset_id::text, auth.uid());

    UPDATE public.club_intel_import_rows SET promoted = true WHERE id = r.id;
    v_promoted := v_promoted + 1;
  END LOOP;

  -- Cache readiness (reflects rows promoted earlier in this transaction).
  v_readiness := public.ci_dataset_readiness(p_dataset_id);

  UPDATE public.club_intel_datasets
  SET readiness_json = v_readiness,
      status         = 'ready'
  WHERE id = p_dataset_id;

  -- Explicit audit row: club_intel_observations has no per-row trigger.
  INSERT INTO public.club_intel_audit_log
    (club_id, table_name, record_id, action, new_values, changed_by, reason)
  VALUES
    (v_club, 'club_intel_observations', p_dataset_id, 'INSERT',
     jsonb_build_object('promoted', v_promoted, 'skipped', v_skipped, 'dataset_id', p_dataset_id),
     auth.uid(), 'ci_promote_dataset');

  RETURN jsonb_build_object('success', true, 'promoted', v_promoted, 'skipped', v_skipped,
    'status', 'ready', 'readiness', v_readiness);
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Grants — least privilege. No PUBLIC, no anon. EXECUTE -> authenticated
--    only; authorization is enforced inside each function via is_club_owner.
--    No table grants are added (tables remain SELECT-only to authenticated).
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ci_set_enabled(uuid, boolean)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ci_create_dataset(uuid, text, text, date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ci_append_import_rows(uuid, jsonb)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ci_promote_dataset(uuid)                              FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ci_set_enabled(uuid, boolean)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.ci_create_dataset(uuid, text, text, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ci_append_import_rows(uuid, jsonb)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.ci_promote_dataset(uuid)                              TO authenticated;
