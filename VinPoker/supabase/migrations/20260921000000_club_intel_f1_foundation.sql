-- ============================================================================
-- Club Intelligence — F1 Foundation (schema + RLS + audit + readiness gate)
-- ============================================================================
-- SOURCE-ONLY. NOT applied to any database by this commit. Apply later via a
-- controlled operation (preflight -> snapshot -> apply -> verify -> rollback note),
-- never `deploy_db=true` in CI and never `supabase db push` from a normal push.
--
-- Spec: VinPoker/docs/club-intelligence/{FULL_VERSION_SPEC,DATA_MODEL,SAFETY_BOUNDARY}.md
-- Productionizes the standalone vinpoker-club-intel prototype (P1-P8), Phase F1.
--
-- Invariants enforced here:
--   * Every CI table is club-scoped (club_id) with RLS.
--   * Reads via SECURITY DEFINER functions, EXECUTE -> authenticated only (no anon/PUBLIC).
--   * No expected/projected/profit columns on observations (locked).
--   * Reserved label tiers (tested_finding / model_estimate) are NOT writable (CHECK).
--   * Defensive / idempotent: re-runnable without error.
-- Scope of F1: config gate, datasets, import_rows (CSV staging), observations,
--   audit log, readiness function. Write-path RPCs (CSV import/promote) and the
--   native->observation adapter are later controlled steps (F1 follow-up / F2).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums (guarded — CREATE TYPE is not idempotent)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ci_dataset_source') THEN
    CREATE TYPE public.ci_dataset_source AS ENUM ('native', 'csv', 'shadow');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ci_label_tier') THEN
    -- last two are RESERVED for the deferred LEARNED-CAUSAL tier (not writable in F1-F8)
    CREATE TYPE public.ci_label_tier AS ENUM
      ('known_rule', 'observed_pattern', 'hypothesis', 'tested_finding', 'model_estimate');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Per-club enable gate (FEATURES flag is separate, frontend-only, added with UI)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_intel_config (
  club_id    uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.club_intel_config IS 'Per-club Club-Intelligence enable gate. Default OFF.';

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.club_intel_datasets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  source         public.ci_dataset_source NOT NULL,
  label          text,
  schema_version text NOT NULL DEFAULT 'club_internal_memory_v1',
  period_start   date,
  period_end     date,
  row_count      int NOT NULL DEFAULT 0,
  readiness_json jsonb,
  status         text NOT NULL DEFAULT 'importing' CHECK (status IN ('importing', 'ready', 'archived')),
  provenance     text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ci_datasets_club ON public.club_intel_datasets(club_id);
COMMENT ON TABLE public.club_intel_datasets IS 'One ingest batch (native|csv|shadow); unit Data Readiness evaluates.';

CREATE TABLE IF NOT EXISTS public.club_intel_import_rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id      uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  dataset_id   uuid NOT NULL REFERENCES public.club_intel_datasets(id) ON DELETE CASCADE,
  row_index    int NOT NULL,
  raw_json     jsonb NOT NULL,             -- parsed-but-untrusted; never executed
  parse_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  promoted     boolean NOT NULL DEFAULT false,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ci_import_rows_dataset ON public.club_intel_import_rows(dataset_id);
COMMENT ON TABLE public.club_intel_import_rows IS 'CSV staging (untrusted). Promote to observations after validation.';

CREATE TABLE IF NOT EXISTS public.club_intel_observations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id             uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  dataset_id          uuid NOT NULL REFERENCES public.club_intel_datasets(id) ON DELETE CASCADE,
  source              public.ci_dataset_source NOT NULL CHECK (source IN ('native', 'csv')),
  native_tournament_id uuid,               -- = tournaments.id when source=native; NULL for csv
  occurred_on         date,
  slot_time           text,                -- HH:MM
  event_name          text,
  game_type           text,
  buy_in              numeric,
  prize_component     numeric,             -- "X"
  rake_component      numeric,             -- "Y"
  rake_yield_pct      numeric,             -- rake/buy_in*100 (observed)
  final_entries       int,
  level1_entries      int,
  free_rake_cap       int,
  label               public.ci_label_tier NOT NULL DEFAULT 'observed_pattern'
                        CHECK (label IN ('known_rule', 'observed_pattern', 'hypothesis')),
  provenance          text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
  -- NOTE (locked): NO expected_*, projected_*, or profit_* columns. Cost/profit absent by design.
);
CREATE INDEX IF NOT EXISTS idx_ci_observations_dataset ON public.club_intel_observations(dataset_id);
CREATE INDEX IF NOT EXISTS idx_ci_observations_club ON public.club_intel_observations(club_id);
COMMENT ON TABLE public.club_intel_observations IS 'Canonical fact grain: one tournament instance (event x slot). Observed only.';

CREATE TABLE IF NOT EXISTS public.club_intel_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid,
  table_name  text NOT NULL,
  record_id   uuid,
  action      text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values  jsonb,
  new_values  jsonb,
  changed_by  uuid,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  reason      text
);
CREATE INDEX IF NOT EXISTS idx_ci_audit_club ON public.club_intel_audit_log(club_id);
COMMENT ON TABLE public.club_intel_audit_log IS 'Change trail for CI tables (shape mirrors payroll_audit_log).';

-- ---------------------------------------------------------------------------
-- 4. Security helper functions (SECURITY DEFINER, search_path locked)
-- ---------------------------------------------------------------------------
-- Club membership-or-ownership check (reuses existing is_club_owner precedent).
CREATE OR REPLACE FUNCTION public.is_club_member_or_owner(_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_club_owner(auth.uid(), _club_id)
      OR EXISTS (
        SELECT 1 FROM public.club_members cm
        WHERE cm.club_id = _club_id AND cm.player_user_id = auth.uid()
      );
$$;

-- Per-club enable gate. Default false when no config row.
CREATE OR REPLACE FUNCTION public.is_ci_enabled(_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT enabled FROM public.club_intel_config WHERE club_id = _club_id), false);
$$;

-- ---------------------------------------------------------------------------
-- 5. Audit trigger (attached to config + datasets only; observations/import_rows
--    are bulk data attributed to an audited dataset)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ci_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_club  uuid;
BEGIN
  BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  IF v_actor IS NULL THEN
    BEGIN
      v_actor := NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;
  END IF;

  v_club := COALESCE((to_jsonb(NEW) ->> 'club_id')::uuid, (to_jsonb(OLD) ->> 'club_id')::uuid);

  INSERT INTO public.club_intel_audit_log
    (club_id, table_name, record_id, action, old_values, new_values, changed_by)
  VALUES (
    v_club,
    TG_TABLE_NAME,
    COALESCE((to_jsonb(NEW) ->> 'id')::uuid,
             (to_jsonb(NEW) ->> 'club_id')::uuid,   -- config PK is club_id
             (to_jsonb(OLD) ->> 'id')::uuid,
             (to_jsonb(OLD) ->> 'club_id')::uuid),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    v_actor
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ci_audit_config ON public.club_intel_config;
CREATE TRIGGER trg_ci_audit_config
  AFTER INSERT OR UPDATE OR DELETE ON public.club_intel_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_ci_audit_trigger();

DROP TRIGGER IF EXISTS trg_ci_audit_datasets ON public.club_intel_datasets;
CREATE TRIGGER trg_ci_audit_datasets
  AFTER INSERT OR UPDATE OR DELETE ON public.club_intel_datasets
  FOR EACH ROW EXECUTE FUNCTION public.fn_ci_audit_trigger();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security — club-scoped SELECT only; writes via SECURITY DEFINER
--    paths (later phases). No client INSERT/UPDATE/DELETE policy (default deny).
-- ---------------------------------------------------------------------------
ALTER TABLE public.club_intel_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_intel_datasets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_intel_import_rows  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_intel_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_intel_audit_log    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ci_config_select ON public.club_intel_config;
CREATE POLICY ci_config_select ON public.club_intel_config
  FOR SELECT TO authenticated USING (public.is_club_member_or_owner(club_id));

DROP POLICY IF EXISTS ci_datasets_select ON public.club_intel_datasets;
CREATE POLICY ci_datasets_select ON public.club_intel_datasets
  FOR SELECT TO authenticated USING (public.is_club_member_or_owner(club_id));

DROP POLICY IF EXISTS ci_import_rows_select ON public.club_intel_import_rows;
CREATE POLICY ci_import_rows_select ON public.club_intel_import_rows
  FOR SELECT TO authenticated USING (public.is_club_member_or_owner(club_id));

DROP POLICY IF EXISTS ci_observations_select ON public.club_intel_observations;
CREATE POLICY ci_observations_select ON public.club_intel_observations
  FOR SELECT TO authenticated USING (public.is_club_member_or_owner(club_id));

DROP POLICY IF EXISTS ci_audit_select ON public.club_intel_audit_log;
CREATE POLICY ci_audit_select ON public.club_intel_audit_log
  FOR SELECT TO authenticated USING (club_id IS NOT NULL AND public.is_club_member_or_owner(club_id));

-- ---------------------------------------------------------------------------
-- 7. Data Readiness — which analyses a dataset's observations support.
--    Self-scopes to caller's club; raises if not authorized.
--    (unique_retention is NOT included: `unique_entries` is not modeled in F1 —
--     see PR notes; recommend a spec+schema addendum before F3 descriptive.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ci_dataset_readiness(_dataset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_club uuid;
  r record;
BEGIN
  SELECT club_id INTO v_club FROM public.club_intel_datasets WHERE id = _dataset_id;
  IF v_club IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public.is_club_member_or_owner(v_club) THEN
    RAISE EXCEPTION 'not authorized for this club';
  END IF;

  SELECT
    bool_or(event_name      IS NOT NULL AND event_name <> '') AS has_event,
    bool_or(slot_time       IS NOT NULL AND slot_time  <> '') AS has_time,
    bool_or(buy_in          IS NOT NULL)                      AS has_buyin,
    bool_or(prize_component IS NOT NULL)                      AS has_prize,
    bool_or(rake_component  IS NOT NULL)                      AS has_rake,
    bool_or(final_entries   IS NOT NULL)                      AS has_final,
    bool_or(level1_entries  IS NOT NULL)                      AS has_level1,
    bool_or(free_rake_cap   IS NOT NULL)                      AS has_freecap,
    count(*)                                                  AS n
  INTO r
  FROM public.club_intel_observations
  WHERE dataset_id = _dataset_id;

  RETURN jsonb_build_object(
    'dataset_id', _dataset_id,
    'rows', COALESCE(r.n, 0),
    'analyses', jsonb_build_array(
      jsonb_build_object('id', 'tour_strength',      'label', 'Tour mạnh/yếu (Observed)',
        'supported', COALESCE(r.has_event AND r.has_final, false)),
      jsonb_build_object('id', 'slot_performance',   'label', 'Slot nào đông (Observed)',
        'supported', COALESCE(r.has_time AND r.has_final, false)),
      jsonb_build_object('id', 'pricing_rake_basic', 'label', 'Pricing/rake cơ bản',
        'supported', COALESCE(r.has_buyin AND r.has_prize AND r.has_rake, false)),
      jsonb_build_object('id', 'l1_liquidity',       'label', 'Level-1 liquidity',
        'supported', COALESCE(r.has_level1, false)),
      jsonb_build_object('id', 'freerake_roi',       'label', 'ROI free-rake',
        'supported', COALESCE(r.has_freecap AND r.has_final, false)),
      jsonb_build_object('id', 'true_profit',        'label', 'Profit thật',
        'supported', false, 'note', 'vẫn thiếu cost khác → chỉ gần đúng; không có cost data → không tính'),
      jsonb_build_object('id', 'cannibalization',    'label', 'Cannibalization nhân quả',
        'supported', false, 'reason', 'cần test có kiểm soát / pooled data — không suy ra từ 1 lần upload.')
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants — least privilege. No anon, no PUBLIC. SELECT-only on tables;
--    writes only via SECURITY DEFINER paths (later). EXECUTE -> authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.club_intel_config       FROM PUBLIC, anon;
REVOKE ALL ON public.club_intel_datasets     FROM PUBLIC, anon;
REVOKE ALL ON public.club_intel_import_rows  FROM PUBLIC, anon;
REVOKE ALL ON public.club_intel_observations FROM PUBLIC, anon;
REVOKE ALL ON public.club_intel_audit_log    FROM PUBLIC, anon;

GRANT SELECT ON public.club_intel_config       TO authenticated;
GRANT SELECT ON public.club_intel_datasets     TO authenticated;
GRANT SELECT ON public.club_intel_import_rows  TO authenticated;
GRANT SELECT ON public.club_intel_observations TO authenticated;
GRANT SELECT ON public.club_intel_audit_log    TO authenticated;

REVOKE ALL ON FUNCTION public.is_club_member_or_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_ci_enabled(uuid)           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ci_dataset_readiness(uuid)    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_club_member_or_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ci_enabled(uuid)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.ci_dataset_readiness(uuid)    TO authenticated;
