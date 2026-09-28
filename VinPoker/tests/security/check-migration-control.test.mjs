import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalManifestText,
  findMigrationControlProblems,
  normalizedSqlSha256,
} from "../../scripts/security/check-migration-control.mjs";

const sha = (source) => normalizedSqlSha256(source);

function fixture({ reservations = [], receipts = [], rows = [] } = {}) {
  const manifest = {
    schemaVersion: 1,
    kind: "vinpoker-migration-control",
    productionReceipts: receipts,
    reservations,
    protectedApplyOrder: reservations.map((entry) => entry.newVersion).sort(),
    safety: {
      daybreakEnabled: false,
      dbApply: false,
      edgeDeploy: false,
      frontendDeploy: false,
      flagActivation: false,
      ledgerRepair: false,
    },
  };
  return { manifest, rows };
}

function reservation(overrides = {}) {
  return {
    domain: "History",
    oldVersion: "20270115000019",
    newVersion: "20270128000004",
    semanticName: "history_queue",
    filename: "20270128000004_history_queue.sql",
    normalizedSqlSha256: sha("select 1;\n"),
    dependencies: [],
    ownerSession: "S4",
    sourceSha: "d64df388d42b51cb851e8d23361d4fe568988eb7",
    state: "SOURCE_BOUND",
    ...overrides,
  };
}

function row(version, semanticName, source, path = "migrations") {
  return {
    version,
    semanticName,
    filename: `${version}_${semanticName}.sql`,
    path: `${path}/${version}_${semanticName}.sql`,
    normalizedSqlSha256: sha(source),
  };
}

test("accepts same version and same normalized SQL across catalogs", () => {
  const source = "select 1;\n";
  const input = fixture({
    reservations: [reservation()],
    rows: [
      row("20270128000004", "history_queue", source, "migrations"),
      row("20270128000004", "history_queue", source, "pending-migrations"),
    ],
  });
  assert.deepEqual(findMigrationControlProblems(input), []);
});

test("rejects same version with different normalized SQL", () => {
  const input = fixture({
    reservations: [reservation()],
    rows: [
      row("20270128000004", "history_queue", "select 1;\n", "migrations"),
      row("20270128000004", "history_queue", "select 2;\n", "pending-migrations"),
    ],
  });
  assert.ok(findMigrationControlProblems(input).some(
    (problem) => problem.includes("same version has different semantic name or normalized SQL"),
  ));
});

test("normalizes CRLF and lone CR to LF", () => {
  assert.equal(sha("select 1;\r\nselect 2;\r"), sha("select 1;\nselect 2;\n"));
});

test("rejects semantic-name disagreement even when SQL matches", () => {
  const input = fixture({
    reservations: [reservation()],
    rows: [row("20270128000004", "different_name", "select 1;\n")],
  });
  assert.ok(findMigrationControlProblems(input).some(
    (problem) => problem.includes("reserved semantic collision"),
  ));
});

test("rejects a missing dependency", () => {
  const input = fixture({
    reservations: [reservation({ dependencies: ["20270127000099"] })],
    rows: [row("20270128000004", "history_queue", "select 1;\n")],
  });
  assert.ok(findMigrationControlProblems(input).some(
    (problem) => problem === "missing dependency 20270127000099 for 20270128000004",
  ));
});

test("rejects a branch reservation collision", () => {
  const first = reservation();
  const second = reservation({
    semanticName: "voice_fix",
    filename: "20270128000004_voice_fix.sql",
    ownerSession: "S6",
    state: "RESERVED_BRANCH_SOURCE",
  });
  const input = fixture({ reservations: [first, second] });
  assert.ok(findMigrationControlProblems(input).some(
    (problem) => problem.includes("branch reservation collision 20270128000004"),
  ));
});

test("protects the S4 History reparent invalidation reservation and predecessors", () => {
  const foundation = reservation({
    newVersion: "20270128000004",
    semanticName: "tracker_history_completion_queue",
    filename: "20270128000004_tracker_history_completion_queue.sql",
    dependencies: [],
    normalizedSqlSha256: null,
    state: "RESERVED_NO_SQL",
  });
  const audit = reservation({
    newVersion: "20270128000006",
    semanticName: "tracker_history_completion_audit_fixes",
    filename: "20270128000006_tracker_history_completion_audit_fixes.sql",
    dependencies: ["20270128000004"],
    normalizedSqlSha256: null,
    state: "RESERVED_NO_SQL",
  });
  const reparent = reservation({
    oldVersion: null,
    newVersion: "20270128000009",
    semanticName: "tracker_history_reparent_invalidation_v1",
    filename: "20270128000009_tracker_history_reparent_invalidation_v1.sql",
    dependencies: ["20270128000004", "20270128000006"],
    normalizedSqlSha256: null,
    ownerSession: "S4",
    state: "RESERVED_NO_SQL",
  });
  const competingBranch = {
    ...reparent,
    semanticName: "tracker_history_other_semantic_v1",
    filename: "20270128000009_tracker_history_other_semantic_v1.sql",
    ownerSession: "S1",
  };
  const valid = fixture({ reservations: [foundation, audit, reparent] });
  assert.deepEqual(findMigrationControlProblems(valid), []);
  const input = fixture({
    reservations: [foundation, audit, reparent, competingBranch],
    rows: [row("20270128000009", "tracker_history_other_semantic_v1", "select 1;\n")],
  });
  const problems = findMigrationControlProblems(input);
  assert.ok(problems.some(
    (problem) => problem.includes("branch reservation collision 20270128000009"),
  ));
  assert.ok(problems.some(
    (problem) => problem.includes("reserved semantic collision 20270128000009"),
  ));
  assert.ok(problems.some(
    (problem) => problem.includes("protected apply order must list every reservation exactly once"),
  ));
});

test("rejects local SQL that disagrees with an immutable production receipt", () => {
  const source = "select 'voice';\n";
  const input = fixture({
    receipts: [{
      version: "20270115000019",
      semanticName: "voice_authority",
      normalizedSqlSha256: sha(source),
    }],
    rows: [row("20270115000019", "history_queue", source)],
  });
  assert.ok(findMigrationControlProblems(input).some(
    (problem) => problem.includes("production semantic collision 20270115000019"),
  ));
});

test("canonical serialization is deterministic", () => {
  const { manifest, rows } = fixture();
  assert.deepEqual(findMigrationControlProblems({
    manifest,
    rows,
    manifestText: canonicalManifestText(manifest),
  }), []);
  assert.ok(findMigrationControlProblems({
    manifest,
    rows,
    manifestText: JSON.stringify(manifest),
  }).includes("manifest serialization is not deterministic canonical JSON"));
});
