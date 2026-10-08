import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// TEST ONLY: restore sanitized schema into a fresh, local PostgreSQL database.
assert.ok(["127.0.0.1", "localhost"].includes(process.env.PGHOST), "local TEST database required");
assert.ok(process.env.PGDATABASE?.startsWith("vinpoker_ops_"), "explicit isolated database required");
const schemaPath = resolve(process.env.SCHEMA_ARTIFACT_DIR, "live-public-schema.sql");
const expected = process.env.SCHEMA_ARTIFACT_SHA256;
assert.match(expected ?? "", /^[a-f0-9]{64}$/);
assert.equal(createHash("sha256").update(readFileSync(schemaPath)).digest("hex"), expected);
function psql(sql) {
  const r = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}
assert.equal(spawnSync("psql", ["-X", "-At", "-c", "SELECT count(*) FROM pg_tables WHERE schemaname='public';"], {encoding:"utf8"}).stdout.trim(), "0", "database must be empty");
  psql(`
    DO $roles$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pgbouncer') THEN CREATE ROLE pgbouncer NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_functions_admin') THEN CREATE ROLE supabase_functions_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_read_only_user') THEN CREATE ROLE supabase_read_only_user NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_replication_admin') THEN CREATE ROLE supabase_replication_admin NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN; END IF;
    END $roles$;
    CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS centerpoint_private;
    CREATE SCHEMA IF NOT EXISTS floor_private;
    CREATE SCHEMA IF NOT EXISTS private;
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $auth$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $auth$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $auth$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.role', true), ''),
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
      )
    $auth$;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $auth$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim', true), ''),
        NULLIF(current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb
    $auth$;
    CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
    CREATE OR REPLACE FUNCTION centerpoint_private.tv_branding_storage_insert_allowed_v1(text,text)
    RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';
  `);

const r = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", schemaPath], {encoding:"utf8"});
if (r.status !== 0) throw new Error(r.stderr);
console.log("SANITIZED_SCHEMA_RESTORED_TO_ISOLATED_TEST_DB");
