-- Restore default SELECT grants for anon role on all public tables.
-- A previous migration revoked everything. RLS policies still control row-level access.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', r.tablename);
  END LOOP;
END $$;

-- Also grant standard privileges to authenticated for write tables (RLS still gates rows)
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;