-- Chip Ops — Phase 2B: inventory ledger keystone + chip bank (két, Model B = manual) + xuất/thu.
-- DEPENDS ON 1a (20261015000000) + 1b (20261016000000).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL
-- Editor / Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: today's inventory is COMPUTED + immutable (issued = Σ templates × issuance). To let
-- color-up / manual corrections change it while staying reconciled, this adds an APPEND-ONLY
-- inventory ledger so `current[denom] = issued[denom] + Σ(ledger deltas)`. It also adds a
-- club-level physical chip BANK (két) with append-only xuất/thu events.
--
-- MODEL B (MVP, per strict-review P0-1): the bank is a MANUAL ledger. Color-up (Phase 2C) writes
-- ONLY the floor inventory ledger and does NOT auto-touch the bank; the operator records bank
-- xuất/thu by hand. Full auto-coupling (issuance→xuất, color-up→thu+xuất) = Model A, a later patch.
-- => the floor ledger reasons do NOT include bank_*; bank ops write only chip_bank_ledger.
--
-- get_issued_chip_inventory (1a) is left UNTOUCHED (config truth). get_current_chip_inventory is a
-- superset (adds current_count); with an empty ledger the two agree exactly.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS.

-- ===========================================================================================
-- 1. Append-only FLOOR inventory ledger (the keystone)
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.chip_inventory_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.chip_set_denomination(id) ON DELETE RESTRICT,
  delta_count     bigint NOT NULL,                 -- signed: negative = removed from floor, positive = added
  reason          text NOT NULL,
  ref_type        text,                            -- 'color_up_operation' | 'day_close' | 'manual' | null
  ref_id          uuid,                            -- soft pointer (no FK — keeps the table append-only/clean)
  actor           uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cil_reason_chk CHECK (reason IN ('color_up_out','color_up_in','race_rounding','manual_adjust'))
);
CREATE INDEX IF NOT EXISTS idx_cil_tourn_denom ON public.chip_inventory_ledger(tournament_id, denomination_id);
CREATE INDEX IF NOT EXISTS idx_cil_club        ON public.chip_inventory_ledger(club_id);
CREATE INDEX IF NOT EXISTS idx_cil_ref         ON public.chip_inventory_ledger(ref_type, ref_id);

-- ===========================================================================================
-- 2. Chip BANK (két) — per club+denom current physical stock (CAS via version)
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.chip_bank (
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.chip_set_denomination(id) ON DELETE RESTRICT,
  on_hand_count   bigint NOT NULL DEFAULT 0,
  version         integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT auth.uid(),
  CONSTRAINT chip_bank_pkey PRIMARY KEY (club_id, denomination_id),
  CONSTRAINT chip_bank_nonneg CHECK (on_hand_count >= 0)   -- hard floor: block overdraw (P2-5 default)
);
CREATE INDEX IF NOT EXISTS idx_chip_bank_denom ON public.chip_bank(denomination_id);

-- ===========================================================================================
-- 3. Append-only BANK ledger (xuất/thu events)
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.chip_bank_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.chip_set_denomination(id) ON DELETE RESTRICT,
  tournament_id   uuid REFERENCES public.tournaments(id) ON DELETE SET NULL,
  direction       text NOT NULL CHECK (direction IN ('xuat','thu')),
  count           bigint NOT NULL CHECK (count > 0),
  balance_after   bigint NOT NULL,
  reason          text,
  ref_type        text,
  ref_id          uuid,
  idempotency_key text,
  actor           uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  details         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_cbl_club_denom ON public.chip_bank_ledger(club_id, denomination_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cbl_idempotency ON public.chip_bank_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ===========================================================================================
-- 4. RLS — SELECT-only, owner OR chip_master (default-deny writes → RPC-only). Append-only tables
--    have no UPDATE/DELETE policy.
-- ===========================================================================================
ALTER TABLE public.chip_inventory_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chip_bank             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chip_bank_ledger      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.chip_inventory_ledger FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chip_bank             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.chip_bank_ledger      FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chip_inventory_ledger TO authenticated;
GRANT SELECT ON public.chip_bank             TO authenticated;
GRANT SELECT ON public.chip_bank_ledger      TO authenticated;

DROP POLICY IF EXISTS chip_inventory_ledger_select ON public.chip_inventory_ledger;
CREATE POLICY chip_inventory_ledger_select ON public.chip_inventory_ledger
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS chip_bank_select ON public.chip_bank;
CREATE POLICY chip_bank_select ON public.chip_bank
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS chip_bank_ledger_select ON public.chip_bank_ledger;
CREATE POLICY chip_bank_ledger_select ON public.chip_bank_ledger
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

-- ===========================================================================================
-- 5. Shared helper — current denom counts = issued (1a) + Σ ledger deltas. Single source for the
--    inventory RPC + (later) color-up snapshots + day-close expected. Internal (DEFINER); no
--    grant to authenticated (only DEFINER callers, running as owner, invoke it).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_current_denom_counts(p_tournament_id uuid)
RETURNS TABLE(denomination_id uuid, value bigint, color text, issued_count bigint, current_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH issued AS (
    SELECT d.id AS denomination_id, d.value, d.color,
           SUM(l.count::bigint * COALESCE(i.issued_count, 0))::bigint AS issued_count_total
    FROM public.stack_template st
    JOIN public.stack_template_line l         ON l.stack_template_id = st.id
    JOIN public.chip_set_denomination d       ON d.id = l.denomination_id
    LEFT JOIN public.stack_template_issuance i ON i.stack_template_id = st.id
    WHERE st.tournament_id = p_tournament_id
    GROUP BY d.id, d.value, d.color
  ),
  ledger AS (
    SELECT denomination_id, COALESCE(SUM(delta_count),0)::bigint AS delta
    FROM public.chip_inventory_ledger
    WHERE tournament_id = p_tournament_id
    GROUP BY denomination_id
  )
  SELECT d.id AS denomination_id, d.value, d.color,
         COALESCE(i.issued_count_total,0)::bigint AS issued_count,
         (COALESCE(i.issued_count_total,0) + COALESCE(g.delta,0))::bigint AS current_count
  FROM public.chip_set_denomination d
  LEFT JOIN issued i ON i.denomination_id = d.id
  LEFT JOIN ledger g ON g.denomination_id = d.id
  WHERE d.id IN (SELECT denomination_id FROM issued UNION SELECT denomination_id FROM ledger);
$$;

REVOKE ALL ON FUNCTION public.chip_ops_current_denom_counts(uuid) FROM PUBLIC, anon;

-- ===========================================================================================
-- 6. Read RPC — current inventory (issued + ledger), owner/chip-master scoped. Superset of
--    get_issued_chip_inventory; empty ledger ⇒ identical total_value (safe drop-in).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.get_current_chip_inventory(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_club    uuid;
  v_denoms  jsonb;
  v_total   bigint;
  v_issued  bigint;
BEGIN
  SELECT t.club_id INTO v_club
  FROM public.tournaments t
  WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF v_uid IS NULL OR NOT (public.is_club_owner(v_uid, v_club)
                           OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'denomination_id',    c.denomination_id,
      'value',              c.value,
      'color',              c.color,
      'issued_count_total', c.issued_count,
      'current_count',      c.current_count
    ) ORDER BY c.value), '[]'::jsonb),
    COALESCE(SUM(c.value * c.current_count), 0)::bigint,
    COALESCE(SUM(c.value * c.issued_count), 0)::bigint
  INTO v_denoms, v_total, v_issued
  FROM public.chip_ops_current_denom_counts(p_tournament_id) c;

  RETURN jsonb_build_object(
    'tournament_id',      p_tournament_id,
    'denominations',      v_denoms,
    'total_value',        v_total,
    'issued_total_value', v_issued,
    'ledger_delta_value', (v_total - v_issued),
    'reconciled',         (v_total = v_issued)   -- ledger nets to zero VALUE (conservation held)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_chip_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_chip_inventory(uuid) TO authenticated;

-- ===========================================================================================
-- 7. Bank read + adjust RPCs (owner/chip-master).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.get_chip_bank(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_denoms jsonb;
BEGIN
  IF v_uid IS NULL OR NOT (public.is_club_owner(v_uid, p_club_id)
                           OR public.is_club_chip_master(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'denomination_id', d.id,
           'value',           d.value,
           'color',           d.color,
           'on_hand_count',   COALESCE(b.on_hand_count, 0),
           'version',         COALESCE(b.version, 0)
         ) ORDER BY d.value), '[]'::jsonb)
  INTO v_denoms
  FROM public.chip_set_denomination d
  LEFT JOIN public.chip_bank b ON b.club_id = p_club_id AND b.denomination_id = d.id
  WHERE d.club_id = p_club_id;
  RETURN jsonb_build_object('club_id', p_club_id, 'denominations', v_denoms);
END;
$$;

REVOKE ALL ON FUNCTION public.get_chip_bank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chip_bank(uuid) TO authenticated;

-- Manual xuất/thu. CAS on chip_bank.version; upserts the row (opening stock via first 'thu').
CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(
  p_club_id         uuid,
  p_denomination_id uuid,
  p_direction       text,                 -- 'xuat' (out) | 'thu' (in)
  p_count           bigint,
  p_tournament_id   uuid DEFAULT NULL,
  p_old_version     integer DEFAULT 0,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_on      bigint;
  v_ver     integer;
  v_new     bigint;
  v_prior   public.chip_bank_ledger%ROWTYPE;
  v_dclub   uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id) OR public.is_club_chip_master(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  IF p_direction NOT IN ('xuat','thu') THEN RETURN jsonb_build_object('error','INVALID_INPUT','detail','direction'); END IF;
  IF p_count IS NULL OR p_count <= 0 THEN RETURN jsonb_build_object('error','INVALID_INPUT','detail','count'); END IF;

  -- denomination must belong to this club
  SELECT d.club_id INTO v_dclub FROM public.chip_set_denomination d WHERE d.id = p_denomination_id;
  IF NOT FOUND OR v_dclub <> p_club_id THEN RETURN jsonb_build_object('error','DENOM_NOT_IN_CLUB'); END IF;

  -- idempotency replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.chip_bank_ledger WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('status','ok','idempotent',true,'balance_after',v_prior.balance_after);
    END IF;
  END IF;

  SELECT on_hand_count, version INTO v_on, v_ver
  FROM public.chip_bank
  WHERE club_id = p_club_id AND denomination_id = p_denomination_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- new denom row: opening from 0; require old_version 0 for the CAS contract
    IF p_old_version <> 0 THEN RETURN jsonb_build_object('error','race_lost'); END IF;
    v_on := 0;
    v_new := CASE WHEN p_direction = 'thu' THEN v_on + p_count ELSE v_on - p_count END;
    IF v_new < 0 THEN RETURN jsonb_build_object('error','BANK_NEGATIVE','on_hand',v_on); END IF;
    BEGIN
      INSERT INTO public.chip_bank (club_id, denomination_id, on_hand_count, version, updated_by)
      VALUES (p_club_id, p_denomination_id, v_new, 1, v_uid);
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error','race_lost');   -- another op created the row concurrently
    END;
  ELSE
    IF v_ver <> p_old_version THEN RETURN jsonb_build_object('error','race_lost','actual_version',v_ver); END IF;
    v_new := CASE WHEN p_direction = 'thu' THEN v_on + p_count ELSE v_on - p_count END;
    IF v_new < 0 THEN RETURN jsonb_build_object('error','BANK_NEGATIVE','on_hand',v_on); END IF;
    UPDATE public.chip_bank
    SET on_hand_count = v_new, version = v_ver + 1, updated_at = now(), updated_by = v_uid
    WHERE club_id = p_club_id AND denomination_id = p_denomination_id;
  END IF;

  INSERT INTO public.chip_bank_ledger
    (club_id, denomination_id, tournament_id, direction, count, balance_after, reason, idempotency_key, actor)
  VALUES (p_club_id, p_denomination_id, p_tournament_id, p_direction, p_count, v_new, 'manual', p_idempotency_key, v_uid);

  RETURN jsonb_build_object('status','ok','direction',p_direction,'count',p_count,
                            'on_hand_count',v_new,'balance_after',v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 1a+1b+this; run inside a transaction, then ROLLBACK).
--   Build the 1a worked example first (Test Set + denoms 100/500/1000/5000 + 30K mix×200 +
--   30K full 5K×69) so issued = T100 2000 / T500 1600 / T1000 1000 / T5000 1214, total 8,070,000.
--
-- BEGIN;
--   -- [T1] current == issued when ledger empty:
--   SELECT public.get_current_chip_inventory('<tournament>');
--     -- EXPECT total_value=8070000, issued_total_value=8070000, ledger_delta_value=0, reconciled=true.
--   -- [T2] manual_adjust moves current (e.g. lost 5 × T5000):
--   INSERT INTO public.chip_inventory_ledger(tournament_id,club_id,denomination_id,delta_count,reason)
--   VALUES ('<tournament>','<club>','<d5k>',-5,'manual_adjust');
--   SELECT public.get_current_chip_inventory('<tournament>');
--     -- EXPECT T5000 current 1209; ledger_delta_value = -25000; reconciled=false.
--   -- [T3] bank opening + xuất/thu CAS + idempotency:
--   SELECT public.chip_ops_bank_adjust('<club>','<d100>','thu',10000, NULL, 0, 'k1');   -- on_hand 10000, v1
--   SELECT public.chip_ops_bank_adjust('<club>','<d100>','xuat',2000, '<tournament>', 1, 'k2'); -- 8000, v2
--   SELECT public.chip_ops_bank_adjust('<club>','<d100>','xuat',2000, NULL, 1, 'k3');   -- EXPECT race_lost (stale version)
--   SELECT public.chip_ops_bank_adjust('<club>','<d100>','xuat',2000, NULL, 0, 'k2');   -- EXPECT idempotent replay (balance 8000)
--   SELECT public.chip_ops_bank_adjust('<club>','<d100>','xuat',999999, NULL, 2, 'k4'); -- EXPECT BANK_NEGATIVE
--   SELECT public.get_chip_bank('<club>');                                              -- T100 on_hand 8000 v2
--   -- [T4] authz: a non-owner/non-chip-master → Forbidden on both reads + adjust.
-- ROLLBACK;
-- ===========================================================================================
--
-- ROLLBACK (undo this migration), dependency order:
--   DROP FUNCTION IF EXISTS public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text);
--   DROP FUNCTION IF EXISTS public.get_chip_bank(uuid);
--   DROP FUNCTION IF EXISTS public.get_current_chip_inventory(uuid);
--   DROP FUNCTION IF EXISTS public.chip_ops_current_denom_counts(uuid);
--   DROP TABLE IF EXISTS public.chip_bank_ledger;
--   DROP TABLE IF EXISTS public.chip_bank;
--   DROP TABLE IF EXISTS public.chip_inventory_ledger;
-- ===========================================================================================
