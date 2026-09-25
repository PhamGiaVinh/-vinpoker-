-- Disposable package-guard test. No real payment is created or inferred.
DO $$ DECLARE v_event uuid:='30000000-0000-0000-0000-000000000002';
 v_first uuid; v_reverse uuid; v_adjust uuid; v_out jsonb;
BEGIN
 IF pg_catalog.has_table_privilege('service_role',
    'public.multi_day_overlay_funding_v1','INSERT') OR
    pg_catalog.has_table_privilege('authenticated',
    'public.multi_day_overlay_funding_v1','INSERT') THEN
   RAISE EXCEPTION 'overlay_direct_insert_privilege_exposed';
 END IF;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
     'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
     '92000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_gate_off_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
     'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
     '92000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_wrong_club_owner_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_overlay_owner_required' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_out:=public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
   'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
   '92000000-0000-0000-0000-000000000001');
 v_first:=(v_out->>'recordId')::uuid;
 IF v_out->>'status'<>'RECORDED' OR v_first IS NULL THEN
   RAISE EXCEPTION 'overlay_record_failed'; END IF;
 IF (public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
   'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
   '92000000-0000-0000-0000-000000000001'))->>'idempotent'<>'true' THEN
   RAISE EXCEPTION 'overlay_retry_failed'; END IF;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',5000000,
     'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
     '92000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_wrong_payload_bypassed';
 EXCEPTION WHEN unique_violation THEN
   IF SQLERRM<>'multi_day_overlay_request_conflict' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'REVERSAL',3000000,
     'bank-evidence-002','Corrected bank evidence',v_first,NULL,gen_random_uuid());
   RAISE EXCEPTION 'partial_reversal_bypassed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_reversal_invalid' THEN RAISE; END IF;
 END;
 v_out:=public.multi_day_record_overlay_v1(v_event,'REVERSAL',4000000,
   'bank-evidence-002','Corrected bank evidence',v_first,NULL,
   '92000000-0000-0000-0000-000000000002');
 v_reverse:=(v_out->>'recordId')::uuid;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'REVERSAL',4000000,
     'bank-evidence-003','Duplicate reversal denied',v_first,NULL,gen_random_uuid());
   RAISE EXCEPTION 'double_reversal_bypassed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_reversal_invalid' THEN RAISE; END IF;
 END;
 v_out:=public.multi_day_record_overlay_v1(v_event,'ADJUSTMENT',3000000,
   'bank-evidence-004','Corrected owner evidence',NULL,v_reverse,
   '92000000-0000-0000-0000-000000000003');
 v_adjust:=(v_out->>'recordId')::uuid;
 IF (SELECT sum(CASE WHEN kind='REVERSAL' THEN -amount_vnd ELSE amount_vnd END)
     FROM public.multi_day_overlay_funding_v1 WHERE event_id=v_event)<>3000000 OR
    (SELECT count(*) FROM public.multi_day_overlay_funding_v1 WHERE event_id=v_event)<>3 THEN
   RAISE EXCEPTION 'overlay_append_only_conservation_failed'; END IF;
 BEGIN
   UPDATE public.multi_day_overlay_funding_v1 SET amount_vnd=5000000 WHERE id=v_first;
   RAISE EXCEPTION 'overlay_update_bypassed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_qualification_immutable' THEN RAISE; END IF;
 END;
 IF v_adjust IS NULL THEN RAISE EXCEPTION 'overlay_adjustment_missing'; END IF;
END $$;
SELECT 'multiday_overlay_funding_v1 PASS' AS result;
