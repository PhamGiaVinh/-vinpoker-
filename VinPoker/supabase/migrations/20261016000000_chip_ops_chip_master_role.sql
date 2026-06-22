-- Chip Ops — Chip-Master role + authz widening (PATCH 1b). DEPENDS ON 1a (20261015000000).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply 1a THEN this in a controlled session
-- (Management API / `supabase db query --linked --file`, NOT `db push` / not deploy_db). Regen
-- types.ts in a SEPARATE step. schema_migrations is NOT touched.
--
-- WHY: 1a is OWNER-ONLY. This adds a club-scoped **Chip-Master** operator role so an owner can
-- delegate chip-set / stack-template / issuance configuration without granting club ownership.
--
-- WHAT (additive, idempotent):
--   1. public.club_chip_masters membership table (mirrors public.club_trackers) + RLS.
--   2. public.is_club_chip_master(_user_id,_club_id) — SECURITY DEFINER STABLE pure lookup.
--   3. Widen 1a's 6 table SELECT policies + get_issued_chip_inventory + the 6 config-write RPCs
--      from `is_club_owner(...)` to `(is_club_owner(...) OR is_club_chip_master(...))`.
--   4. Owner-gated grant/revoke RPCs (no self-escalation — chip_master CANNOT grant).
--
-- NO change to the shared public.app_role enum. NO cross-schema FK/write into Cashier,
-- Registration, Tracker, Dealer Swing, Payroll, Staking, Bankroll, Account/Documents/Feed,
-- online engine, or Tournament Structure. Cashiers remain excluded from Chip Ops.

-- ===========================================================================================
-- 1. Role membership table (shape mirrors public.club_trackers).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.club_chip_masters (
  club_id    uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_chip_masters_pkey PRIMARY KEY (club_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ccm_user ON public.club_chip_masters(user_id);

ALTER TABLE public.club_chip_masters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_chip_masters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.club_chip_masters TO authenticated;

-- A member can read their own row; the club owner (+ super_admin via the helper) reads all rows
-- of their club. Writes are default-deny → only the owner-gated grant/revoke RPCs below.
DROP POLICY IF EXISTS club_chip_masters_select ON public.club_chip_masters;
CREATE POLICY club_chip_masters_select ON public.club_chip_masters
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_club_owner(auth.uid(), club_id));

-- ===========================================================================================
-- 2. Membership helper — pure lookup. Pass auth.uid() in policies so a caller can only test
--    their own membership.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.is_club_chip_master(_user_id uuid, _club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_chip_masters m
    WHERE m.user_id = _user_id AND m.club_id = _club_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_club_chip_master(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_club_chip_master(uuid, uuid) TO authenticated;

-- ===========================================================================================
-- 3a. Widen the 6 table SELECT policies: owner -> (owner OR chip_master).
-- ===========================================================================================
DROP POLICY IF EXISTS chip_set_select ON public.chip_set;
CREATE POLICY chip_set_select ON public.chip_set
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS chip_set_denomination_select ON public.chip_set_denomination;
CREATE POLICY chip_set_denomination_select ON public.chip_set_denomination
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS tournament_chip_set_select ON public.tournament_chip_set;
CREATE POLICY tournament_chip_set_select ON public.tournament_chip_set
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS stack_template_select ON public.stack_template;
CREATE POLICY stack_template_select ON public.stack_template
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS stack_template_issuance_select ON public.stack_template_issuance;
CREATE POLICY stack_template_issuance_select ON public.stack_template_issuance
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS stack_template_line_select ON public.stack_template_line;
CREATE POLICY stack_template_line_select ON public.stack_template_line
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.stack_template st
    WHERE st.id = stack_template_line.stack_template_id
      AND st.club_id IS NOT NULL
      AND (public.is_club_owner(auth.uid(), st.club_id)
           OR public.is_club_chip_master(auth.uid(), st.club_id))
  ));

-- ===========================================================================================
-- 3b. Widen the read inventory RPC: owner -> (owner OR chip_master). Body otherwise identical
--     to 1a (CREATE OR REPLACE replaces the whole function).
-- ===========================================================================================
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

  IF v_uid IS NULL OR NOT (public.is_club_owner(v_uid, v_club)
                           OR public.is_club_chip_master(v_uid, v_club)) THEN
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

-- ===========================================================================================
-- 3c. Widen the 6 config-write RPCs: owner -> (owner OR chip_master). Bodies identical to 1a
--     except the authz gate.
-- ===========================================================================================
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
  IF NOT (public.is_club_owner(v_uid, p_club_id) OR public.is_club_chip_master(v_uid, p_club_id)) THEN
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
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
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
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF EXISTS (SELECT 1 FROM public.stack_template_line l WHERE l.denomination_id = p_denomination_id) THEN
    RETURN jsonb_build_object('error', 'DENOM_IN_USE');
  END IF;
  DELETE FROM public.chip_set_denomination WHERE id = p_denomination_id;
  RETURN jsonb_build_object('status', 'ok', 'denomination_id', p_denomination_id);
END;
$$;

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

  IF NOT (public.is_club_owner(v_uid, v_t_club) OR public.is_club_chip_master(v_uid, v_t_club)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

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

  SELECT tcs.club_id, tcs.chip_set_id INTO v_club, v_chip_set
  FROM public.tournament_chip_set tcs
  WHERE tcs.tournament_id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NO_CHIP_SET_BINDING'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'TOURNAMENT_NOT_FOUND');
  END IF;

  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(denomination_id uuid, count integer)
    WHERE x.denomination_id IS NULL OR x.count IS NULL OR x.count <= 0
  ) THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'line');
  END IF;

  SELECT count(*), count(DISTINCT x.denomination_id) INTO v_n, v_distinct
  FROM jsonb_to_recordset(p_lines) AS x(denomination_id uuid, count integer);
  IF v_n <> v_distinct THEN RETURN jsonb_build_object('error', 'DUPLICATE_DENOM'); END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(denomination_id uuid, count integer)
    LEFT JOIN public.chip_set_denomination d
      ON d.id = x.denomination_id AND d.chip_set_id = v_chip_set
    WHERE d.id IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'DENOM_NOT_IN_SET');
  END IF;

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
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;

  INSERT INTO public.stack_template_issuance (stack_template_id, issued_count, club_id, updated_by)
  VALUES (p_stack_template_id, p_issued_count, v_club, v_uid)
  ON CONFLICT (stack_template_id)
  DO UPDATE SET issued_count = EXCLUDED.issued_count, updated_at = now(), updated_by = EXCLUDED.updated_by;

  RETURN jsonb_build_object('status', 'ok', 'stack_template_id', p_stack_template_id,
                            'issued_count', p_issued_count);
END;
$$;

-- ===========================================================================================
-- 4. Owner-gated grant/revoke RPCs. is_club_owner ONLY (covers super_admin) — a chip_master
--    CANNOT grant/revoke (no self-escalation).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_grant_chip_master(
  p_club_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_user_id IS NULL THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'user_id'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  INSERT INTO public.club_chip_masters (club_id, user_id, granted_by)
  VALUES (p_club_id, p_user_id, v_uid)
  ON CONFLICT (club_id, user_id) DO NOTHING;
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.chip_ops_revoke_chip_master(
  p_club_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  DELETE FROM public.club_chip_masters WHERE club_id = p_club_id AND user_id = p_user_id;
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_grant_chip_master(uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chip_ops_revoke_chip_master(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_grant_chip_master(uuid, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.chip_ops_revoke_chip_master(uuid, uuid) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 1a THEN this; run inside a transaction, then ROLLBACK).
--   <owner> owns <club>; <cm> is a chip_master to be granted; <other> is unrelated;
--   <tournament> belongs to <club> with a 30K mix + 30K full 5K template (see 1a test plan),
--   issued 200 + 69.
--
-- BEGIN;
--   -- grant/revoke authz (owner only):
--   SET test.uid = '<owner>'; SELECT public.chip_ops_grant_chip_master('<club>','<cm>');   -- ok
--   SET test.uid = '<cm>';    SELECT public.chip_ops_grant_chip_master('<club>','<other>'); -- Forbidden (no self-escalation)
--
--   -- chip_master can now read inventory + see rows:
--   SET test.uid = '<cm>';
--   SELECT public.get_issued_chip_inventory('<tournament>');
--     -- EXPECT T100 2000 / T500 1600 / T1000 1000 / T5000 1214, total 8070000, reconciled=true
--   SET ROLE authenticated;  -- (with request uid = <cm>) SELECT count(*) FROM public.chip_set_v; -- >=1
--
--   -- non-member still blocked:
--   SET test.uid = '<other>'; SELECT public.get_issued_chip_inventory('<tournament>');  -- Forbidden
--
--   -- revoke removes access:
--   SET test.uid = '<owner>'; SELECT public.chip_ops_revoke_chip_master('<club>','<cm>');
--   SET test.uid = '<cm>';    SELECT public.get_issued_chip_inventory('<tournament>');  -- Forbidden again
-- ROLLBACK;
-- ===========================================================================================
--
-- ===========================================================================================
-- ROLLBACK (undo this migration) — revert the widened policies/RPCs back to OWNER-ONLY (1a),
-- then drop the role objects. (Re-running 1a's migration also restores the owner-only forms.)
--   -- 1) revert the 6 SELECT policies to owner-only:
--   DROP POLICY IF EXISTS chip_set_select ON public.chip_set;
--   CREATE POLICY chip_set_select ON public.chip_set FOR SELECT TO authenticated
--     USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));
--   -- (repeat owner-only form for chip_set_denomination_select, tournament_chip_set_select,
--   --  stack_template_select, stack_template_issuance_select, and stack_template_line_select.)
--   -- 2) CREATE OR REPLACE get_issued_chip_inventory + the 6 config-write RPCs back to the 1a
--   --    bodies (owner-only gate).  [easiest: re-apply 20261015000000_chip_ops_foundation.sql]
--   -- 3) drop role objects:
--   DROP FUNCTION IF EXISTS public.chip_ops_revoke_chip_master(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.chip_ops_grant_chip_master(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.is_club_chip_master(uuid, uuid);
--   DROP TABLE IF EXISTS public.club_chip_masters;
-- ===========================================================================================
