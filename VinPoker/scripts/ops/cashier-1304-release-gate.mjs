import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF = "orlesggcjamwuknxwcpk";
const VERSION = "20270115000011";
const NAME = "cashier_refund_without_floor_clearance";
const MIGRATION_PATH = "supabase/migration-archive/remote-history/recovered-source/20270115000011_cashier_refund_without_floor_clearance.sql";
const EXPECTED_SHA256 = "b8703796f21706f13c0a2190436172bd167186d6242695f0c4829fe4a857e101";
const PRIOR_MD5 = "b3c619f7cfb4c28580a4beada0c273e8";
const SOURCE_TAG = "$cashier_1304_migration_source$";
const REQUIRED_HISTORY = new Map([
  ["20270115000003", "cashier_tour_money_v1"],
  ["20270115000004", "floor_free_sit_v1"],
  ["20270115000005", "tracker_dealer_floor_operational_alerts"],
]);
const FORBIDDEN_VERSIONS = new Set([
  "20270115000006",
  "20270115000007",
  "20270115000008",
  "20270115000009",
  "20270115000010",
]);

const STATE_SQL = `
SELECT
  md5(pg_get_functiondef(to_regprocedure(
    'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)'
  ))) AS function_md5,
  has_function_privilege('anon',
    'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)', 'execute') AS anon_execute,
  has_function_privilege('authenticated',
    'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)', 'execute') AS authenticated_execute,
  coalesce((SELECT proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc WHERE oid=to_regprocedure(
      'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)')), false) AS search_path_guard,
  position('verified_payment_history_required' IN pg_get_functiondef(to_regprocedure(
    'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)'))) > 0 AS verified_payment_guard,
  position('v_reg.cashier_seating_error IS NOT NULL' IN pg_get_functiondef(to_regprocedure(
    'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)'))) > 0 AS waiting_state_guard,
  position('floor_clearance_required' IN pg_get_functiondef(to_regprocedure(
    'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)'))) > 0 AS floor_guard,
  position('active_seat_or_chips' IN pg_get_functiondef(to_regprocedure(
    'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)'))) > 0 AS active_seat_guard,
  (SELECT count(*) FROM public.cashier_refund_requests) AS refund_count,
  (SELECT count(*) FROM public.cashier_buyin_movements) AS movement_count,
  (SELECT count(*) FROM public.tournament_registrations) AS registration_count,
  (SELECT count(*) FROM public.tournament_entries) AS entry_count,
  (SELECT count(*) FROM public.seat_draw_receipts) AS receipt_count;
`;

function firstRow(payload) {
  if (!Array.isArray(payload) || payload.length !== 1 || typeof payload[0] !== "object") {
    throw new Error("Read-only database response has an unexpected shape");
  }
  return payload[0];
}

async function request(path, token, options = {}) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Supabase Management API request failed");
  }
  if (!response.ok) throw new Error(`Supabase Management API returned ${response.status}`);
  return response.json();
}

async function readLive(token) {
  const [history, statePayload] = await Promise.all([
    request("/database/migrations", token),
    request("/database/query/read-only", token, {
      method: "POST",
      body: JSON.stringify({ query: STATE_SQL }),
    }),
  ]);
  if (!Array.isArray(history)) throw new Error("Migration history response is invalid");
  return {
    history: history.map((entry) => ({ version: String(entry.version), name: String(entry.name) })),
    state: firstRow(statePayload),
  };
}

export function buildAtomicMigrationQuery(source) {
  if (source.includes(SOURCE_TAG)) throw new Error("Migration source conflicts with ledger delimiter");
  return `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
${source}
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES ('${VERSION}', '${NAME}', ARRAY[${SOURCE_TAG}${source}${SOURCE_TAG}]::text[]);
COMMIT;`;
}

function assertOperationalCountsUnchanged(before, after) {
  for (const field of ["refund_count", "movement_count", "registration_count", "entry_count", "receipt_count"]) {
    if (String(before[field]) !== String(after[field])) {
      throw new Error(`Operational row count changed during migration: ${field}`);
    }
  }
}

async function applyAtomic(token, migration) {
  const before = await readLive(token);
  if (classify(before.history, before.state, "preflight") !== "apply") {
    throw new Error("Live state no longer permits migration apply");
  }
  await request("/database/query", token, {
    method: "POST",
    body: JSON.stringify({ query: buildAtomicMigrationQuery(migration.toString("utf8")) }),
  });
  const after = await readLive(token);
  classify(after.history, after.state, "postcheck");
  assertOperationalCountsUnchanged(before.state, after.state);
  return after;
}

export function classify(history, state, mode) {
  const byVersion = new Map(history.map((entry) => [entry.version, entry.name]));
  for (const [version, name] of REQUIRED_HISTORY) {
    if (byVersion.get(version) !== name) throw new Error(`Required live migration ${version} drifted`);
  }
  for (const version of FORBIDDEN_VERSIONS) {
    if (byVersion.has(version)) throw new Error(`Forbidden migration ${version} is applied`);
  }
  const migration11 = history.filter((entry) => entry.version === VERSION);
  if (migration11.length > 1 || (migration11.length === 1 && migration11[0].name !== NAME)) {
    throw new Error("Migration 11 ledger entry is ambiguous or mismatched");
  }
  if (mode === "preflight") {
    if (migration11.length === 0) {
      if (state.function_md5 !== PRIOR_MD5) throw new Error("Live refund function drifted before apply");
      if (state.anon_execute !== false || state.authenticated_execute !== true) {
        throw new Error("Live refund function ACL drifted before apply");
      }
      return "apply";
    }
    return "postcheck";
  }
  if (migration11.length !== 1) throw new Error("Migration 11 is absent after apply");
  for (const guard of ["search_path_guard", "verified_payment_guard", "waiting_state_guard", "floor_guard", "active_seat_guard"]) {
    if (state[guard] !== true) throw new Error(`Post-apply function guard failed: ${guard}`);
  }
  if (state.anon_execute !== false || state.authenticated_execute !== true) {
    throw new Error("Post-apply refund function ACL is invalid");
  }
  return "complete";
}

async function main() {
  const mode = process.argv[2];
  const outputPath = process.argv[3];
  if (!new Set(["preflight", "apply", "postcheck"]).has(mode) || !outputPath) {
    throw new Error("Usage: cashier-1304-release-gate.mjs preflight|apply|postcheck <output-json>");
  }
  if (process.env.SUPABASE_PROJECT_REF !== PROJECT_REF || !process.env.SUPABASE_ACCESS_TOKEN) {
    throw new Error("Approved Supabase credential context is unavailable");
  }
  const sourceRoot = resolve(import.meta.dirname, "../..");
  const migration = readFileSync(resolve(sourceRoot, MIGRATION_PATH));
  const sourceSha = createHash("sha256").update(migration).digest("hex");
  if (sourceSha !== EXPECTED_SHA256) throw new Error("Migration 11 source hash drifted");
  const live = mode === "apply"
    ? await applyAtomic(process.env.SUPABASE_ACCESS_TOKEN, migration)
    : await readLive(process.env.SUPABASE_ACCESS_TOKEN);
  const action = mode === "apply" ? "complete" : classify(live.history, live.state, mode);
  const safeResult = {
    checkedAt: new Date().toISOString(),
    action,
    sourceSha256: sourceSha,
    versions: live.history
      .filter((entry) => entry.version >= "20270115000003" && entry.version <= VERSION)
      .map((entry) => entry.version),
    state: live.state,
  };
  writeFileSync(outputPath, `${JSON.stringify(safeResult)}\n`, { mode: 0o600 });
  console.log(`DB_RELEASE_GATE=${action}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`CASHIER_1304_GATE_FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
