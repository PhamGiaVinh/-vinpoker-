import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { evaluatePromotion } from "../../scripts/security/check-floor-v3-migration-promotion.mjs";

const FLOOR = [
  ["20270113000002", "20270113000002_floor.sql", "floor two"],
  ["20270113000003", "20270113000003_floor.sql", "floor three"],
  ["20270113000005", "20270113000005_floor.sql", "floor five"],
  ["20270113000006", "20270113000006_floor.sql", "floor six"],
];
const HELD = [
  ["20270113000000", "20270113000000_payroll.sql", "payroll zero"],
  ["20270113000001", "20270113000001_payroll.sql", "payroll one"],
  ["20270113000004", "20270113000004_payroll_telegram.sql", "payroll telegram"],
];

function hash(source) {
  return createHash("sha256").update(source).digest("hex");
}

function fixture({ extra = [], activeHeld = [], mutateHeld = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-floor-v3-promotion-"));
  const migrations = join(root, "migrations");
  const archive = join(root, "archive");
  mkdirSync(migrations);
  mkdirSync(archive);

  const floorActiveAllowlist = FLOOR.map(([version, filename, source], index) => {
    writeFileSync(join(migrations, filename), source, "utf8");
    return {
      version,
      filename,
      sha256: hash(source),
      dependencies: index === 0 ? [] : [FLOOR[index - 1][0]],
    };
  });
  const heldSources = HELD.map(([originalVersion, filename, source]) => {
    const archiveSource = mutateHeld && originalVersion === HELD[0][0] ? `${source} drift` : source;
    writeFileSync(join(archive, filename), archiveSource, "utf8");
    return {
      originalVersion,
      filename,
      originalPath: `supabase/migrations/${filename}`,
      archivePath: `supabase/migration-archive/never-apply/${filename}`,
      sha256: hash(source),
      domain: filename.includes("telegram") ? "payroll-telegram" : "payroll",
      reason: "fixture held source",
      classification: "MIGRATION_PROMOTION_HELD_UNAPPLIED_PAYROLL",
      replacementStatus: "NOT_YET_CREATED",
      restoreCondition: "separate owner-gated restore",
    };
  });
  for (const [version, filename, source] of activeHeld) writeFileSync(join(migrations, filename), source, "utf8");
  for (const [version, filename, source] of extra) writeFileSync(join(migrations, filename), source, "utf8");

  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, promotion: "floor-v3", floorActiveAllowlist, heldSources }), "utf8");
  return { root, migrations, archive, manifestPath };
}

function runFixture(options, appliedVersions) {
  const paths = fixture(options);
  try {
    return evaluatePromotion({
      migrationDirectory: paths.migrations,
      archiveDirectory: paths.archive,
      manifestPath: paths.manifestPath,
      appliedVersions: new Set(appliedVersions),
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
}

test("allows exactly the four Floor migrations when ledger has no other pending active migration", () => {
  const result = runFixture({}, ["20270101000000"]);
  assert.equal(result.pass, true);
  assert.equal(result.status, "FLOOR_V3_MIGRATION_PROMOTION_SOURCE_READY");
  assert.deepEqual(result.floorPending, FLOOR.map(([version]) => version));
  assert.deepEqual(result.extraPending, []);
});

test("fails closed instead of allowing a superset of Floor migrations", () => {
  const result = runFixture({ extra: [["20270113000007", "20270113000007_unrelated.sql", "unrelated"]] }, [
    ...FLOOR.map(([version]) => version),
  ]);
  assert.equal(result.pass, false);
  assert.equal(result.status, "FLOOR_V3_PROMOTION_BLOCKED_EXTRA_PENDING");
  assert.deepEqual(result.extraPending, ["20270113000007"]);
});

test("fails closed if a held Payroll source is still replayable in the active catalog", () => {
  const result = runFixture({ activeHeld: [HELD[0]] }, [
    ...FLOOR.map(([version]) => version),
    HELD[0][0],
  ]);
  assert.equal(result.pass, false);
  assert.equal(result.status, "PROMOTION_MANIFEST_HASH_DRIFT");
  assert.match(result.failures.join("\n"), /held migration is active/);
});

test("detects archival hash drift before any deployment can be planned", () => {
  const result = runFixture({ mutateHeld: true }, []);
  assert.equal(result.pass, false);
  assert.equal(result.status, "PROMOTION_MANIFEST_HASH_DRIFT");
  assert.match(result.failures.join("\n"), /held migration hash drift/);
});

test("requires every Floor version to be pending for an exact promotion", () => {
  const result = runFixture({}, ["20270113000002", "20270113000003", "20270113000005"]);
  assert.equal(result.pass, false);
  assert.equal(result.status, "FLOOR_V3_PROMOTION_BLOCKED_LEDGER_UNAVAILABLE");
  assert.match(result.failures.join("\n"), /Floor pending set mismatch/);
});
