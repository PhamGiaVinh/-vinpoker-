#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  PROJECT_REF,
  catalogClass,
  contractProblems,
  readEvidence,
} from "./repair-dealer-payroll-statement-delivery.mjs";

export const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
export const ENABLE_CONFIRMATION = "ENABLE_DEALER_PAYROLL_STATEMENT_DELIVERY_HSOP";
export const DISABLE_CONFIRMATION = "DISABLE_DEALER_PAYROLL_STATEMENT_DELIVERY_HSOP";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 30_000;

const log = (...values) => console.log("[dealer-payroll-delivery-hsop]", ...values);

const RUNTIME_GATE_STATE_SQL = `
select
  statement_rollout.master_enabled as statement_master_enabled,
  statement_rollout.all_clubs_enabled as statement_all_clubs_enabled,
  cardinality(statement_rollout.allowed_club_ids) as statement_allowlist_count,
  '${HSOP_CLUB_ID}'::uuid = any(statement_rollout.allowed_club_ids) as statement_hsop_allowed,
  delivery_rollout.master_enabled as delivery_master_enabled,
  delivery_rollout.all_clubs_enabled as delivery_all_clubs_enabled,
  cardinality(delivery_rollout.allowed_club_ids) as delivery_allowlist_count,
  delivery_rollout.allowed_club_ids = array['${HSOP_CLUB_ID}']::uuid[] as delivery_hsop_only
from public.dealer_payroll_statement_rollout statement_rollout
cross join public.dealer_payroll_statement_delivery_rollout delivery_rollout
where statement_rollout.id = true and delivery_rollout.id = true;`;

const ENABLE_HSOP_SQL = `
update public.dealer_payroll_statement_delivery_rollout
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
update public.dealer_payroll_statement_delivery_rollout
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

export function safeRuntimeGateState(state) {
  return {
    statement_master_enabled: state?.statement_master_enabled === true,
    statement_all_clubs_enabled: state?.statement_all_clubs_enabled === true,
    statement_allowlist_count: count(state?.statement_allowlist_count),
    statement_hsop_allowed: state?.statement_hsop_allowed === true,
    delivery_master_enabled: state?.delivery_master_enabled === true,
    delivery_all_clubs_enabled: state?.delivery_all_clubs_enabled === true,
    delivery_allowlist_count: count(state?.delivery_allowlist_count),
    delivery_hsop_only: state?.delivery_hsop_only === true,
  };
}

export function deliveryRuntimeContractProblems(state) {
  if (catalogClass(state) !== "complete") return ["delivery contract is not complete"];
  return contractProblems(state);
}

export function transitionDecision(mode, value) {
  const state = safeRuntimeGateState(value);
  const deliveryDark = !state.delivery_master_enabled
    && !state.delivery_all_clubs_enabled
    && state.delivery_allowlist_count === 0;
  const deliveryHsop = state.delivery_master_enabled
    && !state.delivery_all_clubs_enabled
    && state.delivery_allowlist_count === 1
    && state.delivery_hsop_only;

  if (mode === "preflight") {
    return { action: "hold", reason: "read_only" };
  }
  if (mode === "enable_hsop") {
    if (!state.statement_hsop_allowed) return { action: "block", reason: "statement_hsop_rollout_disabled" };
    if (deliveryHsop) return { action: "skip", reason: "hsop_already_enabled" };
    if (deliveryDark) return { action: "enable", reason: "dark_defaults" };
    return { action: "block", reason: "unexpected_delivery_runtime_gate_state" };
  }
  if (mode === "disable_hsop") {
    if (deliveryDark) return { action: "skip", reason: "already_disabled" };
    if (deliveryHsop) return { action: "disable", reason: "hsop_scope_confirmed" };
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

export async function readRuntimeGateState(credentials, fetchImpl = fetch) {
  return firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: RUNTIME_GATE_STATE_SQL },
    fetchImpl,
  }));
}

async function mutateRuntimeGate(credentials, query, fetchImpl = fetch) {
  const result = await request({
    ...credentials,
    path: "/database/query",
    method: "POST",
    body: { query },
    fetchImpl,
  });
  if (firstRow(result)?.applied !== true) {
    throw new Error("PAYROLL_DELIVERY_RUNTIME_GATE_CAS_CONFLICT");
  }
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
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) {
    throw new Error("Refusing non-approved Supabase project ref");
  }

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const [evidence, gateState] = await Promise.all([
    readEvidence(credentials, fetchImpl),
    readRuntimeGateState(credentials, fetchImpl),
  ]);
  const runtimeContractProblems = deliveryRuntimeContractProblems(evidence.catalog);
  if (runtimeContractProblems.length) {
    throw new Error(`Payroll delivery contract is not ready: ${runtimeContractProblems.join("; ")}`);
  }

  const before = safeRuntimeGateState(gateState);
  log("PRE", JSON.stringify(before));
  const decision = transitionDecision(mode, before);
  log(`DECISION_${decision.action.toUpperCase()}`, decision.reason);
  if (decision.action === "block") {
    throw new Error(`Runtime gate transition blocked: ${decision.reason}`);
  }
  if (decision.action === "hold" || decision.action === "skip") {
    return { applied: false, state: before, decision };
  }

  const expectedConfirmation = mode === "enable_hsop" ? ENABLE_CONFIRMATION : DISABLE_CONFIRMATION;
  if (env.CONFIRM_DEALER_PAYROLL_DELIVERY_HSOP !== expectedConfirmation) {
    throw new Error("Exact runtime gate confirmation is missing");
  }

  await mutateRuntimeGate(credentials, decision.action === "enable" ? ENABLE_HSOP_SQL : DISABLE_HSOP_SQL, fetchImpl);
  const after = safeRuntimeGateState(await readRuntimeGateState(credentials, fetchImpl));
  const expected = decision.action === "enable"
    ? { ...before, delivery_master_enabled: true, delivery_all_clubs_enabled: false, delivery_allowlist_count: 1, delivery_hsop_only: true }
    : { ...before, delivery_master_enabled: false, delivery_all_clubs_enabled: false, delivery_allowlist_count: 0, delivery_hsop_only: false };
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    throw new Error("PAYROLL_DELIVERY_RUNTIME_GATE_POST_VERIFY_FAILED");
  }
  log("POST", JSON.stringify(after));
  return { applied: true, state: after, decision };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-payroll-delivery-hsop] FAIL", error.message);
    process.exitCode = 1;
  });
}
