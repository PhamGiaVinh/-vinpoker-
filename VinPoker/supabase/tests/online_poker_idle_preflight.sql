-- Online-poker idle preflight contract tests. Disposable database only.
-- Run after 20270103000002_online_poker_idle_preflight.sql; all writes roll back.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_value boolean, p_label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_value IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'assert_true failed: %', p_label;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated', 'public.op_run_table_runner()', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'public.op_run_timeout_sweep()', 'EXECUTE'
  ),
  'both cron wrappers remain service-role only'
);

UPDATE public.online_poker_config
SET enabled = false
WHERE id;

SELECT pg_temp.assert_true(
  public.op_run_table_runner() IS NULL
  AND public.op_run_timeout_sweep() IS NULL,
  'disabled runtime returns NULL before Vault and HTTP'
);

-- Empty the disposable runtime inside this transaction, then enable it. This
-- proves enabled-but-idle preflights are also empty without changing the flag
-- or any data outside the rolled-back test transaction.
DELETE FROM public.online_poker_tables;
UPDATE public.online_poker_config
SET enabled = true
WHERE id;

SELECT pg_temp.assert_true(
  (public.op_run_due_table_ticks(1)->'tables') = '[]'::jsonb
  AND (public.op_timeout_sweep()->'hands') = '[]'::jsonb,
  'enabled idle database exposes no due table or expired hand'
);

SELECT pg_temp.assert_true(
  public.op_run_table_runner() IS NULL
  AND public.op_run_timeout_sweep() IS NULL,
  'enabled idle wrappers return NULL'
);

ROLLBACK;
