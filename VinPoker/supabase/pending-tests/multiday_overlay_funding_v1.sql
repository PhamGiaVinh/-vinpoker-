-- Disposable bank-proof fixture; no production payment is created or inferred.
DO $$ DECLARE v_event uuid:='30000000-0000-0000-0000-000000000002';
 v_first uuid; v_reverse uuid; v_adjust uuid; v_out jsonb;
BEGIN
 INSERT INTO public.bank_transactions(id,provider,api_verified_at,transfer_type,
   amount,status,account_number,club_id) VALUES
 ('ba000000-0000-0000-0000-000000000001','sepay',now(),'in',4000000,
   'unmatched','proof-account-1','20000000-0000-0000-0000-000000000001'),
 ('ba000000-0000-0000-0000-000000000002','sepay',now(),'in',3000000,
   'unmatched','proof-account-1','20000000-0000-0000-0000-000000000001');
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
     '92000000-0000-0000-0000-000000000001',
     'ba000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_gate_off_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_package_release_off' THEN RAISE; END IF;
 END;
 UPDATE public.multi_day_package_release_v1 SET enabled=true;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',4000001,
     'bank-evidence-001','Amount exceeds verified bank row',NULL,NULL,
     gen_random_uuid(),'ba000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_overallocation_accepted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_bank_unverified_or_allocated' THEN RAISE; END IF;
 END;
 UPDATE public.bank_transactions SET api_verified_at=NULL
   WHERE id='ba000000-0000-0000-0000-000000000001';
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
     'bank-evidence-001','Unverified bank row cannot fund',NULL,NULL,
     gen_random_uuid(),'ba000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_unverified_bank_accepted';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_bank_unverified_or_allocated' THEN RAISE; END IF;
 END;
 UPDATE public.bank_transactions SET api_verified_at=now()
   WHERE id='ba000000-0000-0000-0000-000000000001';
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
     'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
     '92000000-0000-0000-0000-000000000001',
     'ba000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_wrong_club_owner_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_overlay_owner_required' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
 v_out:=public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
   'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
   '92000000-0000-0000-0000-000000000001',
   'ba000000-0000-0000-0000-000000000001');
 v_first:=(v_out->>'recordId')::uuid;
 IF v_out->>'status'<>'RECORDED' OR v_first IS NULL THEN
   RAISE EXCEPTION 'overlay_record_failed'; END IF;
 BEGIN
   INSERT INTO public.cashier_buyin_movements(bank_transaction_id,club_id,
     purpose,direction,amount,applied_amount)
   VALUES('ba000000-0000-0000-0000-000000000001',
     '20000000-0000-0000-0000-000000000001','buyin','in',4000000,4000000);
   RAISE EXCEPTION 'overlay_bank_reused_by_cashier';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_bank_already_allocated' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
     'bank-evidence-dup','Same bank cannot fund twice',NULL,NULL,
     gen_random_uuid(),'ba000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_bank_double_allocated';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_bank_unverified_or_allocated' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.bank_transactions SET amount=8000000
     WHERE id='ba000000-0000-0000-0000-000000000001';
   RAISE EXCEPTION 'allocated_bank_mutated';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_allocated_bank_immutable' THEN RAISE; END IF;
 END;
 IF (public.multi_day_record_overlay_v1(v_event,'RECORDED',4000000,
   'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
   '92000000-0000-0000-0000-000000000001',
   'ba000000-0000-0000-0000-000000000001'))->>'idempotent'<>'true' THEN
   RAISE EXCEPTION 'overlay_retry_failed'; END IF;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'RECORDED',5000000,
     'bank-evidence-001','Owner verified overlay receipt',NULL,NULL,
     '92000000-0000-0000-0000-000000000001',
     'ba000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'overlay_wrong_payload_bypassed';
 EXCEPTION WHEN unique_violation THEN
   IF SQLERRM<>'multi_day_overlay_request_conflict' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'REVERSAL',3000000,
     'bank-evidence-002','Corrected bank evidence',v_first,NULL,gen_random_uuid(),NULL);
   RAISE EXCEPTION 'partial_reversal_bypassed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_reversal_invalid' THEN RAISE; END IF;
 END;
 v_out:=public.multi_day_record_overlay_v1(v_event,'REVERSAL',4000000,
   'bank-evidence-002','Corrected bank evidence',v_first,NULL,
   '92000000-0000-0000-0000-000000000002',NULL);
 v_reverse:=(v_out->>'recordId')::uuid;
 BEGIN
   PERFORM public.multi_day_record_overlay_v1(v_event,'REVERSAL',4000000,
     'bank-evidence-003','Duplicate reversal denied',v_first,NULL,gen_random_uuid(),NULL);
   RAISE EXCEPTION 'double_reversal_bypassed';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'multi_day_overlay_reversal_invalid' THEN RAISE; END IF;
 END;
 v_out:=public.multi_day_record_overlay_v1(v_event,'ADJUSTMENT',3000000,
   'bank-evidence-004','Corrected owner evidence',NULL,v_reverse,
   '92000000-0000-0000-0000-000000000003',
   'ba000000-0000-0000-0000-000000000002');
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
