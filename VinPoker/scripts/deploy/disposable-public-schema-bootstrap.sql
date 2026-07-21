-- Disposable PostgreSQL support only. This is not a Supabase migration and must
-- never be applied to a linked or production database. It supplies the minimum
-- extension schemas needed to restore a public-schema dump and exercise the
-- forward Dealer Swing contract migration locally.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE OR REPLACE FUNCTION extensions.digest(data bytea, type text)
RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT public.digest(data, type) $$;

CREATE SCHEMA IF NOT EXISTS net;
CREATE SEQUENCE IF NOT EXISTS net.http_request_log_id_seq;
CREATE TABLE IF NOT EXISTS net.http_request_log (
  id bigint PRIMARY KEY DEFAULT nextval('net.http_request_log_id_seq'),
  url text NOT NULL,
  headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_milliseconds integer NOT NULL,
  created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS net._http_response (
  id bigint PRIMARY KEY,
  status_code integer,
  timed_out boolean NOT NULL DEFAULT false,
  created timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  headers jsonb DEFAULT '{}'::jsonb,
  body jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 1000
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  request_id bigint;
BEGIN
  INSERT INTO net.http_request_log (url, headers, body, timeout_milliseconds)
  VALUES (url, headers, body, timeout_milliseconds)
  RETURNING id INTO request_id;
  RETURN request_id;
END;
$$;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.secrets (
  name text PRIMARY KEY,
  decrypted_secret text NOT NULL
);
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (
  name text PRIMARY KEY,
  decrypted_secret text NOT NULL
);
CREATE OR REPLACE FUNCTION vault.create_secret(
  secret text,
  name text,
  description text,
  project_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO vault.secrets (name, decrypted_secret) VALUES ($2, $1)
  ON CONFLICT ON CONSTRAINT secrets_pkey DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
  INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES ($2, $1)
  ON CONFLICT ON CONSTRAINT decrypted_secrets_pkey DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
  RETURN $4;
END;
$$;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text NOT NULL UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE OR REPLACE FUNCTION cron.unschedule(name text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = name;
  RETURN FOUND;
END;
$$;
CREATE OR REPLACE FUNCTION cron.schedule(name text, schedule text, command text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  scheduled_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command) VALUES (name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command, active = true
  RETURNING jobid INTO scheduled_id;
  RETURN scheduled_id;
END;
$$;
