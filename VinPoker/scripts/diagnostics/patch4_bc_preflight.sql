-- ============================================================================
-- PATCH 4 B+C — PRE-FLIGHT pre-state probe (READ-ONLY). Run FIRST, BEFORE the apply script.
-- Expect EVERY row to read 'PASS …'. Any row reading 'STOP' means B/C is already (partly) live —
-- do NOT run the apply script; investigate. This statement writes NOTHING.
-- ============================================================================
SELECT 1 AS seq, 'source_entry_id column absent' AS check_name,
   CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tournament_registrations' AND column_name='source_entry_id') THEN 'PASS (absent)' ELSE 'STOP (already present)' END AS result
UNION ALL SELECT 2, 'confirm_reentry_and_assign_seat absent',
   CASE WHEN to_regprocedure('public.confirm_reentry_and_assign_seat(uuid,uuid,text)') IS NULL THEN 'PASS (absent)' ELSE 'STOP (already present)' END
UNION ALL SELECT 3, '_assign_reentry_seat absent',
   CASE WHEN to_regprocedure('public._assign_reentry_seat(uuid,uuid,uuid,uuid,uuid,text,integer)') IS NULL THEN 'PASS (absent)' ELSE 'STOP (already present)' END
UNION ALL SELECT 4, 'settle is BASELINE (no re-entry dispatch)',
   CASE WHEN pg_get_functiondef(to_regprocedure('public.settle_bank_transaction(uuid,boolean)')) !~ 'confirm_reentry_and_assign_seat' THEN 'PASS (baseline)' ELSE 'STOP (already dispatches)' END
UNION ALL SELECT 5, 'OLD uniq_treg_active present (pre-B state)',
   CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_treg_active') THEN 'PASS (present)' ELSE 'STOP (missing — investigate)' END
UNION ALL SELECT 6, 'uniq_treg_pending_reentry_per_entry absent',
   CASE WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_treg_pending_reentry_per_entry') THEN 'PASS (absent)' ELSE 'STOP (already present)' END
UNION ALL SELECT 7, 'schema_migrations has NO B/C rows',
   CASE WHEN NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261122000000','20261122000001','20261123000000')) THEN 'PASS (absent)' ELSE 'STOP (version row present)' END
ORDER BY seq;
