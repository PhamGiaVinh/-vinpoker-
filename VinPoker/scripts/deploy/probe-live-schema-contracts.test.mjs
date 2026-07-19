import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadDeploymentManifest, mergeContracts } from "./deployment-manifest.mjs";
import { buildComponentDiffs, buildDeploymentPlan } from "./plan-edge-deployment.mjs";
import {
  contractsForTargets,
  findMissingContracts,
  schemaInventory,
} from "./probe-live-schema-contracts.mjs";
import { selectTargetContractProfile } from "./target-contract-profile.mjs";
import { inspectTargetSource } from "./verify-target-source.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const manifest = loadDeploymentManifest();
const PRE_922_SHA = "1fdc210d4ae1689091e0ad874c559592b0ecd690";
const CRITICAL_TARGETS = "process-swing,mass-assign,checkout-dealer";

const baseSchema = `
CREATE TABLE public.game_tables (
    id uuid NOT NULL,
    opened_at timestamp with time zone,
    dealer_open_operation_id uuid
);

CREATE TABLE public.dealer_open_operations (
    id uuid NOT NULL
);

CREATE FUNCTION public.is_club_dealer_control(_user_id uuid, _club_id uuid) RETURNS boolean
    LANGUAGE sql
    AS $$ SELECT true $$;

CREATE FUNCTION public.assign_dealer_to_table(
    p_attendance_id uuid,
    p_table_id uuid,
    p_assigned_at timestamp with time zone DEFAULT now(),
    p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
    LANGUAGE sql
    AS $$ SELECT '{}'::jsonb $$;
`;

function contractKey(contract) {
  if (contract.type === "relation") return contract.name;
  if (contract.type === "column") return `${contract.relation}.${contract.name}`;
  if (contract.type === "function") return contract.name;
  return JSON.stringify(contract);
}

function schemaForContracts(contracts, { omit = new Set() } = {}) {
  const selected = contracts.filter((contract) => !omit.has(contractKey(contract)));
  const relations = new Map();
  for (const contract of selected) {
    if (contract.type === "relation") relations.set(contract.name, new Set(["id"]));
    if (contract.type === "column") {
      const columns = relations.get(contract.relation) ?? new Set(["id"]);
      columns.add(contract.name);
      relations.set(contract.relation, columns);
    }
  }

  const lines = [];
  for (const [relation, columns] of [...relations.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const body = [...columns].map((column) => `  ${column} uuid`).join(",\n");
    lines.push(`CREATE TABLE ${relation} (\n${body}\n);`);
  }

  for (const contract of selected.filter((item) => item.type === "function")) {
    const names = contract.arguments ?? [];
    const types = contract.argumentTypes ?? names.map(() => "uuid");
    const args = names.map((name, index) => `${name} ${types[index] ?? "uuid"}`).join(", ");
    const signature = types.join(", ");
    lines.push(`CREATE FUNCTION ${contract.name}(${args}) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`);
    if (contract.acl) {
      lines.push(`REVOKE EXECUTE ON FUNCTION ${contract.name}(${signature}) FROM PUBLIC, anon, authenticated, service_role;`);
      for (const [role, allowed] of Object.entries(contract.acl)) {
        if (allowed) lines.push(`GRANT EXECUTE ON FUNCTION ${contract.name}(${signature}) TO ${role};`);
      }
    }
  }
  return `${lines.join("\n\n")}\n`;
}

function extractRevision(sha) {
  const root = mkdtempSync(join(tmpdir(), "dealer-contract-probe-"));
  const targetRoot = join(root, "target");
  const archive = join(root, "target.tar");
  mkdirSync(targetRoot);
  execFileSync("git", ["-C", repositoryRoot, "archive", "--format=tar", `--output=${archive}`, sha]);
  execFileSync("tar", ["-xf", archive, "-C", targetRoot]);
  return { root, targetRoot };
}

function allContracts(targetRoot) {
  const edge = contractsForTargets({ manifest, rawTargets: CRITICAL_TARGETS, targetRoot });
  const frontend = contractsForTargets({ manifest, rawTargets: "frontend", targetRoot });
  assert.equal(edge.selection.profile, frontend.selection.profile);
  assert.equal(edge.selection.sourceFingerprint, frontend.selection.sourceFingerprint);
  return { selection: edge.selection, contracts: mergeContracts(edge.contracts, frontend.contracts) };
}

test("schema inventory extracts relation, typed signature and argument names", () => {
  const inventory = schemaInventory(baseSchema);
  assert.equal(inventory.relations.has("public.game_tables"), true);
  assert.equal(inventory.relationBodies.get("public.game_tables").includes("opened_at"), true);
  assert.deepEqual(inventory.functions.get("public.is_club_dealer_control"), [{
    argumentNames: ["_user_id", "_club_id"],
    argumentTypes: ["uuid", "uuid"],
    key: "public.is_club_dealer_control(uuid,uuid)",
  }]);
});

test("probe accepts matching typed contracts", () => {
  const missing = findMissingContracts(baseSchema, [
    { type: "relation", name: "public.game_tables" },
    { type: "column", relation: "public.game_tables", name: "opened_at" },
    {
      type: "function",
      name: "public.assign_dealer_to_table",
      arguments: ["p_attendance_id", "p_table_id", "p_assigned_at", "p_swing_due_at"],
    },
  ]);
  assert.deepEqual(missing, []);
});

test("probe reports a missing column and signature without converting them to success", () => {
  const missing = findMissingContracts(baseSchema, [
    { type: "column", relation: "public.game_tables", name: "missing_column" },
    { type: "function", name: "public.is_club_dealer_control", arguments: ["_club_id"] },
  ]);
  assert.deepEqual(missing, [
    "column:public.game_tables.missing_column",
    "function:public.is_club_dealer_control(_club_id)",
  ]);
});

test("operation ACL requires authenticated access, anon denial, service helper access and no overload ambiguity", () => {
  const operationContracts = [
    {
      type: "function",
      name: "public.get_dealer_mass_open_rollout",
      arguments: ["p_expected_club_id"],
      argumentTypes: ["uuid"],
      allowOtherOverloads: false,
      acl: { authenticated: true, anon: false, service_role: true },
    },
    {
      type: "function",
      name: "public._refresh_dealer_open_operation",
      arguments: ["p_operation_id"],
      argumentTypes: ["uuid"],
      allowOtherOverloads: false,
      acl: { authenticated: false, anon: false, service_role: true },
    },
  ];
  const validSchema = schemaForContracts(operationContracts);
  assert.deepEqual(findMissingContracts(validSchema, operationContracts), []);

  const publicExecuteSchema = validSchema.replace(
    "REVOKE EXECUTE ON FUNCTION public.get_dealer_mass_open_rollout(uuid) FROM PUBLIC, anon, authenticated, service_role;",
    "GRANT EXECUTE ON FUNCTION public.get_dealer_mass_open_rollout(uuid) TO PUBLIC;",
  );
  assert.equal(
    findMissingContracts(publicExecuteSchema, operationContracts)
      .includes("acl:public.get_dealer_mass_open_rollout(uuid):anon:expected_deny"),
    true,
  );

  const ambiguousSchema = `${validSchema}\nCREATE FUNCTION public.get_dealer_mass_open_rollout(p_club text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;`;
  assert.equal(
    findMissingContracts(ambiguousSchema, operationContracts)
      .includes("overload:public.get_dealer_mass_open_rollout:expected_exactly_one_found_2"),
    true,
  );
});

test("current target fails without operation objects and passes with the full mass-open-v1 contract", () => {
  const current = allContracts(repositoryRoot);
  assert.equal(current.selection.profile, "dealer_mass_open_v1");
  const omitted = new Set([
    "public.dealer_mass_open_rollout",
    "public.dealer_open_operations",
    "public.dealer_open_operation_targets",
    "public.game_tables.opened_at",
    "public.game_tables.dealer_open_operation_id",
    "public.get_dealer_mass_open_rollout",
    "public.get_dealer_open_operation",
    "public.operator_open_dealer_tables",
    "public._refresh_dealer_open_operation",
  ]);
  const missing = findMissingContracts(schemaForContracts(current.contracts, { omit: omitted }), current.contracts);
  assert.equal(missing.includes("relation:public.dealer_open_operations"), true);
  assert.equal(missing.includes("relation:public.dealer_open_operation_targets"), true);
  assert.equal(missing.includes("column:public.game_tables.dealer_open_operation_id"), true);
  assert.equal(missing.some((item) => item.startsWith("function:public.operator_open_dealer_tables")), true);
  assert.deepEqual(findMissingContracts(schemaForContracts(current.contracts), current.contracts), []);
});

test("pre-922 rollback source passes without operation objects and fails when a real legacy dependency is missing", () => {
  const extracted = extractRevision(PRE_922_SHA);
  try {
    const legacy = allContracts(extracted.targetRoot);
    assert.equal(legacy.selection.profile, "dealer_swing_legacy");
    const legacySchema = schemaForContracts(legacy.contracts);
    assert.doesNotMatch(legacySchema, /dealer_open_operations|dealer_open_operation_targets|dealer_mass_open_rollout/);
    assert.deepEqual(findMissingContracts(legacySchema, legacy.contracts), []);

    const missingAttendance = findMissingContracts(
      schemaForContracts(legacy.contracts, { omit: new Set(["public.dealer_attendance"]) }),
      legacy.contracts,
    );
    assert.equal(missingAttendance.includes("relation:public.dealer_attendance"), true);
  } finally {
    rmSync(extracted.root, { recursive: true, force: true });
  }
});

test("pre-922 rollback runs planning, source quality and target-aware contract probe end to end", () => {
  const extracted = extractRevision(PRE_922_SHA);
  try {
    const selection = selectTargetContractProfile({ targetRoot: extracted.targetRoot });
    const quality = inspectTargetSource({
      targetRoot: extracted.targetRoot,
      targets: CRITICAL_TARGETS.split(","),
      manifest,
    });
    assert.deepEqual(Object.keys(quality.functions).sort(), ["checkout-dealer", "mass-assign", "process-swing"]);

    const currentMain = execFileSync("git", ["-C", repositoryRoot, "rev-parse", "origin/main"], { encoding: "utf8" }).trim();
    const baselines = {
      frontend: { sha: currentMain, source: "github_deployment_receipt" },
      functions: Object.fromEntries(Object.keys(manifest.functions).map((name) => [name, {
        sha: currentMain,
        source: "github_deployment_receipt",
      }])),
    };
    const componentDiffs = buildComponentDiffs({
      repositoryRoot,
      targetSha: PRE_922_SHA,
      baselines,
      manifest,
    });
    const plan = buildDeploymentPlan({
      event: "workflow_dispatch",
      componentDiffs,
      selected: CRITICAL_TARGETS.split(","),
      deployFrontend: true,
      manifest,
      targetSha: PRE_922_SHA,
      contractSelection: selection,
    });
    assert.equal(plan.contractProfile, "dealer_swing_legacy");

    const contracts = allContracts(extracted.targetRoot).contracts;
    assert.deepEqual(findMissingContracts(schemaForContracts(contracts), contracts), []);
  } finally {
    rmSync(extracted.root, { recursive: true, force: true });
  }
});
