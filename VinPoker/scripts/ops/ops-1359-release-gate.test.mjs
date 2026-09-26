import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAtomicMigrationQuery, classifyResume, loadAndValidateManifest, scanMigrationSource, validateManifest } from "./ops-1359-release-gate.mjs";

const root = new URL("../../", import.meta.url);
const { manifest, files } = loadAndValidateManifest(fileURLToPath(root));
const skipped = manifest.migrations.find((item) => item.action === "SKIP_ALREADY_APPLIED");

test("manifest holds all source checksums and only the exact in-scope paths", () => {
  assert.equal(manifest.migrations.length, 42);
  assert.equal(manifest.migrations.filter((item) => item.action === "APPLY").length, 41);
  for (const item of manifest.migrations) assert.equal(createHash("sha256").update(files.get(item.version)).digest("hex"), item.sha256);
  assert.throws(() => validateManifest({ ...manifest, migrations: manifest.migrations.map((item, i) => i ? item : { ...item, path: "supabase/pending-migrations/99999999999999_outside.sql" }) }));
});

test("SKIP requires the exact live version and name and never gets an apply query", () => {
  assert.throws(() => classifyResume([], manifest), /SKIP entry/);
  assert.throws(() => classifyResume([{ version: skipped.version, name: "wrong_name" }], manifest), /SKIP entry/);
  const states = classifyResume([{ version: skipped.version, name: skipped.name }], manifest);
  assert.equal(states.find((item) => item.version === skipped.version).state, "skipped-exact");
  assert.throws(() => buildAtomicMigrationQuery(skipped, "SELECT 1;"));
});

test("atomic query locks, checks ledger, executes source unchanged, then writes receipt before commit", () => {
  const item = manifest.migrations.find((entry) => entry.action === "APPLY" && !entry.version.startsWith("202609"));
  const source = "CREATE TABLE public.atomic_fixture(id integer);\n";
  const query = buildAtomicMigrationQuery(item, source);
  assert.match(query, /^BEGIN;/);
  assert.ok(query.indexOf("pg_advisory_xact_lock") < query.indexOf("migration ledger conflict"));
  assert.ok(query.indexOf("migration ledger conflict") < query.indexOf(source));
  assert.ok(query.indexOf(source) < query.indexOf("INSERT INTO supabase_migrations.schema_migrations"));
  assert.match(query, /COMMIT;$/);
  assert.equal(query.includes("CREATE TABLE public.atomic_fixture(id integer);\n"), true);
  assert.throws(() => scanMigrationSource("BEGIN;\nCREATE TABLE x(i int);\nCOMMIT;"), /transaction control/);
  assert.throws(() => scanMigrationSource("\\i secret.sql"), /psql meta command/);
  assert.throws(() => scanMigrationSource("CREATE INDEX CONCURRENTLY x ON t(i);"), /CONCURRENTLY/);
  assert.throws(() => scanMigrationSource("VACUUM;"), /VACUUM/);
  assert.equal(scanMigrationSource("CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;"), true);
});

test("resume permits exact prefix plus the declared skip, rejects name drift and gaps", () => {
  const history = manifest.migrations.slice(0, 8).map(({ version, name }) => ({ version, name }));
  const states = classifyResume(history, manifest);
  assert.equal(states[7].state, "already-applied-exact");
  assert.equal(states[8].state, "pending");
  assert.throws(() => classifyResume([{ version: manifest.migrations[0].version, name: "wrong" }, ...history.slice(1)], manifest), /conflicts/);
  assert.throws(() => classifyResume([history[0], history[2], ...history.slice(3)], manifest), /conflicts/);
});

test("receipt delimiter conflict is rejected", () => {
  const item = manifest.migrations[0];
  assert.throws(() => buildAtomicMigrationQuery(item, "SELECT '$ops1359_receipt$';"), /delimiter/);
});
