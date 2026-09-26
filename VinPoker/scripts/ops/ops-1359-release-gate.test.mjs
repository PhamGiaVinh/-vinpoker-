import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAtomicMigrationQuery, classifyResume, loadAndValidateManifest, resolveWithinRoot, scanMigrationSource, validateManifest } from "./ops-1359-release-gate.mjs";

const root = new URL("../../", import.meta.url);
const { manifest, files } = loadAndValidateManifest(fileURLToPath(root));
const skipped = manifest.migrations.find((item) => item.action === "SKIP_ALREADY_APPLIED");

test("manifest holds all source checksums and only the exact in-scope paths", () => {
  assert.equal(manifest.migrations.length, 42);
  assert.equal(manifest.migrations.filter((item) => item.action === "APPLY").length, 41);
  for (const item of manifest.migrations) assert.equal(createHash("sha256").update(files.get(item.version)).digest("hex"), item.sha256);
  assert.throws(() => validateManifest({ ...manifest, migrations: manifest.migrations.map((item, i) => i ? item : { ...item, path: "supabase/pending-migrations/99999999999999_outside.sql" }) }));
  assert.throws(() => resolveWithinRoot(fileURLToPath(root), "../outside.sql"), /escaped/);
  assert.throws(() => resolveWithinRoot(fileURLToPath(root), fileURLToPath(new URL("../../../../outside.sql", import.meta.url))), /escaped/);
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
  const wrapped = "-- leading comment\nBEGIN;\nCREATE TABLE x(i int);\nCOMMIT; -- trailing comment";
  const scan = scanMigrationSource(wrapped);
  assert.equal(scan.mode, "outer-transaction");
  assert.equal(wrapped.slice(0, scan.insertAfterBegin).trimEnd(), "-- leading comment\nBEGIN;");
  assert.equal(wrapped.slice(scan.insertBeforeCommit).startsWith("COMMIT;"), true);
  assert.throws(() => scanMigrationSource("BEGIN; CREATE TABLE x(i int); COMMIT; COMMIT;"), /transaction control/);
  assert.throws(() => scanMigrationSource("BEGIN; SAVEPOINT s; COMMIT;"), /transaction control/);
  assert.throws(() => scanMigrationSource("COMMIT;"), /transaction control/);
  assert.throws(() => scanMigrationSource("\\i secret.sql"), /psql meta command/);
  assert.throws(() => scanMigrationSource("CREATE INDEX CONCURRENTLY x ON t(i);"), /CONCURRENTLY/);
  assert.throws(() => scanMigrationSource("VACUUM;"), /VACUUM/);
  assert.deepEqual(scanMigrationSource("CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 'COMMIT;'; END $$;"), { mode: "wrapped" });
  assert.deepEqual(scanMigrationSource("/* BEGIN; /* COMMIT; */ */ SELECT 'BEGIN;', \"COMMIT\";"), { mode: "wrapped" });
});

test("outer transaction source stays byte-for-byte intact around inserted lock, guard and receipt", () => {
  const item = manifest.migrations.find((entry) => entry.version === "20260924165219");
  const source = readFileSync(new URL(`../../${item.path}`, import.meta.url), "utf8");
  const query = buildAtomicMigrationQuery(item, source);
  assert.equal(query.startsWith(source.slice(0, source.indexOf("BEGIN;") + "BEGIN;".length)), true);
  assert.ok(query.indexOf("pg_advisory_xact_lock") > query.indexOf("BEGIN;"));
  assert.ok(query.indexOf("INSERT INTO supabase_migrations.schema_migrations") < query.lastIndexOf("COMMIT;"));
  assert.ok(query.endsWith(source.slice(source.lastIndexOf("COMMIT;"))));
});

test("all 41 APPLY sources scan and build one atomic query with the exact receipt source", () => {
  for (const item of manifest.migrations.filter((entry) => entry.action === "APPLY")) {
    const source = files.get(item.version).toString("utf8");
    const scan = scanMigrationSource(source);
    assert.ok(["wrapped", "outer-transaction"].includes(scan.mode), item.version);
    const query = buildAtomicMigrationQuery(item, source);
    assert.ok(query.includes(`$ops1359_receipt$${source}$ops1359_receipt$`), item.version);
    assert.match(query, /pg_advisory_xact_lock\(1359, 1\)/, item.version);
    assert.match(query, /INSERT INTO supabase_migrations\.schema_migrations/, item.version);
    assert.match(query, /COMMIT;\s*$/, item.version);
  }
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
