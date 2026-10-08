import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildAtomicMigrationQuery, classifyTarget, loadRelease, normalizedHash } from "./protected-nine-release-gate.mjs";
import { catalogSnapshotSql, compareObjectContract, contractHash, deriveObjectScope } from "./protected-nine-object-contract.mjs";

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

function snapshotWithMutation(mutation, snapshotSql) {
  const result = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: `BEGIN;\n${mutation}\n${snapshotSql}\nROLLBACK;\n`,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim());
}

test("PostgreSQL 17 restores the authenticated baseline and applies the complete exact sequence", { timeout: 180_000 }, () => {
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

  const stageContracts = [];
  for (const [entryIndex, entry] of entries.entries()) {
    assert.equal(classifyTarget(history(), entries, entry.newVersion), "pending");
    assertChecks(entry.postcheck.preflightQueries, `${entry.newVersion} preflight`);
    psql(buildAtomicMigrationQuery(entry));
    assert.equal(classifyTarget(history(), entries, entry.newVersion), "already-applied-exact");
    assertChecks(entry.postcheck.queries, `${entry.newVersion} postcheck`);
    const stageScope = deriveObjectScope(entries.slice(0, entryIndex + 1));
    stageContracts.push({ version: entry.newVersion, contract: JSON.parse(psql(catalogSnapshotSql(stageScope))) });
  }
  assert.equal(psql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version BETWEEN '20270128000001' AND '20270128000010';"), "10");
  const candidate = {
    schemaVersion: 2,
    stages: stageContracts.map((stage) => ({ version: stage.version, scope_sha256: stage.contract.scope_sha256, contract_sha256: contractHash(stage.contract) })),
    finalContract: stageContracts.at(-1).contract,
  };
  if (process.env.PROTECTED_NINE_CONTRACT_OUTPUT) writeFileSync(process.env.PROTECTED_NINE_CONTRACT_OUTPUT, `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 });
  const expected = JSON.parse(readFileSync("scripts/ops/protected-nine-object-contract.json", "utf8"));
  assert.deepEqual(candidate.stages, expected.stages, "per-stage object contract drift");
  const contract = stageContracts.at(-1).contract;
  const expectedContract = expected.finalContract;
  const snapshotSql = catalogSnapshotSql(deriveObjectScope(entries));

  const mutations = [
    {
      name: "extra function grant",
      sql: "GRANT EXECUTE ON FUNCTION public._tracker_voice_assignment_context(uuid,uuid,uuid) TO authenticated;",
      section: /functions/,
    },
    {
      name: "wrong function search_path",
      sql: "ALTER FUNCTION public._tracker_voice_assignment_context(uuid,uuid,uuid) SET search_path=public;",
      section: /functions/,
    },
    {
      name: "function body drift",
      sql: "CREATE OR REPLACE FUNCTION public._tracker_voice_assignment_context(p_tournament_id uuid,p_tournament_table_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $mutated$ SELECT '{}'::jsonb $mutated$;",
      section: /functions/,
    },
    {
      name: "History reparent trigger changed to AFTER",
      sql: "DROP TRIGGER trg_tracker_hand_action_source_revision ON public.hand_actions; CREATE TRIGGER trg_tracker_hand_action_source_revision AFTER INSERT OR UPDATE OR DELETE ON public.hand_actions FOR EACH ROW EXECUTE FUNCTION public.tracker_bump_hand_source_revision();",
      section: /triggers/,
    },
  ];
  for (const mutation of mutations) {
    assert.throws(() => compareObjectContract(snapshotWithMutation(mutation.sql, snapshotSql), expectedContract), mutation.section, mutation.name);
  }
});

test("receipt SQL hash drift is rejected", () => {
  const { control, entries } = loadRelease();
  const rows = control.productionReceipts.map((receipt) => ({ version: receipt.version, name: receipt.semanticName, statements: ["select 'drift';"] }));
  assert.throws(() => classifyTarget(rows, entries, entries[0].newVersion), /predecessor receipt SQL hash drift/);
});
