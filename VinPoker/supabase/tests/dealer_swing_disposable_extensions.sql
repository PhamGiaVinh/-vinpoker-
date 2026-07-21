-- Bootstrap only for PostgreSQL disposable-schema validation.
-- Apply this before restoring a public-schema-only dump. It supplies the
-- extension schemas referenced by public definitions without simulating any
-- business work or external HTTP.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT 'authenticated'::text $$;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql
STABLE
AS $$ SELECT string_to_array(name, '/') $$;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (
  name text PRIMARY KEY,
  decrypted_secret text
);
CREATE TABLE IF NOT EXISTS vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigint PRIMARY KEY,
  jobname text NOT NULL,
  schedule text NOT NULL,
  command text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT current_user
);
CREATE TABLE IF NOT EXISTS cron.job_run_details (jobid bigint);
CREATE OR REPLACE FUNCTION cron.unschedule(p_jobname text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = p_jobname;
  RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT COALESCE(MAX(jobid), 0) + 1 INTO v_jobid FROM cron.job;
  INSERT INTO cron.job (jobid, jobname, schedule, command)
  VALUES (v_jobid, p_jobname, p_schedule, p_command)
  ON CONFLICT (jobid) DO UPDATE
  SET jobname = EXCLUDED.jobname,
      schedule = EXCLUDED.schedule,
      command = EXCLUDED.command,
      active = true;
  RETURN v_jobid;
END;
$$;

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._http_response (
  id bigint PRIMARY KEY,
  created timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_code integer,
  timed_out boolean NOT NULL DEFAULT false
);
CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  headers jsonb DEFAULT '{}'::jsonb,
  body jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
AS $$ SELECT 1::bigint $$;
