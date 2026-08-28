-- Disposable PostgreSQL support only. This file runs before restoring a
-- public-schema dump, so it creates only runtime roles that the dump grants to.
-- Schema-specific support is installed after the restore to avoid collisions
-- with schemas and functions emitted by pg_dump.

-- Public schema dumps retain foreign keys and policy/default references to
-- Supabase Auth, but do not include the managed auth schema itself. These
-- inert stubs exist only inside the disposable PostgreSQL container.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  aud text,
  role text,
  email text,
  created_at timestamptz,
  updated_at timestamptz
);
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS updated_at timestamptz;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;

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
  -- Supabase-managed ownership roles are present in a public+storage schema
  -- dump but do not exist in the disposable PostgreSQL image. These inert
  -- roles are only for replaying ownership metadata; they cannot log in.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_user') THEN
    CREATE ROLE dashboard_user NOLOGIN;
  END IF;
END;
$$;

-- Supabase service_role bypasses RLS. The disposable role must preserve that
-- worker authority for contracts that force RLS on service-owned tables.
ALTER ROLE service_role BYPASSRLS;
