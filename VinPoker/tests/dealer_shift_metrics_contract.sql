\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN
    RAISE EXCEPTION 'assertion failed: %', p_message;
  END IF;
END;
$$;

SELECT pg_temp.assert_true(
  (SELECT relkind = 'v' FROM pg_catalog.pg_class WHERE oid = 'public.dealer_shift_metrics'::regclass),
  'dealer_shift_metrics must remain a plain view'
);

WITH expected(ordinal, name, type_name) AS (
  VALUES
    (1, 'attendance_id', 'uuid'),
    (2, 'dealer_id', 'uuid'),
    (3, 'full_name', 'text'),
    (4, 'tier', 'text'),
    (5, 'skills', 'text[]'),
    (6, 'shift_date', 'date'),
    (7, 'current_state', 'text'),
    (8, 'priority_break_flag', 'boolean'),
    (9, 'worked_minutes_since_last_break', 'integer'),
    (10, 'total_worked_minutes_today', 'integer'),
    (11, 'status', 'text'),
    (12, 'total_break_minutes', 'integer'),
    (13, 'last_break_end', 'timestamp with time zone'),
    (14, 'last_break_start', 'timestamp with time zone'),
    (15, 'minutes_since_rest', 'numeric'),
    (16, 'total_assignments', 'integer'),
    (17, 'last_table_id', 'uuid'),
    (18, 'pre_assigned_table_id', 'uuid'),
    (19, 'pre_assigned_at', 'timestamp with time zone'),
    (20, 'created_at', 'timestamp with time zone'),
    (21, 'updated_at', 'timestamp with time zone'),
    (22, 'club_id', 'uuid'),
    (23, 'dealer_status', 'text'),
    (24, 'total_worked_minutes', 'integer')
), actual AS (
  SELECT attribute.attnum AS ordinal,
         attribute.attname AS name,
         format_type(attribute.atttypid, attribute.atttypmod) AS type_name
  FROM pg_catalog.pg_attribute attribute
  WHERE attribute.attrelid = 'public.dealer_shift_metrics'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
)
SELECT pg_temp.assert_true(
  NOT EXISTS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ),
  'dealer_shift_metrics ordered columns must match the reviewed compatible contract'
);

SELECT pg_temp.assert_true(
  has_table_privilege('service_role', 'public.dealer_shift_metrics', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.dealer_shift_metrics', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.dealer_shift_metrics', 'SELECT'),
  'dealer_shift_metrics must be service-role-only after #0003'
);

SELECT pg_temp.assert_true(
  position('COALESCE(db.attendance_id, db_assign.attendance_id)' IN pg_get_viewdef('public.dealer_shift_metrics'::regclass, true)) > 0,
  'metrics definition must retain attendance-first break semantics'
);

SELECT 'dealer_shift_metrics_contract_sql_pass' AS result;
