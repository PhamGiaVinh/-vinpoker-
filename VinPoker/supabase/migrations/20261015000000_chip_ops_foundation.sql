-- Chip Ops Foundation (PATCH 1a) — read-only foundation of the Chip Ops bounded context.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply later in a controlled session
-- (Management API / `supabase db query --linked --file`, NOT `db push` / not deploy_db), then
-- run the embedded TEST PLAN below and regen types.ts in a SEPARATE step. schema_migrations is
-- NOT touched by the controlled apply.
--
-- WHY: VinPoker has no server model of chip denominations / chip sets / stack composition today.
-- This stands up reusable room-level chip sets, a tournament<->chip-set binding, named stack
-- templates with a server-enforced Σ invariant, and a server-computed issued-chip inventory that
-- the client only READS. Server is the source of truth; clients send intent through SECURITY
-- DEFINER RPCs (default-deny RLS on every table — no direct client writes).
--
-- SCOPE (1a): chip_set, chip_set_denomination, tournament_chip_set, stack_template,
--   stack_template_line, stack_template_issuance + Σ enforcement + read inventory RPC + sanitized
--   views + config-write RPCs. RLS is OWNER-ONLY (public.is_club_owner, which already includes
--   super_admin). The Chip-Master role + UI are PATCH 1b (separate branch/review).
--
-- ISOLATION: reads tournament metadata only; NO write into and NO cross-schema FK toward Cashier,
--   Registration, Live Tracker, Dealer Swing, Payroll, Staking, Bankroll, Account/Documents/Feed,
--   online engine, or Tournament Structure. FKs only into public.clubs / public.tournaments and
--   within Chip Ops itself.
--
-- Σ INVARIANT: for every stack_template, Σ(line.count × denomination.value) MUST equal
--   stack_template.stack_value. Enforced by a DEFERRABLE INITIALLY DEFERRED constraint trigger
--   (hard backstop) AND re-checked inside the save RPC via ONE shared sum helper (no divergent
--   math). A template whose lines do not sum to stack_value is rejected.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION/VIEW,
--   DROP TRIGGER/POLICY IF EXISTS before create. A future gated re-apply is a safe no-op.

-- ===========================================================================================
-- 1. TABLES (6) — every table carries a denormalized club_id (server-derived, never client-set)
--    for join-free RLS. Spelling standardized on `color`.
-- ===========================================================================================

-- 1.1 chip_set — room/club-level, reusable across tournaments.
CREATE TABLE IF NOT EXISTS public.chip_set (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT auth.uid(),
  CONSTRAINT chip_set_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT chip_set_club_name_uniq UNIQUE (club_id, name)
);

-- 1.2 chip_set_denomination — denominations belonging to a chip set (append-only in 1a).
CREATE TABLE IF NOT EXISTS public.chip_set_denomination (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chip_set_id   uuid NOT NULL REFERENCES public.chip_set(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  value         bigint NOT NULL,
  color         text,
  label         text,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT auth.uid(),
  CONSTRAINT csd_value_pos CHECK (value > 0),
  CONSTRAINT csd_set_value_uniq UNIQUE (chip_set_id, value)
);

-- 1.3 tournament_chip_set — binds ONE tournament to ONE chip set (tournament_id is PK).
--     The redundant UNIQUE(tournament_id, chip_set_id) is the target of stack_template's
--     composite FK (which forces a template's set to equal the binding).
CREATE TABLE IF NOT EXISTS public.tournament_chip_set (
  tournament_id uuid PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  chip_set_id   uuid NOT NULL REFERENCES public.chip_set(id) ON DELETE RESTRICT,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT auth.uid(),
  CONSTRAINT tcs_tourn_chipset_uk UNIQUE (tournament_id, chip_set_id)
);

-- 1.4 stack_template — named template per tournament (MULTIPLE allowed). The composite FK
--     (tournament_id, chip_set_id) -> tournament_chip_set pins the template's chip set to the
--     tournament's bound set, and blocks rebinding the tournament while templates exist.
CREATE TABLE IF NOT EXISTS public.stack_template (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id       uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  chip_set_id   uuid NOT NULL REFERENCES public.chip_set(id) ON DELETE RESTRICT,
  name          text NOT NULL,
  stack_value   bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT auth.uid(),
  CONSTRAINT st_stack_value_pos CHECK (stack_value > 0),
  CONSTRAINT st_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT st_tournament_name_uniq UNIQUE (tournament_id, name),
  CONSTRAINT st_chipset_matches_binding
    FOREIGN KEY (tournament_id, chip_set_id)
    REFERENCES public.tournament_chip_set (tournament_id, chip_set_id) ON DELETE CASCADE
);

-- 1.5 stack_template_line — composition lines (denom + count).
CREATE TABLE IF NOT EXISTS public.stack_template_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stack_template_id uuid NOT NULL REFERENCES public.stack_template(id) ON DELETE CASCADE,
  denomination_id   uuid NOT NULL REFERENCES public.chip_set_denomination(id) ON DELETE RESTRICT,
  count             integer NOT NULL,
  CONSTRAINT stl_count_pos CHECK (count > 0),
  CONSTRAINT stl_tmpl_denom_uniq UNIQUE (stack_template_id, denomination_id)
);

-- 1.6 stack_template_issuance — per-template issued count (the ONLY per-template split source).
CREATE TABLE IF NOT EXISTS public.stack_template_issuance (
  stack_template_id uuid PRIMARY KEY REFERENCES public.stack_template(id) ON DELETE CASCADE,
  issued_count      integer NOT NULL DEFAULT 0,
  club_id           uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid DEFAULT auth.uid(),
  CONSTRAINT sti_issued_nonneg CHECK (issued_count >= 0)
);

-- Indexes (FK/scan support).
CREATE INDEX IF NOT EXISTS idx_chip_set_club          ON public.chip_set(club_id);
CREATE INDEX IF NOT EXISTS idx_csd_set                ON public.chip_set_denomination(chip_set_id);
CREATE INDEX IF NOT EXISTS idx_csd_club               ON public.chip_set_denomination(club_id);
CREATE INDEX IF NOT EXISTS idx_tcs_chip_set           ON public.tournament_chip_set(chip_set_id);
CREATE INDEX IF NOT EXISTS idx_tcs_club               ON public.tournament_chip_set(club_id);
CREATE INDEX IF NOT EXISTS idx_st_tournament          ON public.stack_template(tournament_id);
CREATE INDEX IF NOT EXISTS idx_st_chip_set            ON public.stack_template(chip_set_id);
CREATE INDEX IF NOT EXISTS idx_st_club                ON public.stack_template(club_id);
CREATE INDEX IF NOT EXISTS idx_stl_template           ON public.stack_template_line(stack_template_id);
CREATE INDEX IF NOT EXISTS idx_stl_denom              ON public.stack_template_line(denomination_id);
CREATE INDEX IF NOT EXISTS idx_sti_club               ON public.stack_template_issuance(club_id);

-- ===========================================================================================
-- 2. Σ INVARIANT — one shared sum helper + a trigger fn fired by deferred constraint triggers.
-- ===========================================================================================

-- 2.1 Shared sum helper — SINGLE source of truth for Σ(line.count × denom.value).
--     Used by BOTH the trigger and the save RPC so the two can never diverge.
CREATE OR REPLACE FUNCTION public.chip_ops_stack_line_sum(p_template_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(l.count::bigint * d.value), 0)
  FROM public.stack_template_line l
  JOIN public.chip_set_denomination d ON d.id = l.denomination_id
  WHERE l.stack_template_id = p_template_id;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_stack_line_sum(uuid) FROM PUBLIC, anon;

-- 2.2 Trigger fn — rejects foreign-set denominations and any Σ ≠ stack_value.
CREATE OR REPLACE FUNCTION public.chip_ops_assert_stack_sum()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template_id uuid;
  v_stack_value bigint;
  v_sum         bigint;
  v_bad         uuid;
BEGIN
  IF TG_TABLE_NAME = 'stack_template' THEN
    v_template_id := NEW.id;
  ELSE
    v_template_id := COALESCE(NEW.stack_template_id, OLD.stack_template_id);
  END IF;

  -- Template may have been deleted in the same transaction (ON DELETE CASCADE removed its lines).
  SELECT st.stack_value INTO v_stack_value
  FROM public.stack_template st
  WHERE st.id = v_template_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Guard: every line's denomination must belong to the template's chip_set.
  SELECT l.denomination_id INTO v_bad
  FROM public.stack_template_line l
  JOIN public.stack_template t        ON t.id = l.stack_template_id
  JOIN public.chip_set_denomination d ON d.id = l.denomination_id
  WHERE l.stack_template_id = v_template_id
    AND d.chip_set_id <> t.chip_set_id
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CHIP_OPS_DENOM_NOT_IN_SET: denomination % does not belong to template % chip_set',
      v_bad, v_template_id USING ERRCODE = 'check_violation';
  END IF;

  v_sum := public.chip_ops_stack_line_sum(v_template_id);
  IF v_sum <> v_stack_value THEN
    RAISE EXCEPTION 'CHIP_OPS_STACK_SUM_MISMATCH: template % lines sum to % but stack_value is %',
      v_template_id, v_sum, v_stack_value USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL; -- AFTER constraint trigger ignores the return value
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_assert_stack_sum() FROM PUBLIC, anon;

-- 2.3 Constraint triggers — deferred so multi-line inserts are valid mid-transaction, checked at
--     COMMIT. The AFTER INSERT arm on stack_template rejects an empty (zero-line) raw-inserted
--     template (Σ=0 ≠ stack_value>0); the RPC path is unaffected (lines added before COMMIT).
DROP TRIGGER IF EXISTS trg_chip_ops_sum_line ON public.stack_template_line;
CREATE CONSTRAINT TRIGGER trg_chip_ops_sum_line
  AFTER INSERT OR UPDATE OR DELETE ON public.stack_template_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.chip_ops_assert_stack_sum();

DROP TRIGGER IF EXISTS trg_chip_ops_sum_template ON public.stack_template;
CREATE CONSTRAINT TRIGGER trg_chip_ops_sum_template
  AFTER INSERT OR UPDATE ON public.stack_template
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.chip_ops_assert_stack_sum();

-- ===========================================================================================
-- 3. RLS — every table: SELECT-only, OWNER-ONLY (is_club_owner covers owner + super_admin),
--    default-deny writes (no INSERT/UPDATE/DELETE policy → writes only via DEFINER RPCs).
--    (PATCH 1b extends these policies additively with OR is_club_chip_master(...).)
-- ===========================================================================================

ALTER TABLE public.chip_set                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chip_set_denomination   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_chip_set     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stack_template          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stack_template_line     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stack_template_issuance ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.chip_set                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chip_set_denomination   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tournament_chip_set     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stack_template          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stack_template_line     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.stack_template_issuance FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.chip_set                TO authenticated;
GRANT SELECT ON public.chip_set_denomination   TO authenticated;
GRANT SELECT ON public.tournament_chip_set     TO authenticated;
GRANT SELECT ON public.stack_template          TO authenticated;
GRANT SELECT ON public.stack_template_line     TO authenticated;
GRANT SELECT ON public.stack_template_issuance TO authenticated;

DROP POLICY IF EXISTS chip_set_select ON public.chip_set;
CREATE POLICY chip_set_select ON public.chip_set
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS chip_set_denomination_select ON public.chip_set_denomination;
CREATE POLICY chip_set_denomination_select ON public.chip_set_denomination
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS tournament_chip_set_select ON public.tournament_chip_set;
CREATE POLICY tournament_chip_set_select ON public.tournament_chip_set
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS stack_template_select ON public.stack_template;
CREATE POLICY stack_template_select ON public.stack_template
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS stack_template_issuance_select ON public.stack_template_issuance;
CREATE POLICY stack_template_issuance_select ON public.stack_template_issuance
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

-- stack_template_line has no club_id of its own → scope through its template.
DROP POLICY IF EXISTS stack_template_line_select ON public.stack_template_line;
CREATE POLICY stack_template_line_select ON public.stack_template_line
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stack_template st
    WHERE st.id = stack_template_line.stack_template_id
      AND st.club_id IS NOT NULL
      AND public.is_club_owner(auth.uid(), st.club_id)
  ));

-- ===========================================================================================
-- 4. READ-ONLY inventory RPC + sanitized (security_invoker) client read views.
-- ===========================================================================================

-- 4.1 get_issued_chip_inventory — server-computed inventory + self-reconciliation. Owner-scoped.
--     issued[denom]  = Σ_template ( line.count × issuance.issued_count )
--     total_value    = Σ ( denom.value × issued[denom] )
--     reconciliation = Σ_template ( stack_value × issued_count )  -- MUST equal total_value
CREATE OR REPLACE FUNCTION public.get_issued_chip_inventory(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_club   uuid;
  v_denoms jsonb;
  v_total  bigint;
  v_recon  bigint;
BEGIN
  SELECT t.club_id INTO v_club
  FROM public.tournaments t
  WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'TOURNAMENT_NOT_FOUND');
  END IF;

  IF v_uid IS NULL OR NOT public.is_club_owner(v_uid, v_club) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  WITH per_denom AS (
    SELECT d.id AS denomination_id, d.value, d.color,
           SUM(l.count::bigint * COALESCE(i.issued_count, 0))::bigint AS issued_count_total
    FROM public.stack_template st
    JOIN public.stack_template_line l         ON l.stack_template_id = st.id
    JOIN public.chip_set_denomination d       ON d.id = l.denomination_id
    LEFT JOIN public.stack_template_issuance i ON i.stack_template_id = st.id
    WHERE st.tournament_id = p_tournament_id
    GROUP BY d.id, d.value, d.color
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'denomination_id',    pd.denomination_id,
      'value',              pd.value,
      'color',              pd.color,
      'issued_count_total', pd.issued_count_total
    ) ORDER BY pd.value), '[]'::jsonb),
    COALESCE(SUM(pd.value * pd.issued_count_total), 0)::bigint
  INTO v_denoms, v_total
  FROM per_denom pd;

  SELECT COALESCE(SUM(st.stack_value * COALESCE(i.issued_count, 0)), 0)::bigint
  INTO v_recon
  FROM public.stack_template st
  LEFT JOIN public.stack_template_issuance i ON i.stack_template_id = st.id
  WHERE st.tournament_id = p_tournament_id;

  RETURN jsonb_build_object(
    'tournament_id',        p_tournament_id,
    'denominations',        v_denoms,
    'total_value',          v_total,
    'reconciliation_value', v_recon,
    'reconciled',           (v_total = v_recon)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_issued_chip_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_issued_chip_inventory(uuid) TO authenticated;

-- 4.2 Sanitized client read views (security_invoker → base-table RLS scopes them).
CREATE OR REPLACE VIEW public.chip_set_v WITH (security_invoker = on) AS
  SELECT id, club_id, name, description, is_active, created_at FROM public.chip_set;

CREATE OR REPLACE VIEW public.chip_set_denomination_v WITH (security_invoker = on) AS
  SELECT id, chip_set_id, club_id, value, color, label, display_order FROM public.chip_set_denomination;

CREATE OR REPLACE VIEW public.tournament_chip_set_v WITH (security_invoker = on) AS
  SELECT tournament_id, chip_set_id, club_id, created_at FROM public.tournament_chip_set;

CREATE OR REPLACE VIEW public.stack_template_v WITH (security_invoker = on) AS
  SELECT id, tournament_id, club_id, chip_set_id, name, stack_value, created_at FROM public.stack_template;

CREATE OR REPLACE VIEW public.stack_template_line_v WITH (security_invoker = on) AS
  SELECT l.id, l.stack_template_id, l.denomination_id, l.count,
         d.value AS denomination_value, d.color AS denomination_color
  FROM public.stack_template_line l
  JOIN public.chip_set_denomination d ON d.id = l.denomination_id;

REVOKE ALL ON public.chip_set_v               FROM PUBLIC, anon;
REVOKE ALL ON public.chip_set_denomination_v  FROM PUBLIC, anon;
REVOKE ALL ON public.tournament_chip_set_v    FROM PUBLIC, anon;
REVOKE ALL ON public.stack_template_v         FROM PUBLIC, anon;
REVOKE ALL ON public.stack_template_line_v    FROM PUBLIC, anon;

GRANT SELECT ON public.chip_set_v              TO authenticated;
GRANT SELECT ON public.chip_set_denomination_v TO authenticated;
GRANT SELECT ON public.tournament_chip_set_v   TO authenticated;
GRANT SELECT ON public.stack_template_v        TO authenticated;
GRANT SELECT ON public.stack_template_line_v   TO authenticated;

-- ===========================================================================================
-- 5. CONFIG-WRITE RPCs — client sends intent; server validates + writes. club_id is ALWAYS
--    server-derived from the authoritative parent (never trusted from the client). Auth gate =
--    public.is_club_owner(auth.uid(), <derived club>). Default-deny RLS means these DEFINER
--    functions are the only write path.
-- ===========================================================================================

-- 5.1 create chip set (the ONLY RPC taking a client club_id → gate on it BEFORE any insert).
CREATE OR REPLACE FUNCTION public.chip_ops_create_chip_set(
  p_club_id     uuid,
  p_name        text,
  p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'name');
  END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  BEGIN
    INSERT INTO public.chip_set (club_id, name, description, created_by)
    VALUES (p_club_id, btrim(p_name), p_description, v_uid)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'NAME_EXISTS');
  END;
  RETURN jsonb_build_object('status', 'ok', 'chip_set_id', v_id);
END;
$$;

-- 5.2 add denomination.
CREATE OR REPLACE FUNCTION public.chip_ops_add_denomination(
  p_chip_set_id   uuid,
  p_value         bigint,
  p_color         text DEFAULT NULL,
  p_label         text DEFAULT NULL,
  p_display_order integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_club uuid;
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_value IS NULL OR p_value <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'value');
  END IF;
  SELECT cs.club_id INTO v_club FROM public.chip_set cs WHERE cs.id = p_chip_set_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'CHIP_SET_NOT_FOUND'); END IF;
  IF NOT public.is_club_owner(v_uid, v_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  BEGIN
    INSERT INTO public.chip_set_denomination
      (chip_set_id, club_id, value, color, label, display_order, created_by)
    VALUES (p_chip_set_id, v_club, p_value, p_color, p_label, COALESCE(p_display_order, 0), v_uid)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error', 'VALUE_EXISTS');
  END;
  RETURN jsonb_build_object('status', 'ok', 'denomination_id', v_id);
END;
$$;

-- 5.3 delete denomination — escape hatch, allowed only when unused by any template line.
CREATE OR REPLACE FUNCTION public.chip_ops_delete_denomination(
  p_denomination_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_club uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  SELECT d.club_id INTO v_club FROM public.chip_set_denomination d WHERE d.id = p_denomination_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'DENOM_NOT_FOUND'); END IF;
  IF NOT public.is_club_owner(v_uid, v_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  IF EXISTS (SELECT 1 FROM public.stack_template_line l WHERE l.denomination_id = p_denomination_id) THEN
    RETURN jsonb_build_object('error', 'DENOM_IN_USE');
  END IF;
  DELETE FROM public.chip_set_denomination WHERE id = p_denomination_id;
  RETURN jsonb_build_object('status', 'ok', 'denomination_id', p_denomination_id);
END;
$$;

-- 5.4 bind tournament -> chip set (insert / idempotent / rebind w/ lock when templates exist).
CREATE OR REPLACE FUNCTION public.chip_ops_bind_tournament_chip_set(
  p_tournament_id uuid,
  p_chip_set_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_t_club   uuid;
  v_cs_club  uuid;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  SELECT t.club_id INTO v_t_club
  FROM public.tournaments t
  WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TOURNAMENT_NOT_FOUND'); END IF;

  IF NOT public.is_club_owner(v_uid, v_t_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  SELECT cs.club_id INTO v_cs_club FROM public.chip_set cs WHERE cs.id = p_chip_set_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'CHIP_SET_NOT_FOUND'); END IF;
  IF v_cs_club <> v_t_club THEN RETURN jsonb_build_object('error', 'CHIP_SET_CLUB_MISMATCH'); END IF;

  SELECT tcs.chip_set_id INTO v_existing
  FROM public.tournament_chip_set tcs WHERE tcs.tournament_id = p_tournament_id;

  IF NOT FOUND THEN
    INSERT INTO public.tournament_chip_set (tournament_id, chip_set_id, club_id, created_by)
    VALUES (p_tournament_id, p_chip_set_id, v_t_club, v_uid);
    RETURN jsonb_build_object('status', 'ok', 'action', 'bound', 'chip_set_id', p_chip_set_id);
  ELSIF v_existing = p_chip_set_id THEN
    RETURN jsonb_build_object('status', 'ok', 'action', 'unchanged', 'chip_set_id', p_chip_set_id);
  ELSE
    BEGIN
      UPDATE public.tournament_chip_set
      SET chip_set_id = p_chip_set_id
      WHERE tournament_id = p_tournament_id;
    EXCEPTION WHEN foreign_key_violation THEN
      RETURN jsonb_build_object('error', 'BINDING_LOCKED_TEMPLATES_EXIST');
    END;
    RETURN jsonb_build_object('status', 'ok', 'action', 'rebound', 'chip_set_id', p_chip_set_id);
  END IF;
END;
$$;

-- 5.5 save stack template + lines (atomic, Σ validated via the shared helper — single source).
CREATE OR REPLACE FUNCTION public.chip_ops_save_stack_template(
  p_tournament_id uuid,
  p_name          text,
  p_stack_value   bigint,
  p_lines         jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_club     uuid;
  v_chip_set uuid;
  v_tid      uuid;
  v_sum      bigint;
  v_n        integer;
  v_distinct integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'name');
  END IF;
  IF p_stack_value IS NULL OR p_stack_value <= 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'stack_value');
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'lines');
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'lines_empty');
  END IF;

  -- Authoritative binding → derive club + chip_set (never trust client club).
  SELECT tcs.club_id, tcs.chip_set_id INTO v_club, v_chip_set
  FROM public.tournament_chip_set tcs
  WHERE tcs.tournament_id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_CHIP_SET_BINDING'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'TOURNAMENT_NOT_FOUND');
  END IF;

  IF NOT public.is_club_owner(v_uid, v_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  -- Validate line shape (non-null denom, positive count).
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(denomination_id uuid, count integer)
    WHERE x.denomination_id IS NULL OR x.count IS NULL OR x.count <= 0
  ) THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'line');
  END IF;

  -- Reject duplicate denominations within the payload.
  SELECT count(*), count(DISTINCT x.denomination_id) INTO v_n, v_distinct
  FROM jsonb_to_recordset(p_lines) AS x(denomination_id uuid, count integer);
  IF v_n <> v_distinct THEN RETURN jsonb_build_object('error', 'DUPLICATE_DENOM'); END IF;

  -- Every denomination must belong to the bound chip set.
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(denomination_id uuid, count integer)
    LEFT JOIN public.chip_set_denomination d
      ON d.id = x.denomination_id AND d.chip_set_id = v_chip_set
    WHERE d.id IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'DENOM_NOT_IN_SET');
  END IF;

  -- Insert template + lines; validate Σ via the shared helper; roll back on mismatch.
  BEGIN
    INSERT INTO public.stack_template (tournament_id, club_id, chip_set_id, name, stack_value, created_by)
    VALUES (p_tournament_id, v_club, v_chip_set, btrim(p_name), p_stack_value, v_uid)
    RETURNING id INTO v_tid;

    INSERT INTO public.stack_template_line (stack_template_id, denomination_id, count)
    SELECT v_tid, x.denomination_id, x.count
    FROM jsonb_to_recordset(p_lines) AS x(denomination_id uuid, count integer);

    v_sum := public.chip_ops_stack_line_sum(v_tid);
    IF v_sum <> p_stack_value THEN
      RAISE EXCEPTION 'STACK_SUM_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('error', 'NAME_EXISTS');
    WHEN check_violation THEN
      RETURN jsonb_build_object('error', 'STACK_SUM_MISMATCH',
                                'expected', p_stack_value, 'got', v_sum);
  END;

  RETURN jsonb_build_object('status', 'ok', 'stack_template_id', v_tid,
                            'stack_value', p_stack_value, 'sum', v_sum);
END;
$$;

-- 5.6 set per-template issuance count (UPSERT).
CREATE OR REPLACE FUNCTION public.chip_ops_set_issuance(
  p_stack_template_id uuid,
  p_issued_count      integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_club uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_issued_count IS NULL OR p_issued_count < 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'issued_count');
  END IF;
  SELECT st.club_id INTO v_club FROM public.stack_template st WHERE st.id = p_stack_template_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'TEMPLATE_NOT_FOUND'); END IF;
  IF NOT public.is_club_owner(v_uid, v_club) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  INSERT INTO public.stack_template_issuance (stack_template_id, issued_count, club_id, updated_by)
  VALUES (p_stack_template_id, p_issued_count, v_club, v_uid)
  ON CONFLICT (stack_template_id)
  DO UPDATE SET issued_count = EXCLUDED.issued_count, updated_at = now(), updated_by = EXCLUDED.updated_by;

  RETURN jsonb_build_object('status', 'ok', 'stack_template_id', p_stack_template_id,
                            'issued_count', p_issued_count);
END;
$$;

-- 5.7 Function grants — least privilege; writes happen only through these DEFINER RPCs.
REVOKE ALL ON FUNCTION public.chip_ops_create_chip_set(uuid, text, text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chip_ops_add_denomination(uuid, bigint, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chip_ops_delete_denomination(uuid)                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chip_ops_bind_tournament_chip_set(uuid, uuid)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chip_ops_save_stack_template(uuid, text, bigint, jsonb)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chip_ops_set_issuance(uuid, integer)                     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.chip_ops_create_chip_set(uuid, text, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.chip_ops_add_denomination(uuid, bigint, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chip_ops_delete_denomination(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.chip_ops_bind_tournament_chip_set(uuid, uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.chip_ops_save_stack_template(uuid, text, bigint, jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.chip_ops_set_issuance(uuid, integer)                     TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (run inside a transaction, then ROLLBACK). Replace <…> with
-- disposable ids: <club> a club you own, <tournament> a tournaments row (deleted_at IS NULL,
-- club_id=<club>).
--
-- BEGIN;
--   SELECT public.chip_ops_create_chip_set('<club>', 'Test Set');                 -- -> chip_set_id <cs>
--   SELECT public.chip_ops_add_denomination('<cs>', 100,  'white');               -- -> <d100>
--   SELECT public.chip_ops_add_denomination('<cs>', 500,  'red');                 -- -> <d500>
--   SELECT public.chip_ops_add_denomination('<cs>', 1000, 'blue');                -- -> <d1k>
--   SELECT public.chip_ops_add_denomination('<cs>', 5000, 'green');               -- -> <d5k>
--   SELECT public.chip_ops_bind_tournament_chip_set('<tournament>', '<cs>');      -- -> action: bound
--
--   -- [T1] Σ REJECTION via RPC (lines sum to 100, not 30000):
--   SELECT public.chip_ops_save_stack_template('<tournament>', 'bad', 30000,
--     '[{"denomination_id":"<d100>","count":1}]'::jsonb);
--     -- EXPECT {"error":"STACK_SUM_MISMATCH","expected":30000,"got":100}
--
--   -- [T1b] Σ REJECTION via raw insert (deferred trigger, forced immediate):
--   SAVEPOINT s1;
--     INSERT INTO public.stack_template (tournament_id, club_id, chip_set_id, name, stack_value)
--     VALUES ('<tournament>','<club>','<cs>','bad2',30000) RETURNING id;          -- -> <tb>
--     INSERT INTO public.stack_template_line (stack_template_id, denomination_id, count)
--     VALUES ('<tb>','<d100>',1);
--     SET CONSTRAINTS trg_chip_ops_sum_line, trg_chip_ops_sum_template IMMEDIATE; -- EXPECT ERROR CHIP_OPS_STACK_SUM_MISMATCH
--   ROLLBACK TO SAVEPOINT s1;
--
--   -- [T2] EMPTY-TEMPLATE REJECTION (raw insert, zero lines):
--   SAVEPOINT s2;
--     INSERT INTO public.stack_template (tournament_id, club_id, chip_set_id, name, stack_value)
--     VALUES ('<tournament>','<club>','<cs>','empty',30000);
--     SET CONSTRAINTS trg_chip_ops_sum_template IMMEDIATE;                        -- EXPECT ERROR (Σ=0 ≠ 30000)
--   ROLLBACK TO SAVEPOINT s2;
--
--   -- [T3] Σ ACCEPTANCE via RPC:
--   SELECT public.chip_ops_save_stack_template('<tournament>', '30K mix', 30000,
--     '[{"denomination_id":"<d100>","count":10},{"denomination_id":"<d500>","count":8},
--       {"denomination_id":"<d1k>","count":5},{"denomination_id":"<d5k>","count":4}]'::jsonb);
--     -- EXPECT {"status":"ok",...,"sum":30000}  -> remember stack_template_id <t_mix>
--   SELECT public.chip_ops_save_stack_template('<tournament>', '30K full 5K', 30000,
--     '[{"denomination_id":"<d5k>","count":6}]'::jsonb);                          -- -> <t_full>
--
--   -- [T4] DENOM_NOT_IN_SET (denom from another chip set is rejected):
--   --   create a 2nd chip set + denom in <club>, then try to use it in <tournament>'s template.
--   SELECT public.chip_ops_create_chip_set('<club>', 'Other Set');               -- -> <cs2>
--   SELECT public.chip_ops_add_denomination('<cs2>', 25, 'pink');                -- -> <d25b>
--   SELECT public.chip_ops_save_stack_template('<tournament>', 'foreign', 25,
--     '[{"denomination_id":"<d25b>","count":1}]'::jsonb);                         -- EXPECT {"error":"DENOM_NOT_IN_SET"}
--
--   -- [T5] BINDING_LOCKED_TEMPLATES_EXIST (rebind blocked once templates exist):
--   SELECT public.chip_ops_bind_tournament_chip_set('<tournament>', '<cs2>');     -- EXPECT {"error":"BINDING_LOCKED_TEMPLATES_EXIST"}
--
--   -- [T6] ISSUANCE + INVENTORY + RECONCILIATION:
--   SELECT public.chip_ops_set_issuance('<t_mix>',  200);
--   SELECT public.chip_ops_set_issuance('<t_full>',  69);
--   SELECT public.get_issued_chip_inventory('<tournament>');
--     -- EXPECT denominations: 100->2000, 500->1600, 1000->1000, 5000->1214 ;
--     --        total_value=8070000, reconciliation_value=8070000, reconciled=true  (= 269 × 30000)
--
--   -- [T7] AUTHZ (run as a user who is neither owner nor super_admin of <club>):
--   --   SELECT public.get_issued_chip_inventory('<tournament>');   -- EXPECT {"error":"Forbidden"}
--   --   SELECT * FROM public.chip_set WHERE id = '<cs>';           -- EXPECT 0 rows (RLS)
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration), in dependency order:
--   DROP FUNCTION IF EXISTS public.chip_ops_set_issuance(uuid, integer);
--   DROP FUNCTION IF EXISTS public.chip_ops_save_stack_template(uuid, text, bigint, jsonb);
--   DROP FUNCTION IF EXISTS public.chip_ops_bind_tournament_chip_set(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.chip_ops_delete_denomination(uuid);
--   DROP FUNCTION IF EXISTS public.chip_ops_add_denomination(uuid, bigint, text, text, integer);
--   DROP FUNCTION IF EXISTS public.chip_ops_create_chip_set(uuid, text, text);
--   DROP VIEW IF EXISTS public.stack_template_line_v;
--   DROP VIEW IF EXISTS public.stack_template_v;
--   DROP VIEW IF EXISTS public.tournament_chip_set_v;
--   DROP VIEW IF EXISTS public.chip_set_denomination_v;
--   DROP VIEW IF EXISTS public.chip_set_v;
--   DROP FUNCTION IF EXISTS public.get_issued_chip_inventory(uuid);
--   DROP TRIGGER IF EXISTS trg_chip_ops_sum_template ON public.stack_template;
--   DROP TRIGGER IF EXISTS trg_chip_ops_sum_line ON public.stack_template_line;
--   DROP FUNCTION IF EXISTS public.chip_ops_assert_stack_sum();
--   DROP FUNCTION IF EXISTS public.chip_ops_stack_line_sum(uuid);
--   DROP TABLE IF EXISTS public.stack_template_issuance;
--   DROP TABLE IF EXISTS public.stack_template_line;
--   DROP TABLE IF EXISTS public.stack_template;          -- drops st_chipset_matches_binding FK
--   DROP TABLE IF EXISTS public.tournament_chip_set;
--   DROP TABLE IF EXISTS public.chip_set_denomination;
--   DROP TABLE IF EXISTS public.chip_set;
-- ===========================================================================================
