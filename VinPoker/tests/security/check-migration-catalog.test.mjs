import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findMigrationCatalogProblems } from "../../scripts/security/check-migration-catalog.mjs";

function withCatalog(files, callback) {
  const root = mkdtempSync(join(tmpdir(), "vinpoker-migration-catalog-"));
  const migrations = join(root, "migrations");
  mkdirSync(migrations);
  try {
    for (const file of files) writeFileSync(join(migrations, file), "-- fixture\n", "utf8");
    callback(migrations);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts unique versioned migrations and ignores non-versioned helpers", () => {
  withCatalog([
    "20270101000000_first.sql",
    "20270101000001_second.sql",
    "_dry_run.sql",
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), []);
  });
});

test("rejects every migration file sharing a version", () => {
  withCatalog([
    "20270101000000_alpha.sql",
    "20270101000000_beta.sql",
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "duplicate migration version 20270101000000: 20270101000000_alpha.sql, 20270101000000_beta.sql",
    ]);
  });
});

test("rejects historical never-apply migrations in the active catalog", () => {
  withCatalog([
    "20270105000002_dealer_pt_wage_global_continuous_accrual.sql",
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "forbidden active migration 20270105000002_dealer_pt_wage_global_continuous_accrual.sql: superseded payroll migration belongs in migration-archive/never-apply",
    ]);
  });
});
