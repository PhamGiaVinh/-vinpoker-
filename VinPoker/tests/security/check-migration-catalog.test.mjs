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
    for (const file of files) {
      const name = typeof file === "string" ? file : file.name;
      const source = typeof file === "string" ? "-- fixture\n" : file.source;
      writeFileSync(join(migrations, name), source, "utf8");
    }
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

test("rejects the duplicate-version Floor contract in the active catalog", () => {
  withCatalog([
    "20270113000004_floor_table_control_v3_contract_hardening.sql",
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "forbidden active migration 20270113000004_floor_table_control_v3_contract_hardening.sql: duplicate-version Floor contract belongs in migration-archive/never-apply",
    ]);
  });
});

test("rejects a retired credential-bearing scheduler by filename", () => {
  withCatalog([
    "20260428144425_53b3e896-323b-45b5-82e3-921bdaccaa91.sql",
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "forbidden active migration 20260428144425_53b3e896-323b-45b5-82e3-921bdaccaa91.sql: credential-bearing production cron belongs in migration-archive/removed-sensitive",
    ]);
  });
});

test("rejects a retired production-targeted scheduler by filename", () => {
  withCatalog([
    "20260607191236_schedule_run_dealer_ready_backup_cron.sql",
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "forbidden active migration 20260607191236_schedule_run_dealer_ready_backup_cron.sql: production-targeted scheduler belongs in migration-archive/removed-sensitive",
    ]);
  });
});

test("rejects the archived managed Realtime migration by filename", () => {
  withCatalog([
    "20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql",
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "forbidden active migration 20260429060607_237b4d96-a7ca-445d-bfc6-4593e118f887.sql: replay-unsafe managed Realtime DDL belongs in migration-archive/removed-sensitive",
    ]);
  });
});

test("rejects ownership-requiring RLS DDL on a managed Realtime relation", () => {
  withCatalog([
    {
      name: "20270101000004_realtime_messages.sql",
      source: "ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "managed Realtime ownership DDL in active migration 20270101000004_realtime_messages.sql",
    ]);
  });
});

test("rejects FORCE RLS DDL on a managed Realtime relation", () => {
  withCatalog([
    {
      name: "20270101000007_realtime_force_rls.sql",
      source: "ALTER TABLE realtime.messages FORCE ROW LEVEL SECURITY;\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "managed Realtime ownership DDL in active migration 20270101000007_realtime_force_rls.sql",
    ]);
  });
});

test("rejects policy DDL on a managed Realtime relation", () => {
  withCatalog([
    {
      name: "20270101000006_realtime_policy.sql",
      source: "DROP POLICY IF EXISTS \"read messages\" ON realtime.messages;\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "managed Realtime ownership DDL in active migration 20270101000006_realtime_policy.sql",
    ]);
  });
});

test("allows normal public-schema RLS migrations", () => {
  withCatalog([
    {
      name: "20270101000005_public_table.sql",
      source: "ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), []);
  });
});

test("rejects a credential-like JWT literal in active migration SQL", () => {
  const syntheticJwt = `eyJ${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
  withCatalog([
    {
      name: "20270101000002_legacy_auth.sql",
      source: `select '${syntheticJwt}';\n`,
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "credential-like JWT literal in active migration 20270101000002_legacy_auth.sql",
    ]);
  });
});

test("rejects a direct production function target in active migration SQL", () => {
  withCatalog([
    {
      name: "20270101000003_legacy_target.sql",
      source: "select 'https://orlesggcjamwuknxwcpk.supabase.co/functions/v1/example';\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "direct production function target in active migration 20270101000003_legacy_target.sql",
    ]);
  });
});

test("rejects an HTTP side effect in a contained bootstrap migration", () => {
  withCatalog([
    {
      name: "20260516123400_push_notification_dispatch.sql",
      source: "select net.http_post();\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "unsafe HTTP side effect in contained bootstrap migration 20260516123400_push_notification_dispatch.sql",
    ]);
  });
});

test("covers every contained bootstrap migration filename", () => {
  withCatalog([
    {
      name: "20260609000018_notify_dealer_ready_v2.sql",
      source: "select net.http_post();\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "unsafe HTTP side effect in contained bootstrap migration 20260609000018_notify_dealer_ready_v2.sql",
    ]);
  });
});

test("guards scheduler-free payment containment from HTTP regressions", () => {
  withCatalog([
    {
      name: "20261115000000_sepay_reconcile.sql",
      source: "select net.http_post();\n",
    },
  ], (migrations) => {
    assert.deepEqual(findMigrationCatalogProblems(migrations), [
      "unsafe HTTP side effect in contained bootstrap migration 20261115000000_sepay_reconcile.sql",
    ]);
  });
});
