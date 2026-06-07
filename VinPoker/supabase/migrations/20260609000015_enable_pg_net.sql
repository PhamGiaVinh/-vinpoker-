-- Phase 5 PR #1 - Gap #2: Verify pg_net extension is enabled for net.http_post()
-- Required for notify_dealer_ready_v2 trigger to call process-swing-on-dealer-ready edge function
--
-- VERIFIED 2026-06-09: pg_net v0.20.0 already enabled in extensions schema
-- This migration verifies and documents the setup

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    CREATE EXTENSION "pg_net" WITH SCHEMA extensions;
  END IF;
END $$;

GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
