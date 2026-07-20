\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (
  name text PRIMARY KEY,
  decrypted_secret text
);

CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  secret text
);

CREATE OR REPLACE FUNCTION vault.create_secret(text, text)
RETURNS uuid
LANGUAGE sql
AS $$ SELECT gen_random_uuid(); $$;

DO $do$
BEGIN
  IF to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL THEN
    EXECUTE $function$
      CREATE FUNCTION vault.create_secret(
        p_secret text,
        p_name text,
        p_description text,
        p_id uuid
      )
      RETURNS uuid
      LANGUAGE plpgsql
      AS $body$
      BEGIN
        INSERT INTO vault.secrets (id, name, secret)
        VALUES (p_id, p_name, p_secret)
        ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret;
        INSERT INTO vault.decrypted_secrets (name, decrypted_secret)
        VALUES (p_name, p_secret)
        ON CONFLICT (name) DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
        RETURN p_id;
      END;
      $body$
    $function$;
  END IF;
END;
$do$;

CREATE OR REPLACE FUNCTION vault.update_secret(uuid, text, text)
RETURNS void
LANGUAGE sql
AS $$ SELECT; $$;

CREATE SCHEMA IF NOT EXISTS net;
CREATE SEQUENCE IF NOT EXISTS net.http_request_id_seq;
CREATE TABLE IF NOT EXISTS net.http_request_log (
  id bigint PRIMARY KEY,
  url text NOT NULL,
  headers jsonb NOT NULL,
  body jsonb NOT NULL,
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
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint := nextval('net.http_request_id_seq');
BEGIN
  INSERT INTO net.http_request_log (
    id, url, headers, body, timeout_milliseconds
  ) VALUES (
    v_id, url, headers, body, timeout_milliseconds
  );
  RETURN v_id;
END;
$$;

GRANT USAGE ON SCHEMA net, vault TO postgres;
GRANT SELECT ON vault.decrypted_secrets TO postgres;
GRANT EXECUTE ON FUNCTION net.http_post(text, jsonb, jsonb, integer) TO postgres;
GRANT USAGE ON SEQUENCE net.http_request_id_seq TO postgres;
GRANT INSERT ON net.http_request_log TO postgres;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text NOT NULL UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION cron.schedule(text, text, text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_jobid bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES ($1, $2, $3)
  ON CONFLICT (jobname) DO UPDATE
  SET schedule = EXCLUDED.schedule,
      command = EXCLUDED.command,
      active = true
  RETURNING jobid INTO v_jobid;
  RETURN v_jobid;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = $1;
  RETURN FOUND;
END;
$$;
