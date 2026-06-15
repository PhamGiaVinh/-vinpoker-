-- 07_table_runner.sql  — PHASE D ONLY (service-role, READ-ONLY probe of the GE-2K lister).
-- Proves the table-runner DB lister gates dark and finds eligible tables. NO mutation
-- (both functions are read-only; the deal happens in the Edge, not here).
--
-- EXPECT while DARK (enabled=false): both return {"outcome":"disabled","tables":[]}.
-- EXPECT while enabled with a disposable table that has >=2 funded seated + no active hand
--   (and cooldown elapsed): op_run_due_table_ticks lists it; op_table_runner_diag buckets it
--   'eligible'. A table mid-hand → 'active_hand'; <2 funded → 'no_quorum'.

SET LOCAL ROLE service_role;

-- (A) Eligible-table lister (what the runner would deal).
SELECT public.op_run_due_table_ticks(50) AS due_tables;

-- (B) Diagnostic classification of every open table (the dry-run "why skipped" view).
SELECT public.op_table_runner_diag(200) AS diag;

-- (C) Focused check on the disposable table, if present.
SELECT jsonb_path_query(
  public.op_table_runner_diag(200),
  '$.tables[*] ? (@.table_id == $tid)',
  jsonb_build_object('tid', (SELECT id::text FROM public.online_poker_tables
                             WHERE name = 'GE2-DRILL-DISPOSABLE' ORDER BY created_at DESC LIMIT 1))
) AS disposable_table_bucket;
