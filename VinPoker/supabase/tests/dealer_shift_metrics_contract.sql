-- Run only against a disposable database after applying, in order:
--   1. 20270104000002_dealer_swing_contract_drift.sql
--   2. 20270104000003_dealer_shift_metrics_contract.sql
-- The test transaction rolls back all fixture rows after validating the public
-- metrics contract used by process-swing and mass-assign.

BEGIN;

DO $$
DECLARE
  expected_columns constant jsonb := jsonb_build_object(
    'attendance_id', 'uuid',
    'minutes_since_rest', 'numeric',
    'total_assignments', 'integer',
    'total_break_minutes', 'integer',
    'total_worked_minutes', 'integer'
  );
  missing_columns text[];
  view_definition text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'dealer_shift_metrics'
      AND relation.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'dealer_shift_metrics must be a view';
  END IF;

  SELECT array_agg(expected.key ORDER BY expected.key)
  INTO missing_columns
  FROM jsonb_each_text(expected_columns) AS expected(key, data_type)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = 'dealer_shift_metrics'
   AND actual.column_name = expected.key
   AND actual.data_type = expected.data_type
  WHERE actual.column_name IS NULL;

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'dealer_shift_metrics missing or mistyped columns: %', missing_columns;
  END IF;

  view_definition := pg_get_viewdef('public.dealer_shift_metrics'::regclass, true);
  IF view_definition !~
    'COALESCE\(db\.attendance_id, db_assign\.attendance_id\)[[:space:]]*=[[:space:]]*da\.id' THEN
    RAISE EXCEPTION 'dealer_shift_metrics must aggregate manual and assignment-linked breaks by attendance';
  END IF;
  IF view_definition !~ 'max\(dassign\.released_at\)'
     OR view_definition !~ 'da\.check_in_time' THEN
    RAISE EXCEPTION 'dealer_shift_metrics must retain released/check-in rest anchors';
  END IF;
  IF view_definition !~ 'FROM[[:space:]]+dealer_attendance[[:space:]]+da'
     OR view_definition !~ 'JOIN[[:space:]]+dealers[[:space:]]+d[[:space:]]+ON[[:space:]]+d\.id[[:space:]]*=[[:space:]]*da\.dealer_id' THEN
    RAISE EXCEPTION 'dealer_shift_metrics must retain an attendance row without assignment history';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.dealer_shift_metrics', 'SELECT') THEN
    RAISE EXCEPTION 'service_role must retain SELECT on dealer_shift_metrics';
  END IF;
  IF has_table_privilege('authenticated', 'public.dealer_shift_metrics', 'SELECT')
     OR has_table_privilege('anon', 'public.dealer_shift_metrics', 'SELECT') THEN
    RAISE EXCEPTION 'client roles must not have direct SELECT on dealer_shift_metrics';
  END IF;
END;
$$;

-- Fixture rows stay inside this transaction. They prove the attendance-first
-- relationship covers manual, assignment-backed, and unassigned attendance.
INSERT INTO public.clubs (id, name, region, status)
VALUES ('91000000-0000-0000-0000-000000000001', 'metrics-contract', 'test', 'pending');

INSERT INTO public.dealers (id, club_id, full_name, tier, status)
VALUES
  ('91000000-0000-0000-0000-000000000011', '91000000-0000-0000-0000-000000000001', 'Metric A', 'B', 'active'),
  ('91000000-0000-0000-0000-000000000012', '91000000-0000-0000-0000-000000000001', 'Metric B', 'B', 'active'),
  ('91000000-0000-0000-0000-000000000013', '91000000-0000-0000-0000-000000000001', 'Metric C', 'B', 'active');

INSERT INTO public.dealer_attendance (id, dealer_id, shift_date, status, check_in_time, current_state)
VALUES
  ('91000000-0000-0000-0000-000000000021', '91000000-0000-0000-0000-000000000011', CURRENT_DATE, 'checked_in', now() - interval '3 hours', 'available'),
  ('91000000-0000-0000-0000-000000000022', '91000000-0000-0000-0000-000000000012', CURRENT_DATE, 'checked_in', now() - interval '1 hour', 'available'),
  ('91000000-0000-0000-0000-000000000023', '91000000-0000-0000-0000-000000000013', CURRENT_DATE, 'checked_in', now() - interval '2 hours', 'available');

INSERT INTO public.game_tables (id, club_id, table_name)
VALUES
  ('91000000-0000-0000-0000-000000000031', '91000000-0000-0000-0000-000000000001', 'metrics-a'),
  ('91000000-0000-0000-0000-000000000032', '91000000-0000-0000-0000-000000000001', 'metrics-c');

INSERT INTO public.dealer_assignments (
  id, attendance_id, dealer_id, table_id, club_id, status, assigned_at, released_at, swing_due_at
)
VALUES
  (
    '91000000-0000-0000-0000-000000000041',
    '91000000-0000-0000-0000-000000000021',
    '91000000-0000-0000-0000-000000000011',
    '91000000-0000-0000-0000-000000000031',
    '91000000-0000-0000-0000-000000000001',
    'completed', now() - interval '3 hours', now() - interval '2 hours', now() - interval '2 hours'
  ),
  (
    '91000000-0000-0000-0000-000000000042',
    '91000000-0000-0000-0000-000000000023',
    '91000000-0000-0000-0000-000000000013',
    '91000000-0000-0000-0000-000000000032',
    '91000000-0000-0000-0000-000000000001',
    'completed', now() - interval '2 hours', now() - interval '90 minutes', now() - interval '90 minutes'
  );

INSERT INTO public.dealer_breaks (assignment_id, attendance_id, club_id, break_start, break_end, reason)
VALUES
  -- One break holds both links: the view must count it once, not twice.
  ('91000000-0000-0000-0000-000000000041', '91000000-0000-0000-0000-000000000021', '91000000-0000-0000-0000-000000000001', now() - interval '40 minutes', now() - interval '30 minutes', 'linked'),
  -- A manual break has no assignment link.
  (NULL, '91000000-0000-0000-0000-000000000021', '91000000-0000-0000-0000-000000000001', now() - interval '20 minutes', now() - interval '15 minutes', 'manual'),
  -- An older assignment-backed break has no direct attendance link.
  ('91000000-0000-0000-0000-000000000042', NULL, '91000000-0000-0000-0000-000000000001', now() - interval '50 minutes', now() - interval '43 minutes', 'assignment');

DO $$
DECLARE
  metric_a public.dealer_shift_metrics%ROWTYPE;
  metric_b public.dealer_shift_metrics%ROWTYPE;
  metric_c public.dealer_shift_metrics%ROWTYPE;
BEGIN
  SELECT * INTO metric_a
  FROM public.dealer_shift_metrics
  WHERE attendance_id = '91000000-0000-0000-0000-000000000021';

  IF metric_a.attendance_id IS NULL
     OR metric_a.total_break_minutes <> 15
     OR metric_a.total_assignments <> 1
     OR metric_a.minutes_since_rest < 110 THEN
    RAISE EXCEPTION 'manual and linked breaks must count once each with released_at as rest anchor';
  END IF;

  SELECT * INTO metric_b
  FROM public.dealer_shift_metrics
  WHERE attendance_id = '91000000-0000-0000-0000-000000000022';

  IF metric_b.attendance_id IS NULL OR metric_b.total_assignments <> 0 THEN
    RAISE EXCEPTION 'checked-in attendance without assignment history must remain visible';
  END IF;

  SELECT * INTO metric_c
  FROM public.dealer_shift_metrics
  WHERE attendance_id = '91000000-0000-0000-0000-000000000023';

  IF metric_c.attendance_id IS NULL OR metric_c.total_break_minutes <> 7 THEN
    RAISE EXCEPTION 'assignment-backed break must resolve through its assignment attendance';
  END IF;
END;
$$;

ROLLBACK;
