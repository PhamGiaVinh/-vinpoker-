-- process-swing relational preflight tests. Disposable database only.
-- Run after 20270103000001_process_swing_cron_work_filter.sql.

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

INSERT INTO public.clubs (id, name, region, status)
VALUES
  ('c1000000-0000-4000-8000-000000000001', 'EMPTY AUTO ON', 'TEST', 'approved'),
  ('c1000000-0000-4000-8000-000000000002', 'WORK AUTO OFF', 'TEST', 'approved'),
  ('c1000000-0000-4000-8000-000000000003', 'WORK AUTO ON', 'TEST', 'approved'),
  ('c1000000-0000-4000-8000-000000000004', 'WORK NOT APPROVED', 'TEST', 'pending');

INSERT INTO public.club_settings (club_id, auto_swing_enabled)
VALUES
  ('c1000000-0000-4000-8000-000000000001', true),
  ('c1000000-0000-4000-8000-000000000002', false),
  ('c1000000-0000-4000-8000-000000000003', true),
  ('c1000000-0000-4000-8000-000000000004', true);

INSERT INTO public.game_tables (id, club_id, table_name, status)
VALUES
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'OFF WORK', 'active'),
  ('c2000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'ON WORK', 'active'),
  ('c2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000004', 'PENDING WORK', 'active');

INSERT INTO public.dealer_rotation_schedule (
  club_id, table_id, slot_index, planned_relief_at,
  status, plan_run_id, solver_version
)
VALUES
  ('c1000000-0000-4000-8000-000000000002', 'c2000000-0000-4000-8000-000000000002', 0, now() + interval '5 minutes', 'predicted', 'c3000000-0000-4000-8000-000000000002', 'due-club-test'),
  ('c1000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000003', 0, now() + interval '5 minutes', 'predicted', 'c3000000-0000-4000-8000-000000000003', 'due-club-test'),
  ('c1000000-0000-4000-8000-000000000004', 'c2000000-0000-4000-8000-000000000004', 0, now() + interval '5 minutes', 'predicted', 'c3000000-0000-4000-8000-000000000004', 'due-club-test');

SELECT pg_temp.assert_true(
  public.get_process_swing_due_club_ids()
    @> ARRAY['c1000000-0000-4000-8000-000000000003'::uuid]
  AND NOT (
    public.get_process_swing_due_club_ids()
      && ARRAY[
        'c1000000-0000-4000-8000-000000000001'::uuid,
        'c1000000-0000-4000-8000-000000000002'::uuid,
        'c1000000-0000-4000-8000-000000000004'::uuid
      ]
  ),
  'only approved auto-on clubs with real work are selected'
);

SELECT pg_temp.assert_true(
  NOT has_function_privilege(
    'authenticated',
    'public.get_process_swing_due_club_ids()',
    'EXECUTE'
  ),
  'preflight helper remains service-role only'
);

ROLLBACK;
