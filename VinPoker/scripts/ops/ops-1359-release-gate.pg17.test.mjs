import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildAtomicMigrationQuery,
  classifyResume,
  loadAndValidateManifest,
  resolveWithinRoot,
  scanMigrationSource,
} from "./ops-1359-release-gate.mjs";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const { manifest, files } = loadAndValidateManifest(sourceRoot);
const dbEnv = {
  ...process.env,
  PGHOST: process.env.PGHOST || "127.0.0.1",
  PGPORT: process.env.PGPORT || "5432",
  PGUSER: process.env.PGUSER || "postgres",
  PGDATABASE: process.env.PGDATABASE || "postgres",
  PGPASSWORD: process.env.PGPASSWORD || "",
};

function psql(query) {
  return new Promise((resolve, reject) => {
    const child = spawn("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", query], {
      env: dbEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

function requireSuccess(result, label) {
  assert.equal(result.code, 0, `${label}: ${result.stderr}`);
}

test("PostgreSQL 17 atomic release gate integration", async (t) => {
  const version = "20990101000001";
  const name = "ops_1359_synthetic_atomic_probe";
  const item = { version, name, action: "APPLY" };
  const ledgerSetup = await psql(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL UNIQUE,
      statements text[] NOT NULL
    );
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '${version}' OR name = '${name}';
    DROP TABLE IF EXISTS public.ops_1359_pg17_success_probe;
    DROP TABLE IF EXISTS public.ops_1359_pg17_failure_probe;
  `);
  requireSuccess(ledgerSetup, "create disposable test ledger");
  t.after(async () => {
    const cleanup = await psql(`
      DELETE FROM supabase_migrations.schema_migrations WHERE version = '${version}' OR name = '${name}';
      DROP TABLE IF EXISTS public.ops_1359_pg17_success_probe;
      DROP TABLE IF EXISTS public.ops_1359_pg17_failure_probe;
    `);
    requireSuccess(cleanup, "clean synthetic objects");
  });

  const successSource = "CREATE TABLE public.ops_1359_pg17_success_probe(id integer PRIMARY KEY);";
  const successQuery = buildAtomicMigrationQuery(item, successSource);
  requireSuccess(await psql(successQuery), "atomic success query");
  const successCheck = await psql(`
    SELECT (to_regclass('public.ops_1359_pg17_success_probe') IS NOT NULL)::text || '|' ||
      (SELECT count(*)::text FROM supabase_migrations.schema_migrations WHERE version = '${version}' AND name = '${name}' AND statements = ARRAY[$receipt$${successSource}$receipt$]);
  `);
  requireSuccess(successCheck, "read success object and receipt");
  assert.equal(successCheck.stdout, "true|1", "success must persist both object and exact receipt");

  const resume = classifyResume([{ version, name }], {
    migrations: [{ ...item, path: "supabase/pending-migrations/20990101000001_ops_1359_synthetic_atomic_probe.sql", sha256: "0".repeat(64) }],
  });
  assert.equal(resume[0].state, "already-applied-exact", "exact ledger must resume without replay");
  assert.throws(() => classifyResume([{ version, name: "different_name" }], {
    migrations: [{ ...item, path: "supabase/pending-migrations/20990101000001_ops_1359_synthetic_atomic_probe.sql", sha256: "0".repeat(64) }],
  }), /conflicts/);
  const rerun = await psql(successQuery);
  assert.notEqual(rerun.code, 0, "rerun of an exact applied migration must conflict");
  const singleReceipt = await psql(`SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${version}' AND name = '${name}'`);
  requireSuccess(singleReceipt, "confirm one receipt after rerun");
  assert.equal(singleReceipt.stdout, "1");

  const failVersion = "20990101000002";
  const failItem = { version: failVersion, name: "ops_1359_synthetic_failure_probe", action: "APPLY" };
  const failureQuery = buildAtomicMigrationQuery(failItem,
    "CREATE TABLE public.ops_1359_pg17_failure_probe(id integer); SELECT 1 / 0;");
  const failure = await psql(failureQuery);
  assert.notEqual(failure.code, 0, "deliberate SQL error must fail the query");
  const rollbackCheck = await psql(`
    SELECT (to_regclass('public.ops_1359_pg17_failure_probe') IS NULL)::text || '|' ||
      (SELECT count(*)::text FROM supabase_migrations.schema_migrations WHERE version = '${failVersion}');
  `);
  requireSuccess(rollbackCheck, "check failed transaction rollback");
  assert.equal(rollbackCheck.stdout, "true|0", "failure must roll back both object and receipt");

  const concurrentVersion = "20990101000003";
  const concurrentItem = { version: concurrentVersion, name: "ops_1359_synthetic_concurrent_probe", action: "APPLY" };
  const concurrentQuery = buildAtomicMigrationQuery(concurrentItem,
    "SELECT pg_sleep(0.35); CREATE TABLE public.ops_1359_pg17_concurrent_probe(id integer);");
  const [first, second] = await Promise.all([psql(concurrentQuery), psql(concurrentQuery)]);
  assert.deepEqual([first.code, second.code].sort(), [0, 1], "identical concurrent queries must yield one commit and one conflict");
  const concurrentCheck = await psql(`
    SELECT (to_regclass('public.ops_1359_pg17_concurrent_probe') IS NOT NULL)::text || '|' ||
      (SELECT count(*)::text FROM supabase_migrations.schema_migrations WHERE version = '${concurrentVersion}' AND name = '${concurrentItem.name}');
  `);
  requireSuccess(concurrentCheck, "check concurrent commit");
  assert.equal(concurrentCheck.stdout, "true|1");

  assert.throws(() => buildAtomicMigrationQuery({ ...item, action: "SKIP_ALREADY_APPLIED" }, "CREATE TABLE public.ops_1359_outside_manifest_probe(id int);"), /allowlisted APPLY/);
  assert.throws(() => resolveWithinRoot(sourceRoot, "../outside-manifest.sql"), /escaped/);
  assert.equal(manifest.migrations.filter(({ action }) => action === "APPLY").length, 41);
  for (const migration of manifest.migrations.filter(({ action }) => action === "APPLY")) {
    const source = files.get(migration.version);
    const scan = scanMigrationSource(source);
    assert.ok(["wrapped", "outer-transaction"].includes(scan.mode), migration.version);
    const query = buildAtomicMigrationQuery(migration, source);
    assert.ok(query.includes(`$ops1359_receipt$${source.toString("utf8")}$ops1359_receipt$`), migration.version);
  }
});
