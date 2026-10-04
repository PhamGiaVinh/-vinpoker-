import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSqlText, scanMigrationSource } from "./ops-1359-release-gate.mjs";
import { catalogSnapshotSql, contractHash, deriveObjectScope } from "./protected-nine-object-contract.mjs";

export const PROJECT_REF = "orlesggcjamwuknxwcpk";
export const ORDER = Array.from({ length: 10 }, (_, index) => `202701280000${String(index + 1).padStart(2, "0")}`);
export const CONFIRM_PREFIX = "APPLY_PROTECTED_NINE";
export const OBJECT_CONTRACT_SHA256 = "20d227469425cf66f55530721e777f733d28a4af60d2cf46b055388507d50bdc";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RECEIPT_TAG = "$protected_nine_receipt$";

export function normalizedHash(source) {
  return createHash("sha256").update(canonicalSqlText(source), "utf8").digest("hex");
}

export function verifyObjectContractSource(source) {
  if (createHash("sha256").update(source, "utf8").digest("hex") !== OBJECT_CONTRACT_SHA256) throw new Error("Protected-nine object contract hash drift");
}

export function loadRelease(root = ROOT) {
  const control = JSON.parse(readFileSync(resolve(root, "supabase/migration-control/manifest.json"), "utf8"));
  const postchecks = JSON.parse(readFileSync(resolve(root, "scripts/ops/protected-nine-postchecks.json"), "utf8"));
  const objectContractSource = readFileSync(resolve(root, "scripts/ops/protected-nine-object-contract.json"), "utf8");
  verifyObjectContractSource(objectContractSource);
  const objectContract = JSON.parse(objectContractSource);
  if (objectContract.schemaVersion !== 2 || objectContract.stages?.map((stage) => stage.version).join(",") !== ORDER.join(",")) throw new Error("Protected-nine per-stage object contract mismatch");
  if (control.kind !== "vinpoker-migration-control" || control.protectedApplyOrder?.join(",") !== ORDER.join(",")) throw new Error("Protected order is not the exact release reservation order");
  if (Object.values(control.safety ?? {}).some((value) => value !== false)) throw new Error("Production safety gates must remain OFF");
  const entries = ORDER.map((version) => {
    const reservation = control.reservations?.find((item) => item.newVersion === version);
    if (!reservation || reservation.state !== "SOURCE_BOUND") throw new Error(`Missing source-bound reservation ${version}`);
    const path = resolve(root, "supabase/migrations", reservation.filename);
    const sql = readFileSync(path, "utf8");
    if (normalizedHash(sql) !== reservation.normalizedSqlSha256) throw new Error(`Normalized SQL drift ${version}`);
    scanMigrationSource(sql);
    const postcheck = postchecks.entries?.find((item) => item.version === version);
    if (!postcheck || postcheck.filename !== reservation.filename || !Array.isArray(postcheck.queries) || postcheck.queries.length === 0) throw new Error(`Missing exact postcheck ${version}`);
    const requiredVersions = [...new Set(reservation.dependencies ?? [])];
    const requiredReceipts = requiredVersions.map((version) => {
      const receipt = control.productionReceipts?.find((candidate) => candidate.version === version);
      return { version, semanticName: receipt?.semanticName ?? null, normalizedSqlSha256: receipt?.normalizedSqlSha256 ?? null };
    });
    return { ...reservation, name: reservation.semanticName, path, sql, postcheck, requiredReceipts };
  });
  if (postchecks.projectRef !== PROJECT_REF || postchecks.entries?.map((item) => item.version).join(",") !== ORDER.join(",")) throw new Error("Postcheck manifest identity/order mismatch");
  return { control, entries, postchecks, objectContract };
}

export function classifyTarget(history, entries, targetVersion) {
  if (!ORDER.includes(targetVersion)) throw new Error("Target is outside protected release order");
  const rows = new Map();
  for (const row of history) {
    const version = String(row.version);
    if (rows.has(version)) throw new Error(`Ambiguous live receipt ${version}`);
    if (!Array.isArray(row.statements) || row.statements.length !== 1 || typeof row.statements[0] !== "string") throw new Error(`Malformed live receipt ${version}`);
    rows.set(version, { name: String(row.name), hash: normalizedHash(row.statements[0]) });
  }
  for (const entry of entries) {
    const receipt = rows.get(entry.newVersion);
    if (receipt && receipt.name !== entry.semanticName) throw new Error(`Live receipt name drift ${entry.newVersion}`);
    if (receipt && receipt.hash !== entry.normalizedSqlSha256) throw new Error(`Live receipt SQL hash drift ${entry.newVersion}`);
  }
  const targetIndex = ORDER.indexOf(targetVersion);
  for (let index = 0; index < targetIndex; index += 1) if (!rows.has(ORDER[index])) throw new Error(`Earlier protected migration is not applied ${ORDER[index]}`);
  for (let index = targetIndex + 1; index < ORDER.length; index += 1) if (rows.has(ORDER[index])) throw new Error(`Later protected migration is already present ${ORDER[index]}`);
  if (rows.has(targetVersion)) return "already-applied-exact";
  for (const dependency of entries[targetIndex].requiredReceipts ?? []) {
    if (!rows.has(dependency.version)) throw new Error(`Required predecessor receipt missing ${dependency.version}`);
    if (dependency.semanticName && rows.get(dependency.version).name !== dependency.semanticName) throw new Error(`Required predecessor receipt name drift ${dependency.version}`);
    if (dependency.normalizedSqlSha256 && rows.get(dependency.version).hash !== dependency.normalizedSqlSha256) throw new Error(`Required predecessor receipt SQL hash drift ${dependency.version}`);
  }
  return "pending";
}

export function validateInvocation(env, entry, mode) {
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Wrong project reference");
  if (env.TARGET_MIGRATION !== entry.filename) throw new Error("Wrong exact migration filename");
  if (env.TARGET_NORMALIZED_SHA256 !== entry.normalizedSqlSha256) throw new Error("Wrong exact normalized migration hash");
  if (mode === "apply" && env.CONFIRM_PROTECTED_NINE !== `${CONFIRM_PREFIX}_${entry.newVersion}_${entry.normalizedSqlSha256}`) throw new Error("Exact apply confirmation is missing");
}

export function buildAtomicMigrationQuery(entry) {
  const scan = scanMigrationSource(entry.sql);
  if (entry.sql.includes(RECEIPT_TAG)) throw new Error("Migration conflicts with receipt delimiter");
  const guard = `SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '120s';\nSELECT pg_advisory_xact_lock(280000, 9);\nDO $protected_nine_guard$ BEGIN IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${entry.newVersion}' OR name = '${entry.semanticName}') THEN RAISE EXCEPTION 'migration ledger conflict'; END IF; END $protected_nine_guard$;\n`;
  const receipt = `\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${entry.newVersion}','${entry.semanticName}',ARRAY[${RECEIPT_TAG}${canonicalSqlText(entry.sql)}${RECEIPT_TAG}]::text[]);\n`;
  if (scan.mode === "outer-transaction") return `${entry.sql.slice(0, scan.insertAfterBegin)}\n${guard}${entry.sql.slice(scan.insertAfterBegin, scan.insertBeforeCommit)}${receipt}${entry.sql.slice(scan.insertBeforeCommit)}`;
  return `BEGIN;\n${guard}${entry.sql}\n${receipt}COMMIT;`;
}

async function request(path, token, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(path === "/database/query" ? 150_000 : 30_000) });
  if (!response.ok) throw new Error(`Supabase Management API returned ${response.status}`);
  return response.json();
}

async function verifyLiveObjectContract(entries, objectContract, stageIndex, token) {
  const expectedStage = objectContract.stages[stageIndex];
  const catalogResult = await request("/database/query", token, {
    method: "POST",
    body: JSON.stringify({ query: catalogSnapshotSql(deriveObjectScope(entries.slice(0, stageIndex + 1))) }),
  });
  const rawContract = catalogResult?.[0]?.contract;
  const liveContract = typeof rawContract === "string" ? JSON.parse(rawContract) : rawContract;
  if (!liveContract || liveContract.scope_sha256 !== expectedStage.scope_sha256 || contractHash(liveContract) !== expectedStage.contract_sha256) {
    throw new Error(`Object contract postcheck failed ${expectedStage.version}`);
  }
}

async function execute() {
  const mode = process.argv[2];
  if (!new Set(["plan", "apply", "postcheck"]).has(mode)) throw new Error("Usage: protected-nine-release-gate.mjs plan|apply|postcheck");
  const { entries, objectContract } = loadRelease();
  const entry = entries.find((item) => item.filename === process.env.TARGET_MIGRATION);
  if (!entry) throw new Error("Target migration filename is not allowlisted");
  validateInvocation(process.env, entry, mode);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("Approved Supabase credential context is unavailable");
  const history = await request("/database/query", token, { method: "POST", body: JSON.stringify({ query: "SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version" }) });
  const state = classifyTarget(history, entries, entry.newVersion);
  const entryIndex = entries.findIndex((candidate) => candidate.newVersion === entry.newVersion);
  if ((mode === "plan" || mode === "apply") && state === "pending" && entryIndex > 0) {
    await verifyLiveObjectContract(entries, objectContract, entryIndex - 1, token);
  }
  for (const query of entry.postcheck.preflightQueries ?? []) {
    const result = await request("/database/query", token, { method: "POST", body: JSON.stringify({ query }) });
    if (!Array.isArray(result) || result.length !== 1 || result[0]?.ok !== true) throw new Error(`Preflight failed ${entry.newVersion}`);
  }
  if (mode === "apply") {
    if (state !== "pending") throw new Error(`Target is not pending: ${state}`);
    const result = await request("/database/query", token, { method: "POST", body: JSON.stringify({ query: buildAtomicMigrationQuery(entry) }) });
    if (result === null) throw new Error("Apply acknowledgement was empty");
  }
  if (mode === "postcheck") {
    if (state !== "already-applied-exact") throw new Error("Exact receipt is not present");
    for (const query of entry.postcheck.queries) {
      const result = await request("/database/query", token, { method: "POST", body: JSON.stringify({ query }) });
      if (!Array.isArray(result) || result.length !== 1 || result[0]?.ok !== true) throw new Error(`Postcheck failed ${entry.newVersion}`);
    }
    await verifyLiveObjectContract(entries, objectContract, entryIndex, token);
  }
  console.log(`PROTECTED_NINE_${mode.toUpperCase()}=${entry.newVersion}:${state}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) execute().catch((error) => { console.error(`PROTECTED_NINE_FAIL: ${error.message}`); process.exitCode = 1; });
