-- Chip Ops — Phase 2E: két TỰ ĐỘNG (Model A) — issuance→xuất / color-up→thu+xuất, opt-in, deficit-allowed.
-- DEPENDS ON 1a (20261015000000) + 1b (20261016000000) + 2B (20261019000000) + 2C (20261020000000).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor) only AFTER
-- the owner has UAT'd 2B–2D. schema_migrations untouched.
--
-- WHY: 2B–2D shipped the két as a MANUAL ledger (Model B). The owner's end-state is auto-coupling: handing
-- stacks to the floor auto-XUẤTs chips from the két; a color-up auto-THUs the removed denom back + XUẤTs the
-- target out. This keeps `két on_hand + floor in-play = total owned` true automatically.
--
-- OWNER DECISIONS (confirmed): (1) DEFICIT ALLOWED — if the két is short during phát/color-up it goes NEGATIVE
-- (ghi nợ) and the op still succeeds; (2) toggle = owner OR chip-master; (3) a one-time "Đồng bộ kho két" helper.
--
-- OPT-IN & BACKWARD-COMPAT: per-club flag `coupling_enabled` DEFAULT false. OFF ⇒ set_issuance / color_up /
-- reverse_color_up behave byte-identical to the live 2C/1b versions. Deficits are allowed, so coupling never
-- fails on funds → no savepoint dance; the helper just applies the signed delta (may go negative).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY/CONSTRAINT IF EXISTS.

-- ===========================================================================================
-- 1. Per-club coupling flag
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.chip_ops_bank_config (
  club_id          uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  coupling_enabled boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid DEFAULT auth.uid()
);
ALTER TABLE public.chip_ops_bank_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chip_ops_bank_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chip_ops_bank_config TO authenticated;
DROP POLICY IF EXISTS chip_ops_bank_config_select ON public.chip_ops_bank_config;
CREATE POLICY chip_ops_bank_config_select ON public.chip_ops_bank_config FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND (public.is_club_owner(auth.uid(),club_id) OR public.is_club_chip_master(auth.uid(),club_id)));

-- ===========================================================================================
-- 2. Relax the hard floor — coupling may run the két NEGATIVE (deficit / ghi nợ). Non-negativity becomes a
--    MANUAL-path policy only: chip_ops_bank_adjust keeps its in-function BANK_NEGATIVE guard (untouched).
-- ===========================================================================================
ALTER TABLE public.chip_bank DROP CONSTRAINT IF EXISTS chip_bank_nonneg;

-- ===========================================================================================
-- 3. Internal helpers (DEFINER, no grant to authenticated — only DEFINER RPCs call them)
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_coupling_on(p_club uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT coupling_enabled FROM public.chip_ops_bank_config WHERE club_id = p_club), false);
$$;
REVOKE ALL ON FUNCTION public.chip_ops_coupling_on(uuid) FROM PUBLIC, anon;

-- Apply one signed bank move (negative allowed). Idempotent by p_idem (reuses 2B's uq_cbl_idempotency).
CREATE OR REPLACE FUNCTION public.chip_ops_bank_couple_apply(
  p_club uuid, p_denom uuid, p_direction text, p_count bigint,
  p_reason text, p_ref_type text, p_ref_id uuid, p_tournament uuid, p_idem text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_on bigint; v_ver integer; v_new bigint;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN RETURN; END IF;             -- nothing to move
  IF p_idem IS NOT NULL AND EXISTS (SELECT 1 FROM public.chip_bank_ledger WHERE idempotency_key = p_idem) THEN
    RETURN;                                                          -- already applied (replay)
  END IF;
  SELECT on_hand_count, version INTO v_on, v_ver
  FROM public.chip_bank WHERE club_id = p_club AND denomination_id = p_denom FOR UPDATE;
  IF NOT FOUND THEN
    v_new := CASE WHEN p_direction = 'thu' THEN p_count ELSE -p_count END;   -- negative allowed
    INSERT INTO public.chip_bank (club_id, denomination_id, on_hand_count, version, updated_by)
    VALUES (p_club, p_denom, v_new, 1, auth.uid());
  ELSE
    v_new := CASE WHEN p_direction = 'thu' THEN v_on + p_count ELSE v_on - p_count END;  -- negative allowed
    UPDATE public.chip_bank SET on_hand_count = v_new, version = v_ver + 1, updated_at = now(), updated_by = auth.uid()
    WHERE club_id = p_club AND denomination_id = p_denom;
  END IF;
  INSERT INTO public.chip_bank_ledger
    (club_id, denomination_id, tournament_id, direction, count, balance_after, reason, ref_type, ref_id, idempotency_key, actor)
  VALUES (p_club, p_denom, p_tournament, p_direction, p_count, v_new, p_reason, p_ref_type, p_ref_id, p_idem, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_bank_couple_apply(uuid,uuid,text,bigint,text,text,uuid,uuid,text) FROM PUBLIC, anon, authenticated;

-- ===========================================================================================
-- 4. Toggle + sync RPCs (owner OR chip-master)
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_set_bank_coupling(p_club_id uuid, p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id) OR public.is_club_chip_master(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  INSERT INTO public.chip_ops_bank_config (club_id, coupling_enabled, updated_by)
  VALUES (p_club_id, COALESCE(p_enabled,false), v_uid)
  ON CONFLICT (club_id) DO UPDATE SET coupling_enabled = COALESCE(p_enabled,false), updated_at = now(), updated_by = v_uid;
  RETURN jsonb_build_object('status','ok','coupling_enabled',COALESCE(p_enabled,false));
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_set_bank_coupling(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_set_bank_coupling(uuid,boolean) TO authenticated;

-- One-time baseline: bank on_hand[denom] = total owned − in-play (Σ current_count over the club's ACTIVE
-- tournaments). Records the delta as a 'sync' bank-ledger event; returns the tournaments it counted (P0-6).
CREATE OR REPLACE FUNCTION public.chip_ops_bank_sync(p_club_id uuid, p_totals jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rec jsonb := '[]'::jsonb;
  v_tours jsonb;
  r record;
  v_inplay bigint; v_oldon bigint; v_ver integer; v_on bigint; v_delta bigint;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id) OR public.is_club_chip_master(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  IF p_totals IS NULL OR jsonb_typeof(p_totals) <> 'array' THEN
    RETURN jsonb_build_object('error','INVALID_INPUT','detail','totals');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status) ORDER BY t.name),'[]'::jsonb)
  INTO v_tours FROM public.tournaments t
  WHERE t.club_id = p_club_id AND t.deleted_at IS NULL
    AND (t.status IS NULL OR t.status NOT IN ('completed','cancelled'));

  FOR r IN SELECT x.denomination_id, x.total
           FROM jsonb_to_recordset(p_totals) AS x(denomination_id uuid, total bigint)
  LOOP
    IF r.denomination_id IS NULL OR r.total IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.chip_set_denomination d WHERE d.id = r.denomination_id AND d.club_id = p_club_id) THEN
      CONTINUE;   -- denom not in this club
    END IF;

    SELECT COALESCE(SUM(c.current_count),0)::bigint INTO v_inplay
    FROM public.tournaments t
    CROSS JOIN LATERAL public.chip_ops_current_denom_counts(t.id) c
    WHERE t.club_id = p_club_id AND t.deleted_at IS NULL
      AND (t.status IS NULL OR t.status NOT IN ('completed','cancelled'))
      AND c.denomination_id = r.denomination_id;

    v_on := r.total - v_inplay;

    SELECT on_hand_count, version INTO v_oldon, v_ver
    FROM public.chip_bank WHERE club_id = p_club_id AND denomination_id = r.denomination_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.chip_bank (club_id, denomination_id, on_hand_count, version, updated_by)
      VALUES (p_club_id, r.denomination_id, v_on, 1, v_uid);
      v_delta := v_on;
    ELSE
      UPDATE public.chip_bank SET on_hand_count = v_on, version = v_ver + 1, updated_at = now(), updated_by = v_uid
      WHERE club_id = p_club_id AND denomination_id = r.denomination_id;
      v_delta := v_on - COALESCE(v_oldon,0);
    END IF;

    IF v_delta <> 0 THEN
      INSERT INTO public.chip_bank_ledger
        (club_id, denomination_id, direction, count, balance_after, reason, ref_type, actor, details)
      VALUES (p_club_id, r.denomination_id, CASE WHEN v_delta > 0 THEN 'thu' ELSE 'xuat' END,
              abs(v_delta), v_on, 'sync', 'bank_sync', v_uid,
              jsonb_build_object('total', r.total, 'in_play', v_inplay));
    END IF;

    v_rec := v_rec || jsonb_build_object('denomination_id', r.denomination_id, 'total', r.total,
                                         'in_play', v_inplay, 'on_hand', v_on);
  END LOOP;

  RETURN jsonb_build_object('status','ok','club_id',p_club_id,'denominations',v_rec,'tournaments_counted',v_tours);
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_bank_sync(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_bank_sync(uuid,jsonb) TO authenticated;

-- ===========================================================================================
-- 5. get_chip_bank — REPLACE to expose coupling_enabled (one read drives the UI toggle).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.get_chip_bank(p_club_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_denoms jsonb; v_coupling boolean;
BEGIN
  IF v_uid IS NULL OR NOT (public.is_club_owner(v_uid, p_club_id) OR public.is_club_chip_master(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  SELECT COALESCE((SELECT coupling_enabled FROM public.chip_ops_bank_config WHERE club_id = p_club_id), false)
  INTO v_coupling;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'denomination_id', d.id, 'value', d.value, 'color', d.color,
           'on_hand_count', COALESCE(b.on_hand_count, 0), 'version', COALESCE(b.version, 0)
         ) ORDER BY d.value), '[]'::jsonb)
  INTO v_denoms
  FROM public.chip_set_denomination d
  LEFT JOIN public.chip_bank b ON b.club_id = p_club_id AND b.denomination_id = d.id
  WHERE d.club_id = p_club_id;
  RETURN jsonb_build_object('club_id', p_club_id, 'denominations', v_denoms, 'coupling_enabled', v_coupling);
END;
$$;
REVOKE ALL ON FUNCTION public.get_chip_bank(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chip_bank(uuid) TO authenticated;

-- ===========================================================================================
-- 6. chip_ops_set_issuance — REPLACE: same signature + owner/chip-master gate; couple the két on a Δ change.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_set_issuance(
  p_stack_template_id uuid,
  p_issued_count      integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid(); v_club uuid; v_tour uuid; v_old integer; v_delta integer; v_coupled boolean; r record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF p_issued_count IS NULL OR p_issued_count < 0 THEN
    RETURN jsonb_build_object('error','INVALID_INPUT','detail','issued_count');
  END IF;
  -- lock the template to serialize issuance edits (delta-based coupling correctness)
  SELECT st.club_id, st.tournament_id INTO v_club, v_tour FROM public.stack_template st
  WHERE st.id = p_stack_template_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TEMPLATE_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  SELECT issued_count INTO v_old FROM public.stack_template_issuance WHERE stack_template_id = p_stack_template_id;
  v_old := COALESCE(v_old, 0);
  v_delta := p_issued_count - v_old;
  v_coupled := (v_delta <> 0 AND public.chip_ops_coupling_on(v_club));

  IF v_coupled THEN
    -- a change of issued stacks moves chips between the két and the floor (xuất when phát more, thu when fewer)
    FOR r IN SELECT l.denomination_id, l.count FROM public.stack_template_line l
             WHERE l.stack_template_id = p_stack_template_id
    LOOP
      PERFORM public.chip_ops_bank_couple_apply(
        v_club, r.denomination_id,
        CASE WHEN v_delta > 0 THEN 'xuat' ELSE 'thu' END,
        (abs(v_delta)::bigint * r.count),
        'couple_issuance', 'stack_template', p_stack_template_id, v_tour, NULL);
    END LOOP;
  END IF;

  INSERT INTO public.stack_template_issuance (stack_template_id, issued_count, club_id, updated_by)
  VALUES (p_stack_template_id, p_issued_count, v_club, v_uid)
  ON CONFLICT (stack_template_id)
  DO UPDATE SET issued_count = EXCLUDED.issued_count, updated_at = now(), updated_by = EXCLUDED.updated_by;

  RETURN jsonb_build_object('status','ok','stack_template_id',p_stack_template_id,
                            'issued_count',p_issued_count,'coupled',v_coupled);
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_set_issuance(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_set_issuance(uuid, integer) TO authenticated;

-- ===========================================================================================
-- 7. chip_ops_color_up — REPLACE (2C body verbatim) + couple thu(removed)+xuat(target) when ON.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_color_up(
  p_tournament_id   uuid,
  p_denom_removed   uuid,
  p_denom_target    uuid,
  p_target_added    bigint,
  p_level_number    integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_club         uuid;
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

  SELECT t.club_id, t.current_level INTO v_club, v_level
  FROM public.tournaments t WHERE t.id = p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (public.is_club_owner(v_uid, v_club) OR public.is_club_chip_master(v_uid, v_club)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;

  v_level := COALESCE(p_level_number, v_level, 0);

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

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.color_up_operation WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('status','ok','idempotent',true,
        'value_removed',v_prior.value_removed,'value_added',v_prior.value_added,
        'rounding_delta',v_prior.rounding_delta,'removed_count',v_prior.removed_count,
        'target_added',v_prior.target_added);
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.color_up_operation
             WHERE tournament_id = p_tournament_id AND denom_removed = p_denom_removed
               AND level_number = v_level AND status = 'confirmed') THEN
    RETURN jsonb_build_object('error','ALREADY_DONE');
  END IF;

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

  IF abs(v_rounding) >= v_target_val THEN
    RETURN jsonb_build_object('error','VALUE_NOT_CONSERVED','rounding_delta',v_rounding,'target_value',v_target_val);
  END IF;

  BEGIN
    INSERT INTO public.color_up_operation
      (tournament_id, club_id, denom_removed, denom_target, removed_count, target_added,
       value_removed, value_added, rounding_delta, level_number, idempotency_key, confirmed_by)
    VALUES (p_tournament_id, v_club, p_denom_removed, p_denom_target, v_removed_cnt, p_target_added,
       v_value_removed, v_value_added, v_rounding, v_level, p_idempotency_key, v_uid)
    RETURNING id INTO v_op;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('error','ALREADY_DONE');
  END;

  INSERT INTO public.color_up_line (operation_id, club_id, denomination_id, role, count_before, count_after)
  VALUES (v_op, v_club, p_denom_removed, 'removed', v_removed_cnt, 0),
         (v_op, v_club, p_denom_target,  'target',  v_target_before, v_target_before + p_target_added);

  INSERT INTO public.chip_inventory_ledger
    (tournament_id, club_id, denomination_id, delta_count, reason, ref_type, ref_id)
  VALUES (p_tournament_id, v_club, p_denom_removed, -v_removed_cnt, 'color_up_out', 'color_up_operation', v_op),
         (p_tournament_id, v_club, p_denom_target,  p_target_added, 'color_up_in',  'color_up_operation', v_op);

  -- Model A coupling: removed chips return to the két (thu), target chips leave it (xuat). Deficit allowed.
  IF public.chip_ops_coupling_on(v_club) THEN
    PERFORM public.chip_ops_bank_couple_apply(v_club, p_denom_removed, 'thu',  v_removed_cnt, 'couple_color_up',
      'color_up_operation', v_op, p_tournament_id, 'couple:cu:'||v_op::text||':thu');
    PERFORM public.chip_ops_bank_couple_apply(v_club, p_denom_target,  'xuat', p_target_added, 'couple_color_up',
      'color_up_operation', v_op, p_tournament_id, 'couple:cu:'||v_op::text||':xuat');
  END IF;

  RETURN jsonb_build_object('status','ok','color_up_operation_id',v_op,
    'value_removed',v_value_removed,'value_added',v_value_added,'rounding_delta',v_rounding,
    'removed_count',v_removed_cnt,'target_added',p_target_added);
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text) TO authenticated;

-- ===========================================================================================
-- 8. chip_ops_reverse_color_up — REPLACE (2C body) + inverse bank IFF the op was coupled.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.chip_ops_reverse_color_up(
  p_operation_id    uuid,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_op  public.color_up_operation%ROWTYPE;
  v_was_coupled boolean;
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

  INSERT INTO public.chip_inventory_ledger
    (tournament_id, club_id, denomination_id, delta_count, reason, ref_type, ref_id, details)
  VALUES
    (v_op.tournament_id, v_op.club_id, v_op.denom_removed,  v_op.removed_count, 'color_up_in',  'color_up_operation', v_op.id, jsonb_build_object('reverse',true)),
    (v_op.tournament_id, v_op.club_id, v_op.denom_target, -v_op.target_added,  'color_up_out', 'color_up_operation', v_op.id, jsonb_build_object('reverse',true));

  -- reverse the bank IFF the original op moved it (couple rows exist) — independent of the current toggle.
  SELECT EXISTS (SELECT 1 FROM public.chip_bank_ledger
                 WHERE ref_type = 'color_up_operation' AND ref_id = v_op.id AND reason = 'couple_color_up')
  INTO v_was_coupled;
  IF v_was_coupled THEN
    PERFORM public.chip_ops_bank_couple_apply(v_op.club_id, v_op.denom_removed, 'xuat', v_op.removed_count,
      'couple_color_up_reverse', 'color_up_operation', v_op.id, v_op.tournament_id, 'couple:cur:'||v_op.id::text||':xuat');
    PERFORM public.chip_ops_bank_couple_apply(v_op.club_id, v_op.denom_target, 'thu', v_op.target_added,
      'couple_color_up_reverse', 'color_up_operation', v_op.id, v_op.tournament_id, 'couple:cur:'||v_op.id::text||':thu');
  END IF;

  UPDATE public.color_up_operation
  SET status = 'reversed', reversed_by = v_uid, reversed_at = now()
  WHERE id = p_operation_id;

  RETURN jsonb_build_object('status','ok','color_up_operation_id',p_operation_id,'reversed',true,'bank_reversed',v_was_coupled);
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_reverse_color_up(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chip_ops_reverse_color_up(uuid,text) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (apply 1a+1b+2B+2C+this; BEGIN; … ROLLBACK). Build the 1a worked example.
--   BEGIN;
--     -- OFF by default: set_issuance / color_up write NO chip_bank_ledger rows (identical to today).
--     SELECT public.chip_ops_set_bank_coupling('<club>', true);
--     -- stock baseline (owner enters totals owned per denom):
--     SELECT public.chip_ops_bank_sync('<club>', '[{"denomination_id":"<d100>","total":5000}]'::jsonb);
--       -- on_hand = 5000 − in_play(T100 across active tours)
--     -- phát thêm: raise an issuance → auto-xuất; lower it → auto-thu (check chip_bank.on_hand + ledger reason='couple_issuance')
--     -- color-up: SELECT public.chip_ops_color_up('<t>','<d100>','<d500>',400,8,'cu1');
--       -- EXPECT chip_bank: T100 +2000 (thu), T500 -400 (xuat); reasons 'couple_color_up'
--     -- reverse: SELECT public.chip_ops_reverse_color_up('<op>','rv1'); -- EXPECT bank restored, bank_reversed=true
--     -- deficit: xuat beyond on_hand → on_hand goes NEGATIVE (ghi nợ), op still succeeds.
--     -- manual still blocks: SELECT public.chip_ops_bank_adjust('<club>','<d100>','xuat', 1e9, NULL, <v>, 'k'); -- BANK_NEGATIVE
--   ROLLBACK;
-- ===========================================================================================
--
-- ROLLBACK (undo this migration), dependency order:
--   -- re-apply the 2C bodies of chip_ops_color_up + chip_ops_reverse_color_up (without coupling) from
--   --   20261020000000_chip_ops_color_up.sql, and the 1b body of chip_ops_set_issuance, and the 2B body of
--   --   get_chip_bank (without coupling_enabled).
--   DROP FUNCTION IF EXISTS public.chip_ops_bank_sync(uuid,jsonb);
--   DROP FUNCTION IF EXISTS public.chip_ops_set_bank_coupling(uuid,boolean);
--   DROP FUNCTION IF EXISTS public.chip_ops_bank_couple_apply(uuid,uuid,text,bigint,text,text,uuid,uuid,text);
--   DROP FUNCTION IF EXISTS public.chip_ops_coupling_on(uuid);
--   DROP TABLE IF EXISTS public.chip_ops_bank_config;
--   ALTER TABLE public.chip_bank ADD CONSTRAINT chip_bank_nonneg CHECK (on_hand_count >= 0);  -- only if no deficits exist
-- ===========================================================================================
