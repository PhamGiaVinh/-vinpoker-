-- Disposable PostgreSQL support only. This file runs before restoring a
-- public-schema dump, so it creates only runtime roles that the dump grants to.
-- Schema-specific support is installed after the restore to avoid collisions
-- with schemas and functions emitted by pg_dump.

-- Public schema dumps retain foreign keys and policy/default references to
-- Supabase Auth, but do not include the managed auth schema itself. These
-- inert stubs exist only inside the disposable PostgreSQL container.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT NULL::text $$;

-- The public-only dump references the standard trigram operator class, while
-- the extension definition is owned outside that dump.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- These managed extension schemas are omitted by a public-only dump. The
-- lightweight local relations mirror only the columns used by the disposable
-- contract migrations and never connect to their production counterparts.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigint PRIMARY KEY,
  jobname text NOT NULL
);

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._http_response (
  id bigint PRIMARY KEY,
  status_code integer,
  created timestamptz NOT NULL DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (
  name text,
  decrypted_secret text
);

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
