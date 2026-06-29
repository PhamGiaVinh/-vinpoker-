-- ============================================================================
-- PATCH 4 B+C — ROLLBACK PROOF (run AFTER the dry-run; READ-ONLY; confirms the live DB is untouched)
-- ============================================================================
SELECT 1 AS seq, 'source_entry_id column reverted' AS check_name,
   CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_registrations' AND column_name='source_entry_id') THEN 'PASS (gone)' ELSE 'FAIL (still present!)' END AS result
UNION ALL SELECT 2, '_assign_reentry_seat reverted',
   CASE WHEN to_regprocedure('public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)') IS NULL THEN 'PASS (gone)' ELSE 'FAIL' END
UNION ALL SELECT 3, 'confirm_reentry_and_assign_seat reverted',
   CASE WHEN to_regprocedure('public.confirm_reentry_and_assign_seat(uuid,uuid,text)') IS NULL THEN 'PASS (gone)' ELSE 'FAIL' END
UNION ALL SELECT 4, 'settle reverted to baseline (no re-entry dispatch)',
   CASE WHEN pg_get_functiondef(to_regprocedure('public.settle_bank_transaction(uuid,boolean)')) !~ 'confirm_reentry_and_assign_seat' THEN 'PASS (baseline)' ELSE 'FAIL' END
UNION ALL SELECT 5, 'uniq_treg_active restored / re-entry uniques gone',
   CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_treg_active') AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_treg_pending_reentry_per_entry') THEN 'PASS (restored)' ELSE 'FAIL' END
UNION ALL SELECT 6, 'no synthetic [RESBX] tournaments remain',
   CASE WHEN NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id::text LIKE 'ae500000-%') THEN 'PASS (none)' ELSE 'FAIL' END
UNION ALL SELECT 7, 'no synthetic registrations remain',
   CASE WHEN NOT EXISTS (SELECT 1 FROM public.tournament_registrations WHERE id::text LIKE 'ae500000-%' OR reference_code LIKE 'REENTRY-RE0%' OR reference_code='VINRegRE000007') THEN 'PASS (none)' ELSE 'FAIL' END
UNION ALL SELECT 8, 'no synthetic bank_transactions remain',
   CASE WHEN NOT EXISTS (SELECT 1 FROM public.bank_transactions WHERE id::text LIKE 'ae100000-%') THEN 'PASS (none)' ELSE 'FAIL' END
UNION ALL SELECT 9, 'no payment_settlements residue',
   CASE WHEN NOT EXISTS (SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id::text LIKE 'ae100000-%') THEN 'PASS (none)' ELSE 'FAIL' END
UNION ALL SELECT 10, 'no synthetic [RESBX] platform_bank_accounts remain',
   CASE WHEN NOT EXISTS (SELECT 1 FROM public.platform_bank_accounts WHERE account_number='RESBX-ACCT') THEN 'PASS (none)' ELSE 'FAIL' END
ORDER BY seq;
