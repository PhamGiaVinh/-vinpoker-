-- READ-ONLY pg_repack gate assessment. Safe to run before owner approval.
-- The dashboard's free-disk value must be at least min_free_disk_before_repack
-- for EACH table selected for a full repack. Do not add the two requirements
-- together unless both tables will be repacked concurrently (not recommended).

SELECT
  name,
  default_version,
  installed_version
FROM pg_available_extensions
WHERE name = 'pg_repack';

SELECT
  relation_name,
  pg_size_pretty(total_bytes) AS current_total_size,
  pg_size_pretty(total_bytes * 2) AS min_free_disk_before_repack
FROM (
  VALUES
    (
      'public.dealer_rotation_schedule'::text,
      pg_total_relation_size('public.dealer_rotation_schedule'::regclass)
    ),
    (
      'cron.job_run_details'::text,
      pg_total_relation_size('cron.job_run_details'::regclass)
    )
) AS sizes(relation_name, total_bytes)
ORDER BY total_bytes DESC;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE (schemaname, tablename) IN (
  ('public', 'dealer_rotation_schedule'),
  ('cron', 'job_run_details')
)
  AND (indexdef ILIKE '%PRIMARY KEY%' OR indexdef ILIKE '%UNIQUE%')
ORDER BY schemaname, tablename, indexname;
