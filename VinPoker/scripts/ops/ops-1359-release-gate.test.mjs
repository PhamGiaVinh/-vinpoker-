import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildAtomicMigrationQuery, canonicalSqlText, classifyResume, loadAndValidateManifest, resolveWithinRoot, scanMigrationSource, validateManifest } from "./ops-1359-release-gate.mjs";

const root = new URL("../../", import.meta.url);
const { manifest, files } = loadAndValidateManifest(fileURLToPath(root));
const skipped = manifest.migrations.filter((item) => item.action === "SKIP_ALREADY_APPLIED");

test("manifest holds all source checksums and only the exact in-scope paths", () => {
  assert.equal(manifest.migrations.length, 42);
  assert.equal(manifest.migrations.filter((item) => item.action === "APPLY").length, 36);
  assert.equal(skipped.length, 6);
  assert.deepEqual(skipped.map(({ version }) => version), [
    "20270115000006", "20270115000007", "20270115000008",
    "20270115000009", "20270115000010", "20270115000011",
  ]);
  assert.equal(manifest.migrations.find((item) => item.version === "20270115000011").path,
    "supabase/migration-archive/remote-history/recovered-source/20270115000011_cashier_refund_without_floor_clearance.sql");
  for (const item of manifest.migrations) assert.equal(createHash("sha256").update(files.get(item.version)).digest("hex"), item.sha256);
  assert.throws(() => validateManifest({ ...manifest, migrations: manifest.migrations.map((item, i) => i ? item : { ...item, path: "supabase/pending-migrations/99999999999999_outside.sql" }) }));
  assert.throws(() => validateManifest({ ...manifest, migrations: manifest.migrations.map((item, i) => i ? item : { ...item, path: "supabase/migration-archive/remote-history/recovered-source/20270115000011_cashier_refund_without_floor_clearance.sql" }) }));
  assert.throws(() => resolveWithinRoot(fileURLToPath(root), "../outside.sql"), /escaped/);
  assert.throws(() => resolveWithinRoot(fileURLToPath(root), fileURLToPath(new URL("../../../../outside.sql", import.meta.url))), /escaped/);
});

test("SKIP requires the exact live version and name and never gets an apply query", () => {
  const exactRows = skipped.map(({ version, name }) => ({ version, name }));
  for (const [index, item] of skipped.entries()) {
    assert.throws(() => classifyResume(exactRows.filter((row) => row.version !== item.version), manifest), /SKIP entry/);
    assert.throws(() => classifyResume(exactRows.map((row) => row.version === item.version ? { ...row, name: "wrong_name" } : row), manifest), /SKIP entry/);
    assert.throws(() => buildAtomicMigrationQuery(item, "SELECT 1;"));
  }
  const states = classifyResume(exactRows, manifest);
  for (const item of skipped) assert.equal(states.find((state) => state.version === item.version).state, "skipped-exact");
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

test("CRLF and lone-CR SQL canonicalize to the same hash, scan, query, and receipt", () => {
  const item = manifest.migrations.find((entry) => entry.action === "APPLY");
  const lf = "-- canonical fixture\nCREATE TABLE public.line_endings(id integer);\n";
  const crlf = lf.replace(/\n/g, "\r\n");
  const loneCr = lf.replace(/\n/g, "\r");
  const hash = (source) => createHash("sha256").update(canonicalSqlText(source), "utf8").digest("hex");

  assert.equal(hash(crlf), hash(lf));
  assert.equal(hash(loneCr), hash(lf));
  assert.deepEqual(scanMigrationSource(crlf), scanMigrationSource(lf));
  assert.deepEqual(scanMigrationSource(loneCr), scanMigrationSource(lf));
  assert.equal(buildAtomicMigrationQuery(item, crlf), buildAtomicMigrationQuery(item, lf));
  assert.equal(buildAtomicMigrationQuery(item, loneCr), buildAtomicMigrationQuery(item, lf));
  assert.ok(buildAtomicMigrationQuery(item, crlf).includes(`$ops1359_receipt$${lf}$ops1359_receipt$`));
});

test("outer transaction source stays byte-for-byte intact around inserted lock, guard and receipt", () => {
  const item = manifest.migrations.find((entry) => entry.version === "20260924165219");
  const source = canonicalSqlText(readFileSync(new URL(`../../${item.path}`, import.meta.url), "utf8"));
  const query = buildAtomicMigrationQuery(item, source);
  assert.equal(query.startsWith(source.slice(0, source.indexOf("BEGIN;") + "BEGIN;".length)), true);
  assert.ok(query.indexOf("pg_advisory_xact_lock") > query.indexOf("BEGIN;"));
  assert.ok(query.indexOf("INSERT INTO supabase_migrations.schema_migrations") < query.lastIndexOf("COMMIT;"));
  assert.ok(query.endsWith(source.slice(source.lastIndexOf("COMMIT;"))));
});

test("all 36 APPLY sources scan and build one atomic query with the exact receipt source", () => {
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

test("resume permits exact declared skips and rejects applied-name drift and order gaps", () => {
  const skipHistory = skipped.map(({ version, name }) => ({ version, name }));
  const firstApply = manifest.migrations[0];
  const firstPostSkipApply = manifest.migrations.find((item) => item.version === "20260924065041");
  const states = classifyResume([{ version: firstApply.version, name: firstApply.name }, ...skipHistory], manifest);
  assert.equal(states.find((item) => item.version === firstApply.version).state, "already-applied-exact");
  assert.equal(states.find((item) => item.version === firstPostSkipApply.version).state, "pending");
  assert.throws(() => classifyResume([
    { version: firstApply.version, name: "wrong" }, ...skipHistory,
  ], manifest), /conflicts/);
  assert.throws(() => classifyResume([
    { version: firstApply.version, name: firstApply.name }, ...skipHistory,
    { version: manifest.migrations[8].version, name: manifest.migrations[8].name },
  ], manifest), /conflicts/);
});

test("receipt delimiter conflict is rejected", () => {
  const item = manifest.migrations[0];
  assert.throws(() => buildAtomicMigrationQuery(item, "SELECT '$ops1359_receipt$';"), /delimiter/);
});
