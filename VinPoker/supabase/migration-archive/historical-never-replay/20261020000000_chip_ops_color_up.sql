-- Chip Ops — Phase 2C: Color-Up / chip race (single atomic, value-conserving with rounding tolerance).
-- DEPENDS ON 1a (20261015000000) + 1b (20261016000000) + 2B (20261019000000).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor).
-- schema_migrations untouched.
--
-- WHY: when blinds pass a low denomination it must be removed and its value raced UP into a higher
-- denom (T100 → T500). Value is conserved within ONE target chip (the sub-target remainder is
-- resolved physically by awarding the odd chip to a high card). This writes the floor inventory
-- ledger (color_up_out + color_up_in); the rounding remainder is stored on the operation header,
-- NOT as a ledger row (that would double-count). Model B: color-up does NOT touch the bank (manual).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS.

-- ===========================================================================================
-- 0. Tighten the 2B floor-ledger reason CHECK — drop the now-unused 'race_rounding' value
--    (single source of truth: color_up_out + color_up_in already net to -rounding_delta; a
--    race_rounding row would double-count ledger_delta_value). No such rows exist → safe.
-- ===========================================================================================
ALTER TABLE public.chip_inventory_ledger DROP CONSTRAINT IF EXISTS cil_reason_chk;
ALTER TABLE public.chip_inventory_ledger
  ADD CONSTRAINT cil_reason_chk CHECK (reason IN ('color_up_out','color_up_in','manual_adjust'));

-- ===========================================================================================
-- 1. Color-up operation header (append-only except the audited confirmed→reversed transition)
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.color_up_operation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  denom_removed   uuid NOT NULL REFERENCES public.chip_set_denomination(id) ON DELETE RESTRICT,
  denom_target    uuid NOT NULL REFERENCES public.chip_set_denomination(id) ON DELETE RESTRICT,
  removed_count   bigint NOT NULL,
  target_added    bigint NOT NULL,
  value_removed   bigint NOT NULL,
  value_added     bigint NOT NULL,
  rounding_delta  bigint NOT NULL,            -- value_removed - value_added; |.| < target_value by the gate
  level_number    integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','reversed')),
  idempotency_key text,
  confirmed_by    uuid DEFAULT auth.uid(),
  confirmed_at    timestamptz NOT NULL DEFAULT now(),
  reversed_by     uuid,
  reversed_at     timestamptz,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cuo_removed_count_pos CHECK (removed_count > 0),
  CONSTRAINT cuo_target_added_nonneg CHECK (target_added >= 0)
);
-- one CONFIRMED race per (tournament, removed denom, level): blocks a same-level double race +
-- concurrency, but allows re-color-up of a denom at a LATER level after late-reg re-introduces it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuo_confirmed_denom_level
  ON public.color_up_operation(tournament_id, denom_removed, level_number) WHERE status='confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cuo_idempotency
  ON public.color_up_operation(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cuo_tourn ON public.color_up_operation(tournament_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cuo_club  ON public.color_up_operation(club_id);

CREATE TABLE IF NOT EXISTS public.color_up_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id    uuid NOT NULL REFERENCES public.color_up_operation(id) ON DELETE CASCADE,
  club_id         uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  denomination_id uuid NOT NULL REFERENCES public.chip_set_denomination(id) ON DELETE RESTRICT,
  role            text NOT NULL CHECK (role IN ('removed','target')),
  count_before    bigint NOT NULL,
  count_after     bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cul_op_role_uniq UNIQUE (operation_id, role)
);
CREATE INDEX IF NOT EXISTS idx_cul_op ON public.color_up_line(operation_id);

-- ===========================================================================================
-- 2. RLS — SELECT owner OR chip_master; default-deny writes (RPC-only).
-- ===========================================================================================
ALTER TABLE public.color_up_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.color_up_line      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.color_up_operation FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.color_up_line      FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.color_up_operation TO authenticated;
GRANT SELECT ON public.color_up_line      TO authenticated;

DROP POLICY IF EXISTS color_up_operation_select ON public.color_up_operation;
CREATE POLICY color_up_operation_select ON public.color_up_operation
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

DROP POLICY IF EXISTS color_up_line_select ON public.color_up_line;
CREATE POLICY color_up_line_select ON public.color_up_line
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (
    public.is_club_owner(auth.uid(), club_id) OR public.is_club_chip_master(auth.uid(), club_id)));

-- ===========================================================================================
-- 3. get_current_chip_inventory — REPLACE with rounding-adjusted reconcile (P2-1). Backward
--    compatible: with no confirmed color-ups rounding_total=0 ⇒ identical to 2B.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.get_current_chip_inventory(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_club     uuid;
  v_denoms   jsonb;
  v_total    bigint;
  v_issued   bigint;
  v_rounding bigint;
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

  SELECT COALESCE(SUM(rounding_delta), 0)::bigint INTO v_rounding
  FROM public.color_up_operation
  WHERE tournament_id = p_tournament_id AND status = 'confirmed';

  RETURN jsonb_build_object(
    'tournament_id',      p_tournament_id,
    'denominations',      v_denoms,
    'total_value',        v_total,
    'issued_total_value', v_issued,
    'ledger_delta_value', (v_total - v_issued),
    'rounding_total',     v_rounding,
    -- valid color-ups remove exactly `rounding_total` of value (sub-target remainders), so the
    -- reconcile baseline is issued − rounding_total. False only on real drift (manual_adjust).
    'reconciled',         (v_total = v_issued - v_rounding)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_chip_inventory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_chip_inventory(uuid) TO authenticated;

-- ===========================================================================================
-- 4. chip_ops_color_up — single atomic, value-conserving RPC.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_color_up(
  p_tournament_id   uuid,
  p_denom_removed   uuid,
  p_denom_target    uuid,
  p_target_added    bigint,
  p_level_number    integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_club         uuid;
  v_chip_set     uuid;
  v_removed_val  bigint;
  v_target_val   bigint;
  v_removed_cnt  bigint;
  v_target_before bigint;
  v_value_removed bigint;
  v_value_added   bigint;
  v_rounding      bigint;
  v_level         integer;
  v_op            uuid;
  v_prior         public.color_up_operation%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;

  -- tournament + club
  SELECT t.club_id, t.current_level INTO v_club, v_level
  FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  v_level := COALESCE(p_level_number, v_level, 0);

  -- both denoms must belong to the tournament's BOUND chip set
  SELECT d.value INTO v_removed_val
  FROM public.tournament_chip_set tcs
  JOIN public.chip_set_denomination d ON d.chip_set_id = tcs.chip_set_id
  WHERE tcs.tournament_id = p_tournament_id AND d.id = p_denom_removed;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','DENOM_NOT_IN_SET','detail','removed'); END IF;

  SELECT d.value INTO v_target_val
  FROM public.tournament_chip_set tcs
  JOIN public.chip_set_denomination d ON d.chip_set_id = tcs.chip_set_id
  WHERE tcs.tournament_id = p_tournament_id AND d.id = p_denom_target;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','DENOM_NOT_IN_SET','detail','target'); END IF;

  IF p_denom_removed = p_denom_target THEN RETURN jsonb_build_object('error','SAME_DENOM'); END IF;
  IF v_target_val <= v_removed_val THEN
    RETURN jsonb_build_object('error','NOT_RACING_UP','removed_value',v_removed_val,'target_value',v_target_val);
  END IF;
  IF p_target_added IS NULL OR p_target_added < 0 THEN
    RETURN jsonb_build_object('error','INVALID_INPUT','detail','target_added');
  END IF;

  -- idempotency replay (before any write)
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.color_up_operation WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('status','ok','idempotent',true,
        'value_removed',v_prior.value_removed,'value_added',v_prior.value_added,
        'rounding_delta',v_prior.rounding_delta,'removed_count',v_prior.removed_count,
        'target_added',v_prior.target_added);
    END IF;
  END IF;

  -- already colored up at this level? (more specific than NOTHING_TO_REMOVE, which would otherwise
  -- fire first since current[removed]=0 after the earlier race). The INSERT's unique_violation is the
  -- concurrency backstop for two operators racing the same denom+level simultaneously.
  IF EXISTS (SELECT 1 FROM public.color_up_operation
             WHERE tournament_id = p_tournament_id AND denom_removed = p_denom_removed
               AND level_number = v_level AND status = 'confirmed') THEN
    RETURN jsonb_build_object('error','ALREADY_DONE');
  END IF;

  -- current counts (issued + ledger) for the two affected denoms; absent ⇒ 0
  SELECT current_count INTO v_removed_cnt
  FROM public.chip_ops_current_denom_counts(p_tournament_id) WHERE denomination_id = p_denom_removed;
  v_removed_cnt := COALESCE(v_removed_cnt, 0);
  IF v_removed_cnt <= 0 THEN RETURN jsonb_build_object('error','NOTHING_TO_REMOVE','removed_count',v_removed_cnt); END IF;

  SELECT current_count INTO v_target_before
  FROM public.chip_ops_current_denom_counts(p_tournament_id) WHERE denomination_id = p_denom_target;
  v_target_before := COALESCE(v_target_before, 0);

  v_value_removed := v_removed_cnt * v_removed_val;
  v_value_added   := p_target_added * v_target_val;
  v_rounding      := v_value_removed - v_value_added;

  -- GATE: value conserved within one target chip (catches gross errors like +2000 instead of +400)
  IF abs(v_rounding) >= v_target_val THEN
    RETURN jsonb_build_object('error','VALUE_NOT_CONSERVED','rounding_delta',v_rounding,'target_value',v_target_val);
  END IF;

  -- atomic write
  BEGIN
    INSERT INTO public.color_up_operation
      (tournament_id, club_id, denom_removed, denom_target, removed_count, target_added,
       value_removed, value_added, rounding_delta, level_number, idempotency_key, confirmed_by)
    VALUES (p_tournament_id, v_club, p_denom_removed, p_denom_target, v_removed_cnt, p_target_added,
       v_value_removed, v_value_added, v_rounding, v_level, p_idempotency_key, v_uid)
    RETURNING id INTO v_op;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error','ALREADY_DONE');   -- this denom already raced at this level (or key replay)
  END;

  INSERT INTO public.color_up_line (operation_id, club_id, denomination_id, role, count_before, count_after)
  VALUES (v_op, v_club, p_denom_removed, 'removed', v_removed_cnt, 0),
         (v_op, v_club, p_denom_target,  'target',  v_target_before, v_target_before + p_target_added);

  INSERT INTO public.chip_inventory_ledger
    (tournament_id, club_id, denomination_id, delta_count, reason, ref_type, ref_id)
  VALUES (p_tournament_id, v_club, p_denom_removed, -v_removed_cnt, 'color_up_out', 'color_up_operation', v_op),
         (p_tournament_id, v_club, p_denom_target,  p_target_added, 'color_up_in',  'color_up_operation', v_op);

  RETURN jsonb_build_object('status','ok','color_up_operation_id',v_op,
    'value_removed',v_value_removed,'value_added',v_value_added,'rounding_delta',v_rounding,
    'removed_count',v_removed_cnt,'target_added',p_target_added);
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text) TO authenticated;

-- ===========================================================================================
-- 5. chip_ops_reverse_color_up — compensating inverse (the one audited confirmed→reversed UPDATE).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_reverse_color_up(
  p_operation_id    uuid,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_op  public.color_up_operation%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;

  SELECT * INTO v_op FROM public.color_up_operation WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','OPERATION_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_op.club_id) OR public.is_club_chip_master(v_uid, v_op.club_id)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  IF v_op.status = 'reversed' THEN
    RETURN jsonb_build_object('status','ok','idempotent',true,'color_up_operation_id',p_operation_id);
  END IF;

  -- inverse ledger pair: add the removed chips back, take the target chips back out
  INSERT INTO public.chip_inventory_ledger
    (tournament_id, club_id, denomination_id, delta_count, reason, ref_type, ref_id, details)
  VALUES
    (v_op.tournament_id, v_op.club_id, v_op.denom_removed,  v_op.removed_count, 'color_up_in',  'color_up_operation', v_op.id, jsonb_build_object('reverse',true)),
    (v_op.tournament_id, v_op.club_id, v_op.denom_target, -v_op.target_added,  'color_up_out', 'color_up_operation', v_op.id, jsonb_build_object('reverse',true));

  UPDATE public.color_up_operation
  SET status = 'reversed', reversed_by = v_uid, reversed_at = now()
  WHERE id = p_operation_id;

  RETURN jsonb_build_object('status','ok','color_up_operation_id',p_operation_id,'reversed',true);
END;
$$;

REVOKE ALL ON FUNCTION public.chip_ops_reverse_color_up(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_reverse_color_up(uuid,text) TO authenticated;

-- ===========================================================================================
-- 6. get_color_up_history — enriched read for the UI.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.get_color_up_history(p_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_club uuid;
  v_rows jsonb;
BEGIN
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF v_uid IS NULL OR NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id, 'level_number', o.level_number, 'status', o.status,
           'denom_removed_value', dr.value, 'denom_target_value', dt.value,
           'removed_count', o.removed_count, 'target_added', o.target_added,
           'value_removed', o.value_removed, 'value_added', o.value_added,
           'rounding_delta', o.rounding_delta, 'confirmed_at', o.confirmed_at, 'reversed_at', o.reversed_at
         ) ORDER BY o.confirmed_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.color_up_operation o
  JOIN public.chip_set_denomination dr ON dr.id = o.denom_removed
  JOIN public.chip_set_denomination dt ON dt.id = o.denom_target
  WHERE o.tournament_id = p_tournament_id;
  RETURN jsonb_build_object('tournament_id', p_tournament_id, 'operations', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_color_up_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_color_up_history(uuid) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 1a+1b+2B+this; BEGIN; … ROLLBACK). Build the 1a worked
-- example first (T100 2000 / T500 1600 / T1000 1000 / T5000 1214 = 8,070,000). <d100>,<d500> ids.
--
-- BEGIN;
--   -- [T1] EVEN race conserves + reconciled (adjusted) true:
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu1');
--     -- EXPECT value_removed 200000, value_added 200000, rounding_delta 0, removed_count 2000
--   SELECT public.get_current_chip_inventory('<t>');
--     -- EXPECT T100 0, T500 2000, total 8070000, rounding_total 0, reconciled true
--   SELECT reason,delta_count FROM public.chip_inventory_ledger WHERE tournament_id='<t>' ORDER BY reason;
--     -- EXPECT color_up_in(+400), color_up_out(-2000)  — and NO race_rounding row
--   ROLLBACK;
-- BEGIN;
--   -- [T2] UNEVEN race accepts, rounding on header, reconciled STILL true (adjusted), NO race_rounding row:
--   INSERT INTO public.chip_inventory_ledger(tournament_id,club_id,denomination_id,delta_count,reason)
--     VALUES ('<t>','<club>','<d100>',3,'manual_adjust');                 -- current 2003
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu2'); -- rounding_delta 300
--   SELECT public.get_current_chip_inventory('<t>');
--     -- EXPECT total 8069700, rounding_total 300, reconciled TRUE (8069700 == 8070000 - 300)
--   SELECT count(*) FROM public.chip_inventory_ledger WHERE reason='race_rounding';  -- ERROR: enum dropped → 0 anyway
--   ROLLBACK;
-- BEGIN;
--   -- [T3] real drift → reconciled false:
--   INSERT INTO public.chip_inventory_ledger(tournament_id,club_id,denomination_id,delta_count,reason)
--     VALUES ('<t>','<club>','<d5000>',-5,'manual_adjust');
--   SELECT public.get_current_chip_inventory('<t>');  -- EXPECT reconciled false (real -25000 drift)
--   ROLLBACK;
-- BEGIN;
--   -- [T4] gross error rejected:
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',2000,8,'cu4'); -- value_added 1,000,000
--     -- EXPECT {"error":"VALUE_NOT_CONSERVED","rounding_delta":-799700,"target_value":500}
--   ROLLBACK;
-- BEGIN;
--   -- [T5] same denom+level 2nd → ALREADY_DONE; re-color-up at NEW level after late-reg → PASS:
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu5a');  -- ok
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu5b');  -- EXPECT ALREADY_DONE (same level 8)
--   -- simulate late-reg re-issue (raise issued for T100 so current>0 again): bump an issuance template count
--   --   then at level 11:
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>', <new_added>, 11, 'cu5c'); -- EXPECT ok (new level)
--   ROLLBACK;
-- BEGIN;
--   -- [T6] NOTHING_TO_REMOVE / NOT_RACING_UP / SAME_DENOM:
--   INSERT INTO public.chip_inventory_ledger(tournament_id,club_id,denomination_id,delta_count,reason)
--     VALUES ('<t>','<club>','<d100>',-2000,'manual_adjust');             -- current 0
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',0,8,'cu6');   -- EXPECT NOTHING_TO_REMOVE
--   SELECT public.chip_ops_color_up('<t>','<d500>','<d100>',1,8,'cu6b');  -- EXPECT NOT_RACING_UP
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d100>',1,8,'cu6c');  -- EXPECT SAME_DENOM
--   ROLLBACK;
-- BEGIN;
--   -- [T7] idempotent replay (1 op, 2 ledger rows):
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu7');
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu7');  -- EXPECT idempotent:true
--   SELECT count(*) FROM public.color_up_operation WHERE tournament_id='<t>';       -- 1
--   SELECT count(*) FROM public.chip_inventory_ledger WHERE ref_type='color_up_operation'; -- 2
--   ROLLBACK;
-- BEGIN;
--   -- [T8] reverse restores inventory + frees the partial-unique + idempotent:
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu8');           -- op <op>
--   SELECT public.chip_ops_reverse_color_up('<op>','rv8');
--   SELECT public.get_current_chip_inventory('<t>');  -- EXPECT T100 2000, T500 1600, total 8070000, reconciled true
--   SELECT public.chip_ops_reverse_color_up('<op>','rv8b'); -- EXPECT idempotent:true
--   SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu8b'); -- EXPECT ok (partial-unique freed)
--   ROLLBACK;
--   -- [T9] authz Forbidden + RLS owner/non-owner on color_up_operation/line (run as non-owner).
-- ===========================================================================================
--
-- ROLLBACK (undo this migration), dependency order:
--   DROP FUNCTION IF EXISTS public.get_color_up_history(uuid);
--   DROP FUNCTION IF EXISTS public.chip_ops_reverse_color_up(uuid,text);
--   DROP FUNCTION IF EXISTS public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text);
--   DROP TABLE IF EXISTS public.color_up_line;
--   DROP TABLE IF EXISTS public.color_up_operation;
--   -- restore the 2B reason CHECK (re-add race_rounding) + the 2B get_current_chip_inventory body:
--   ALTER TABLE public.chip_inventory_ledger DROP CONSTRAINT IF EXISTS cil_reason_chk;
--   ALTER TABLE public.chip_inventory_ledger ADD CONSTRAINT cil_reason_chk
--     CHECK (reason IN ('color_up_out','color_up_in','race_rounding','manual_adjust'));
--   -- re-apply 20261019000000's get_current_chip_inventory (the version without rounding_total).
-- ===========================================================================================
