#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  PROJECT_REF,
  finalPostProblems,
  readState,
} from "./apply-dealer-payroll-statement-contract.mjs";

export const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
export const ENABLE_CONFIRMATION = "ENABLE_DEALER_PAYROLL_STATEMENT_HSOP";
export const DISABLE_CONFIRMATION = "DISABLE_DEALER_PAYROLL_STATEMENT_HSOP";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 30_000;

const log = (...values) => console.log("[dealer-payroll-statement-hsop]", ...values);

const RUNTIME_GATE_STATE_SQL = `
select
  rollout.master_enabled as master_enabled,
  rollout.all_clubs_enabled as all_clubs_enabled,
  cardinality(rollout.allowed_club_ids) as allowlist_count,
  '${HSOP_CLUB_ID}'::uuid = any(coalesce(rollout.allowed_club_ids, '{}'::uuid[])) as hsop_allowed,
  rollout.allowed_club_ids = array['${HSOP_CLUB_ID}']::uuid[] as hsop_only
from public.dealer_payroll_statement_rollout rollout
where rollout.id = true;`;

const ENABLE_HSOP_SQL = `
update public.dealer_payroll_statement_rollout
set master_enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = array['${HSOP_CLUB_ID}']::uuid[],
    updated_at = now(),
    updated_by = auth.uid()
where id = true
  and master_enabled = false
  and all_clubs_enabled = false
  and cardinality(allowed_club_ids) = 0
returning true as applied;`;

const DISABLE_HSOP_SQL = `
update public.dealer_payroll_statement_rollout
set master_enabled = false,
    all_clubs_enabled = false,
    allowed_club_ids = '{}'::uuid[],
    updated_at = now(),
    updated_by = auth.uid()
where id = true
  and master_enabled = true
  and all_clubs_enabled = false
  and allowed_club_ids = array['${HSOP_CLUB_ID}']::uuid[]
returning true as applied;`;

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function count(value) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function safeStatementGateState(state) {
  return {
    master_enabled: state?.master_enabled === true,
    all_clubs_enabled: state?.all_clubs_enabled === true,
    allowlist_count: count(state?.allowlist_count),
    hsop_allowed: state?.hsop_allowed === true,
    hsop_only: state?.hsop_only === true,
  };
}

function isExpectedRuntimeStateProblem(problem) {
  return /^rollout_(?:master_enabled_count|all_clubs_enabled_count|allowlist_count) expected 0$/.test(problem);
}

export function statementRuntimeContractProblems(state) {
  return finalPostProblems(state).filter((problem) => !isExpectedRuntimeStateProblem(problem));
}

export function transitionDecision(mode, value) {
  const state = safeStatementGateState(value);
  const dark = !state.master_enabled && !state.all_clubs_enabled && state.allowlist_count === 0;
  const hsop = state.master_enabled
    && !state.all_clubs_enabled
    && state.allowlist_count === 1
    && state.hsop_only;

  if (mode === "preflight") return { action: "hold", reason: "read_only" };
  if (mode === "enable_hsop") {
    if (hsop) return { action: "skip", reason: "hsop_already_enabled" };
    if (dark) return { action: "enable", reason: "dark_defaults" };
    return { action: "block", reason: "unexpected_statement_runtime_gate_state" };
  }
  if (mode === "disable_hsop") {
    if (dark) return { action: "skip", reason: "already_disabled" };
    if (hsop) return { action: "disable", reason: "hsop_scope_confirmed" };
    return { action: "block", reason: "refusing_to_change_broad_or_unknown_scope" };
  }
  return { action: "block", reason: "invalid_mode" };
}

async function request({ projectRef, token, path, method, body, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(MANAGEMENT_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Management API network request failed");
  }
  if (!response.ok) throw new Error(`Management API request failed with status ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export async function readStatementGateState(credentials, fetchImpl = fetch) {
  return firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: RUNTIME_GATE_STATE_SQL },
    fetchImpl,
  }));
}

async function mutateStatementGate(credentials, query, fetchImpl = fetch) {
  const result = await request({
    ...credentials,
    path: "/database/query",
    method: "POST",
    body: { query },
    fetchImpl,
  });
  if (firstRow(result)?.applied !== true) throw new Error("PAYROLL_STATEMENT_RUNTIME_GATE_CAS_CONFLICT");
}

function parseMode(argv) {
  const flag = argv.find((value) => value === "--preflight" || value === "--enable-hsop" || value === "--disable-hsop");
  if (!flag || argv.filter((value) => value.startsWith("--")).length !== 1) {
    throw new Error("Choose exactly one of --preflight, --enable-hsop, or --disable-hsop");
  }
  return flag === "--enable-hsop" ? "enable_hsop" : flag === "--disable-hsop" ? "disable_hsop" : "preflight";
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const mode = parseMode(argv);
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) {
    throw new Error("Missing required Supabase credential context");
  }
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Refusing non-approved Supabase project ref");

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const [contractState, gateState] = await Promise.all([
    readState(credentials, fetchImpl),
    readStatementGateState(credentials, fetchImpl),
  ]);
  const contractProblems = statementRuntimeContractProblems(contractState);
  if (contractProblems.length) {
    throw new Error(`Payroll statement contract is not ready: ${contractProblems.join("; ")}`);
  }

  const before = safeStatementGateState(gateState);
  log("PRE", JSON.stringify(before));
  const decision = transitionDecision(mode, before);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") throw new Error(`Runtime gate transition blocked: ${decision.reason}`);
  if (decision.action === "hold" || decision.action === "skip") return { applied: false, state: before, decision };

  const expectedConfirmation = mode === "enable_hsop" ? ENABLE_CONFIRMATION : DISABLE_CONFIRMATION;
  if (env.CONFIRM_DEALER_PAYROLL_STATEMENT_HSOP !== expectedConfirmation) {
    throw new Error("Exact runtime gate confirmation is missing");
  }

  await mutateStatementGate(credentials, decision.action === "enable" ? ENABLE_HSOP_SQL : DISABLE_HSOP_SQL, fetchImpl);
  const after = safeStatementGateState(await readStatementGateState(credentials, fetchImpl));
  const expected = decision.action === "enable"
    ? { master_enabled: true, all_clubs_enabled: false, allowlist_count: 1, hsop_allowed: true, hsop_only: true }
    : { master_enabled: false, all_clubs_enabled: false, allowlist_count: 0, hsop_allowed: false, hsop_only: false };
  if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error("PAYROLL_STATEMENT_RUNTIME_GATE_POST_VERIFY_FAILED");
  log("POST", JSON.stringify(after));
  return { applied: true, state: after, decision };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-payroll-statement-hsop] FAIL", error.message);
    process.exitCode = 1;
  });
}
