-- Forward-only chip integrity. SOURCE ONLY until reviewed, restore-tested and owner-gated.
-- Preserve rounding and append-only ledger. Daybreak/coupling flags are not changed.
-- Rollback: forward restore the recorded pre-apply function definitions; retain receipts.
BEGIN;
CREATE TABLE IF NOT EXISTS floor_private.chip_mutation_receipts(
  actor_id uuid NOT NULL, request_key text NOT NULL, operation text NOT NULL,
  payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,request_key)
);
ALTER TABLE floor_private.chip_mutation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON floor_private.chip_mutation_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.chip_ops_current_denom_counts(p_tournament_id uuid)
RETURNS TABLE(denomination_id uuid,value bigint,color text,issued_count bigint,current_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid;
BEGIN
  SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND OR actor IS NULL OR NOT(COALESCE(public.is_club_owner(actor,club),false) OR COALESCE(public.is_club_chip_master(actor,club),false)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='chip_inventory_access_denied';
  END IF;
  RETURN QUERY WITH issued AS (
    SELECT d.id AS denomination_id,SUM(l.count::bigint*COALESCE(i.issued_count,0))::bigint AS total
    FROM public.stack_template st JOIN public.stack_template_line l ON l.stack_template_id=st.id
    JOIN public.chip_set_denomination d ON d.id=l.denomination_id
    LEFT JOIN public.stack_template_issuance i ON i.stack_template_id=st.id
    WHERE st.tournament_id=p_tournament_id AND st.club_id=club AND d.club_id=club GROUP BY d.id
  ), ledger AS (
    SELECT l.denomination_id,COALESCE(SUM(l.delta_count),0)::bigint AS delta
    FROM public.chip_inventory_ledger l WHERE l.tournament_id=p_tournament_id AND l.club_id=club GROUP BY l.denomination_id
  )
  SELECT d.id,d.value,d.color,COALESCE(i.total,0)::bigint,(COALESCE(i.total,0)+COALESCE(g.delta,0))::bigint
  FROM public.chip_set_denomination d LEFT JOIN issued i ON i.denomination_id=d.id LEFT JOIN ledger g ON g.denomination_id=d.id
  WHERE d.club_id=club AND (i.denomination_id IS NOT NULL OR g.denomination_id IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_current_denom_counts(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_current_denom_counts(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.chip_ops_color_up(
  p_tournament_id uuid,p_denom_removed uuid,p_denom_target uuid,p_target_added bigint,
  p_level_number integer DEFAULT NULL,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  actor uuid:=auth.uid(); club uuid; level_no integer; removed_val bigint; target_val bigint;
  removed_count bigint; target_before bigint; rounding bigint; operation_id uuid;
  prior public.color_up_operation%ROWTYPE; receipt floor_private.chip_mutation_receipts%ROWTYPE;
  payload jsonb; result jsonb;
BEGIN
  IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF p_tournament_id IS NULL OR p_denom_removed IS NULL OR p_denom_target IS NULL OR
     p_target_added IS NULL OR p_target_added<0 OR p_idempotency_key IS NULL OR
     length(btrim(p_idempotency_key))=0 OR length(p_idempotency_key)>128 THEN
    RETURN jsonb_build_object('error','INVALID_INPUT');
  END IF;
  SELECT t.club_id,t.current_level INTO club,level_no FROM public.tournaments t
    WHERE t.id=p_tournament_id AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (COALESCE(public.is_club_owner(actor,club),false) OR COALESCE(public.is_club_chip_master(actor,club),false)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  payload:=jsonb_build_object('tournament',p_tournament_id,'removed',p_denom_removed,'target',p_denom_target,
    'added',p_target_added,'level',p_level_number);
  -- Club fence also serializes missing bank rows across different tournaments.
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||club::text));
  SELECT t.current_level INTO level_no FROM public.tournaments t
    WHERE t.id=p_tournament_id AND t.club_id=club AND t.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  -- Same global color key is serialized before consulting its existing receipt.
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext(p_idempotency_key));
  SELECT * INTO receipt FROM floor_private.chip_mutation_receipts r WHERE r.actor_id=actor AND r.request_key=p_idempotency_key;
  IF FOUND THEN
    IF receipt.operation<>'color_up' OR receipt.payload<>payload THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN receipt.result;
  END IF;
  level_no:=COALESCE(p_level_number,level_no,0);
  SELECT * INTO prior FROM public.color_up_operation o WHERE o.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF prior.confirmed_by IS DISTINCT FROM actor OR prior.tournament_id IS DISTINCT FROM p_tournament_id OR
       prior.denom_removed IS DISTINCT FROM p_denom_removed OR prior.denom_target IS DISTINCT FROM p_denom_target OR
       prior.target_added IS DISTINCT FROM p_target_added OR (p_level_number IS NOT NULL AND prior.level_number IS DISTINCT FROM level_no) THEN
      RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT');
    END IF;
    -- Legacy rows do not retain the exact nullable request payload. Do not invent it.
    RETURN jsonb_build_object('error','LEGACY_RECEIPT_REVIEW_REQUIRED','color_up_operation_id',prior.id);
  END IF;
  SELECT d.value INTO removed_val FROM public.tournament_chip_set s JOIN public.chip_set_denomination d ON d.chip_set_id=s.chip_set_id
    WHERE s.tournament_id=p_tournament_id AND d.id=p_denom_removed AND d.club_id=club;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','DENOM_NOT_IN_SET'); END IF;
  SELECT d.value INTO target_val FROM public.tournament_chip_set s JOIN public.chip_set_denomination d ON d.chip_set_id=s.chip_set_id
    WHERE s.tournament_id=p_tournament_id AND d.id=p_denom_target AND d.club_id=club;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','DENOM_NOT_IN_SET'); END IF;
  IF p_denom_removed=p_denom_target THEN RETURN jsonb_build_object('error','SAME_DENOM'); END IF;
  IF target_val<=removed_val THEN RETURN jsonb_build_object('error','NOT_RACING_UP'); END IF;
  IF EXISTS(SELECT 1 FROM public.color_up_operation o WHERE o.tournament_id=p_tournament_id AND o.denom_removed=p_denom_removed
    AND o.level_number=level_no AND o.status='confirmed') THEN RETURN jsonb_build_object('error','ALREADY_DONE'); END IF;
  SELECT c.current_count INTO removed_count FROM public.chip_ops_current_denom_counts(p_tournament_id) c WHERE c.denomination_id=p_denom_removed;
  IF COALESCE(removed_count,0)<=0 THEN RETURN jsonb_build_object('error','NOTHING_TO_REMOVE'); END IF;
  SELECT c.current_count INTO target_before FROM public.chip_ops_current_denom_counts(p_tournament_id) c WHERE c.denomination_id=p_denom_target;
  target_before:=COALESCE(target_before,0);
  rounding:=removed_count*removed_val-p_target_added*target_val;
  IF abs(rounding)>=target_val THEN RETURN jsonb_build_object('error','VALUE_NOT_CONSERVED'); END IF;
  -- Consistent ordering for two-bank-row coupling; issuance uses the same order.
  PERFORM 1 FROM public.chip_bank b WHERE b.club_id=club AND b.denomination_id IN(p_denom_removed,p_denom_target)
    ORDER BY b.denomination_id FOR UPDATE;
  INSERT INTO public.color_up_operation(tournament_id,club_id,denom_removed,denom_target,removed_count,target_added,
    value_removed,value_added,rounding_delta,level_number,idempotency_key,confirmed_by,confirmed_at)
  VALUES(p_tournament_id,club,p_denom_removed,p_denom_target,removed_count,p_target_added,
    removed_count*removed_val,p_target_added*target_val,rounding,level_no,p_idempotency_key,actor,clock_timestamp()) RETURNING id INTO operation_id;
  INSERT INTO public.color_up_line(operation_id,club_id,denomination_id,role,count_before,count_after)
  VALUES(operation_id,club,p_denom_removed,'removed',removed_count,0),(operation_id,club,p_denom_target,'target',target_before,target_before+p_target_added);
  INSERT INTO public.chip_inventory_ledger(tournament_id,club_id,denomination_id,delta_count,reason,ref_type,ref_id)
  VALUES(p_tournament_id,club,p_denom_removed,-removed_count,'color_up_out','color_up_operation',operation_id),
    (p_tournament_id,club,p_denom_target,p_target_added,'color_up_in','color_up_operation',operation_id);
  IF public.chip_ops_coupling_on(club) THEN
    PERFORM public.chip_ops_bank_couple_apply(club,p_denom_removed,'thu',removed_count,'couple_color_up','color_up_operation',operation_id,p_tournament_id,'couple:cu:'||operation_id::text||':thu');
    PERFORM public.chip_ops_bank_couple_apply(club,p_denom_target,'xuat',p_target_added,'couple_color_up','color_up_operation',operation_id,p_tournament_id,'couple:cu:'||operation_id::text||':xuat');
  END IF;
  result:=jsonb_build_object('status','ok','color_up_operation_id',operation_id,'removed_count',removed_count,'target_added',p_target_added,
    'value_removed',removed_count*removed_val,'value_added',p_target_added*target_val,'rounding_delta',rounding);
  INSERT INTO floor_private.chip_mutation_receipts VALUES(actor,p_idempotency_key,'color_up',payload,result,now());
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_color_up(uuid,uuid,uuid,bigint,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chip_ops_reverse_color_up(p_operation_id uuid,p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); op public.color_up_operation%ROWTYPE; tour uuid; target_stock bigint; bank_stock bigint;
  coupled boolean; payload jsonb; result jsonb; receipt floor_private.chip_mutation_receipts%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF p_operation_id IS NULL OR p_idempotency_key IS NULL OR length(btrim(p_idempotency_key))=0 OR length(p_idempotency_key)>128 THEN
    RETURN jsonb_build_object('error','INVALID_INPUT');
  END IF;
  SELECT o.tournament_id INTO tour FROM public.color_up_operation o WHERE o.id=p_operation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','OPERATION_NOT_FOUND'); END IF;
  SELECT * INTO op FROM public.color_up_operation o WHERE o.id=p_operation_id;
  IF NOT (COALESCE(public.is_club_owner(actor,op.club_id),false) OR COALESCE(public.is_club_chip_master(actor,op.club_id),false)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||op.club_id::text));
  -- Same lock order as color-up and issuance: club fence, tournament, operation/template, bank.
  PERFORM 1 FROM public.tournaments t WHERE t.id=tour FOR UPDATE;
  SELECT * INTO op FROM public.color_up_operation o WHERE o.id=p_operation_id FOR UPDATE;
  IF NOT (COALESCE(public.is_club_owner(actor,op.club_id),false) OR COALESCE(public.is_club_chip_master(actor,op.club_id),false)) THEN
    RETURN jsonb_build_object('error','Forbidden');
  END IF;
  payload:=jsonb_build_object('operation',p_operation_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext(p_idempotency_key));
  SELECT * INTO receipt FROM floor_private.chip_mutation_receipts r WHERE r.actor_id=actor AND r.request_key=p_idempotency_key;
  IF FOUND THEN
    IF receipt.operation<>'reverse_color_up' OR receipt.payload<>payload THEN RETURN jsonb_build_object('error','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN receipt.result;
  END IF;
  IF op.status='reversed' THEN
    result:=jsonb_build_object('status','ok','idempotent',true,'color_up_operation_id',p_operation_id);
  ELSE
    IF EXISTS(SELECT 1 FROM public.color_up_operation later WHERE later.tournament_id=tour AND later.status='confirmed'
      AND later.id<>op.id AND later.confirmed_at>=op.confirmed_at
      AND (later.denom_removed IN(op.denom_removed,op.denom_target) OR later.denom_target IN(op.denom_removed,op.denom_target))) THEN
      RETURN jsonb_build_object('error','UNDO_DEPENDENCY','detail','reverse_later_color_up_first');
    END IF;
    SELECT c.current_count INTO target_stock FROM public.chip_ops_current_denom_counts(tour) c WHERE c.denomination_id=op.denom_target;
    IF COALESCE(target_stock,0)<op.target_added THEN RETURN jsonb_build_object('error','INVENTORY_NEGATIVE'); END IF;
    PERFORM 1 FROM public.chip_bank b WHERE b.club_id=op.club_id AND b.denomination_id IN(op.denom_removed,op.denom_target)
      ORDER BY b.denomination_id FOR UPDATE;
    SELECT EXISTS(SELECT 1 FROM public.chip_bank_ledger l WHERE l.ref_type='color_up_operation' AND l.ref_id=op.id AND l.reason='couple_color_up') INTO coupled;
    IF coupled THEN
      SELECT b.on_hand_count INTO bank_stock FROM public.chip_bank b WHERE b.club_id=op.club_id AND b.denomination_id=op.denom_removed;
      IF COALESCE(bank_stock,0)<op.removed_count THEN RETURN jsonb_build_object('error','BANK_NEGATIVE'); END IF;
    END IF;
    INSERT INTO public.chip_inventory_ledger(tournament_id,club_id,denomination_id,delta_count,reason,ref_type,ref_id,details)
    VALUES(tour,op.club_id,op.denom_removed,op.removed_count,'color_up_in','color_up_operation',op.id,jsonb_build_object('reverse',true)),
      (tour,op.club_id,op.denom_target,-op.target_added,'color_up_out','color_up_operation',op.id,jsonb_build_object('reverse',true));
    IF coupled THEN
      PERFORM public.chip_ops_bank_couple_apply(op.club_id,op.denom_removed,'xuat',op.removed_count,'couple_color_up_reverse','color_up_operation',op.id,tour,'couple:cur:'||op.id::text||':xuat');
      PERFORM public.chip_ops_bank_couple_apply(op.club_id,op.denom_target,'thu',op.target_added,'couple_color_up_reverse','color_up_operation',op.id,tour,'couple:cur:'||op.id::text||':thu');
    END IF;
    UPDATE public.color_up_operation SET status='reversed',reversed_by=actor,reversed_at=now() WHERE id=op.id;
    result:=jsonb_build_object('status','ok','color_up_operation_id',op.id,'reversed',true,'bank_reversed',coupled);
  END IF;
  INSERT INTO floor_private.chip_mutation_receipts VALUES(actor,p_idempotency_key,'reverse_color_up',payload,result,now());
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_reverse_color_up(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_reverse_color_up(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chip_ops_set_issuance(p_stack_template_id uuid,p_issued_count integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); club uuid; tour uuid; old_count integer; delta integer; coupled boolean; line record;
BEGIN
  IF actor IS NULL THEN RETURN jsonb_build_object('error','Unauthorized'); END IF;
  IF p_issued_count IS NULL OR p_issued_count<0 THEN RETURN jsonb_build_object('error','INVALID_INPUT'); END IF;
  SELECT st.tournament_id INTO tour FROM public.stack_template st WHERE st.id=p_stack_template_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TEMPLATE_NOT_FOUND'); END IF;
  SELECT t.club_id INTO club FROM public.tournaments t WHERE t.id=tour AND t.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  IF NOT (COALESCE(public.is_club_owner(actor,club),false) OR COALESCE(public.is_club_chip_master(actor,club),false)) THEN RETURN jsonb_build_object('error','Forbidden'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||club::text));
  PERFORM 1 FROM public.tournaments t WHERE t.id=tour AND t.club_id=club AND t.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TOURNAMENT_NOT_FOUND'); END IF;
  PERFORM 1 FROM public.stack_template st WHERE st.id=p_stack_template_id AND st.tournament_id=tour AND st.club_id=club FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','TEMPLATE_NOT_IN_CLUB'); END IF;
  SELECT i.issued_count INTO old_count FROM public.stack_template_issuance i WHERE i.stack_template_id=p_stack_template_id;
  delta:=p_issued_count-COALESCE(old_count,0);
  IF EXISTS(SELECT 1 FROM public.stack_template_line l LEFT JOIN public.chip_set_denomination d ON d.id=l.denomination_id
    WHERE l.stack_template_id=p_stack_template_id AND (d.id IS NULL OR d.club_id IS DISTINCT FROM club OR l.count<0)) THEN
    RETURN jsonb_build_object('error','DENOM_NOT_IN_SET');
  END IF;
  IF EXISTS(SELECT 1 FROM public.stack_template_line l LEFT JOIN public.chip_ops_current_denom_counts(tour) c ON c.denomination_id=l.denomination_id
    WHERE l.stack_template_id=p_stack_template_id AND COALESCE(c.current_count,0)+delta::bigint*l.count<0) THEN
    RETURN jsonb_build_object('error','INVENTORY_NEGATIVE');
  END IF;
  PERFORM 1 FROM public.chip_bank b WHERE b.club_id=club AND b.denomination_id IN(SELECT l.denomination_id FROM public.stack_template_line l WHERE l.stack_template_id=p_stack_template_id)
    ORDER BY b.denomination_id FOR UPDATE;
  coupled:=delta<>0 AND public.chip_ops_coupling_on(club);
  IF coupled THEN
    FOR line IN SELECT l.denomination_id,l.count FROM public.stack_template_line l WHERE l.stack_template_id=p_stack_template_id ORDER BY l.denomination_id LOOP
      PERFORM public.chip_ops_bank_couple_apply(club,line.denomination_id,CASE WHEN delta>0 THEN 'xuat' ELSE 'thu' END,
        abs(delta)::bigint*line.count,'couple_issuance','stack_template',p_stack_template_id,tour,NULL);
    END LOOP;
  END IF;
  INSERT INTO public.stack_template_issuance(stack_template_id,issued_count,club_id,updated_by)
  VALUES(p_stack_template_id,p_issued_count,club,actor) ON CONFLICT(stack_template_id) DO UPDATE
    SET issued_count=EXCLUDED.issued_count,updated_at=now(),updated_by=EXCLUDED.updated_by;
  RETURN jsonb_build_object('status','ok','stack_template_id',p_stack_template_id,'issued_count',p_issued_count,'coupled',coupled);
END;
$$;
REVOKE ALL ON FUNCTION public.chip_ops_set_issuance(uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_set_issuance(uuid,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.chip_ops_bank_sync(p_club_id uuid, p_totals jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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

  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||p_club_id::text));
  PERFORM 1 FROM public.tournaments t WHERE t.club_id=p_club_id AND t.deleted_at IS NULL
    ORDER BY t.id FOR UPDATE;
  PERFORM 1 FROM public.chip_bank b WHERE b.club_id=p_club_id ORDER BY b.denomination_id FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status) ORDER BY t.name),'[]'::jsonb)
  INTO v_tours FROM public.tournaments t
  WHERE t.club_id = p_club_id AND t.deleted_at IS NULL
    AND (t.status IS NULL OR t.status NOT IN ('completed','cancelled'));

  FOR r IN SELECT x.denomination_id, x.total
           FROM jsonb_to_recordset(p_totals) AS x(denomination_id uuid, total bigint) ORDER BY x.denomination_id
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
REVOKE ALL ON FUNCTION public.chip_ops_bank_sync(uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_bank_sync(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(
  p_club_id         uuid,
  p_denomination_id uuid,
  p_direction       text,
  p_count           bigint,
  p_tournament_id   uuid DEFAULT NULL,
  p_old_version     integer DEFAULT 0,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_on    bigint;
  v_ver   integer;
  v_new   bigint;
  v_prior public.chip_bank_ledger%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF p_club_id IS NULL OR p_denomination_id IS NULL OR p_direction IS NULL OR
     p_direction NOT IN ('xuat', 'thu') OR p_count IS NULL OR p_count <= 0 OR
     p_old_version IS NULL OR p_old_version < 0 OR
     p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 OR
     length(p_idempotency_key) > 128 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT');
  END IF;
  IF NOT (COALESCE(public.is_club_owner(v_uid, p_club_id), false) OR
          COALESCE(public.is_club_chip_master(v_uid, p_club_id), false)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chip_set_denomination d
    WHERE d.id = p_denomination_id AND d.club_id = p_club_id
  ) THEN
    RETURN jsonb_build_object('error', 'DENOM_NOT_IN_CLUB');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(280016,pg_catalog.hashtext('club:'||p_club_id::text));
  -- Serialize callers of one global idempotency key before reading its ledger row.
  -- Otherwise a concurrent retry can read an uncommitted ledger miss, wait on
  -- the bank row, then incorrectly report race_lost after the first call commits.
  PERFORM pg_catalog.pg_advisory_xact_lock(280011, pg_catalog.hashtext(p_idempotency_key));

  -- A committed retry must return the prior receipt, never apply a second balance change.
  -- The global unique key is not authority to replay another actor's or payload's result.
  SELECT * INTO v_prior FROM public.chip_bank_ledger
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_prior.club_id IS DISTINCT FROM p_club_id OR
       v_prior.reason IS DISTINCT FROM 'manual' OR
       v_prior.denomination_id IS DISTINCT FROM p_denomination_id OR
       v_prior.tournament_id IS DISTINCT FROM p_tournament_id OR
       v_prior.direction IS DISTINCT FROM p_direction OR
       v_prior.count IS DISTINCT FROM p_count OR
       v_prior.actor IS DISTINCT FROM v_uid OR
       (v_prior.details ? 'expected_version' AND
        (v_prior.details->>'expected_version')::integer IS DISTINCT FROM p_old_version) THEN
      RETURN jsonb_build_object('error', 'IDEMPOTENCY_CONFLICT');
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'idempotent', true,
      'direction', v_prior.direction, 'count', v_prior.count,
      'on_hand_count', v_prior.balance_after, 'balance_after', v_prior.balance_after);
  END IF;

  IF p_tournament_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tournaments t
    WHERE t.id = p_tournament_id AND t.club_id = p_club_id AND t.deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'TOURNAMENT_NOT_IN_CLUB');
  END IF;

  SELECT on_hand_count, version INTO v_on, v_ver
  FROM public.chip_bank
  WHERE club_id = p_club_id AND denomination_id = p_denomination_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_old_version <> 0 THEN RETURN jsonb_build_object('error', 'race_lost'); END IF;
    v_on := 0;
    v_new := CASE WHEN p_direction = 'thu' THEN p_count ELSE -p_count END;
    IF v_new < 0 THEN RETURN jsonb_build_object('error', 'BANK_NEGATIVE', 'on_hand', v_on); END IF;
    BEGIN
      INSERT INTO public.chip_bank (club_id, denomination_id, on_hand_count, version, updated_by)
      VALUES (p_club_id, p_denomination_id, v_new, 1, v_uid);
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('error', 'race_lost');
    END;
  ELSE
    IF v_ver <> p_old_version THEN
      RETURN jsonb_build_object('error', 'race_lost', 'actual_version', v_ver);
    END IF;
    v_new := CASE WHEN p_direction = 'thu' THEN v_on + p_count ELSE v_on - p_count END;
    IF v_new < 0 THEN RETURN jsonb_build_object('error', 'BANK_NEGATIVE', 'on_hand', v_on); END IF;
    UPDATE public.chip_bank
    SET on_hand_count = v_new, version = v_ver + 1, updated_at = now(), updated_by = v_uid
    WHERE club_id = p_club_id AND denomination_id = p_denomination_id;
  END IF;

  INSERT INTO public.chip_bank_ledger
    (club_id, denomination_id, tournament_id, direction, count, balance_after,
     reason, idempotency_key, actor, details)
  VALUES
    (p_club_id, p_denomination_id, p_tournament_id, p_direction, p_count, v_new,
     'manual', p_idempotency_key, v_uid, jsonb_build_object('expected_version', p_old_version));

  RETURN jsonb_build_object('status', 'ok', 'direction', p_direction,
    'count', p_count, 'on_hand_count', v_new, 'balance_after', v_new);
END;
$function$;
REVOKE ALL ON FUNCTION public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.chip_ops_bank_adjust(uuid,uuid,text,bigint,uuid,integer,text) TO authenticated;
COMMIT;
