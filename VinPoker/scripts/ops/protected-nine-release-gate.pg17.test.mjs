import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildAtomicMigrationQuery, classifyTarget, loadRelease, normalizedHash } from "./protected-nine-release-gate.mjs";

const artifactDir = process.env.PROTECTED_NINE_SCHEMA_ARTIFACT_DIR;
const schemaPath = artifactDir && resolve(artifactDir, "live-public-schema.sql");
const expectedSchemaSha = "703aed6b620cd24f34c31d4545b2d7e97e4a488f89fe81dfc1a36b175d259223";

function psql(sql) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function psqlFile(path) {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-f", path], { encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function history() {
  return JSON.parse(psql("SELECT COALESCE(json_agg(json_build_object('version',version,'name',name,'statements',statements) ORDER BY version),'[]'::json) FROM supabase_migrations.schema_migrations;"));
}

function assertChecks(queries, label) {
  for (const [index, query] of (queries ?? []).entries()) assert.equal(psql(query), "t", `${label} query ${index + 1}`);
}

test("PostgreSQL 17 restores the authenticated baseline and applies the exact nine migrations", { timeout: 180_000 }, () => {
  assert.ok(schemaPath, "PROTECTED_NINE_SCHEMA_ARTIFACT_DIR is required");
  const schema = readFileSync(schemaPath, "utf8");
  assert.equal(createHash("sha256").update(schema, "utf8").digest("hex"), expectedSchemaSha, "captured baseline checksum drift");
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
    CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
    CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
  `);
  psqlFile(schemaPath);
  psql("CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text NOT NULL,statements text[] NOT NULL);");

  const { control, entries } = loadRelease();
  const prerequisiteSql = {
    "20270115000018": readFileSync("supabase/migrations/20270115000018_dealer_assignment_session_binding.sql", "utf8"),
    "20270115000019": readFileSync("supabase/migrations/20270115000020_tracker_voice_floor_owner_authority.sql", "utf8"),
    "20270115000020": readFileSync("supabase/migrations/20270115000020_tracker_voice_floor_owner_authority.sql", "utf8"),
  };
  for (const receipt of control.productionReceipts) {
    assert.equal(normalizedHash(prerequisiteSql[receipt.version]), receipt.normalizedSqlSha256);
    psql(`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${receipt.version}','${receipt.semanticName}',ARRAY[$receipt$${prerequisiteSql[receipt.version]}$receipt$]::text[]);`);
  }

  for (const entry of entries) {
    assert.equal(classifyTarget(history(), entries, entry.newVersion), "pending");
    assertChecks(entry.postcheck.preflightQueries, `${entry.newVersion} preflight`);
    psql(buildAtomicMigrationQuery(entry));
    assert.equal(classifyTarget(history(), entries, entry.newVersion), "already-applied-exact");
    assertChecks(entry.postcheck.queries, `${entry.newVersion} postcheck`);
  }
  assert.equal(psql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version LIKE '2027012800000%';"), "9");
});

test("receipt SQL hash drift is rejected", () => {
  const { control, entries } = loadRelease();
  const rows = control.productionReceipts.map((receipt) => ({ version: receipt.version, name: receipt.semanticName, statements: ["select 'drift';"] }));
  assert.throws(() => classifyTarget(rows, entries, entries[0].newVersion), /predecessor receipt SQL hash drift/);
});
