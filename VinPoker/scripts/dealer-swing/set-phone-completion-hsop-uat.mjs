#!/usr/bin/env node

import { readState, runtimeSchemaDecision } from "./apply-phone-completion-migrations.mjs";
import { PROJECT_REF } from "./phone-completion-migration-policy.mjs";
import { fileURLToPath } from "node:url";

export const HSOP_CLUB_ID = "22222222-2222-2222-2222-222222222222";
export const ENABLE_CONFIRMATION = "ENABLE_DEALER_SWING_PHONE_COMPLETION_HSOP";
export const DISABLE_CONFIRMATION = "DISABLE_DEALER_SWING_PHONE_COMPLETION_HSOP";
export const MANAGEMENT_REQUEST_TIMEOUT_MS = 30_000;

const log = (...values) => console.log("[dealer-swing-phone-hsop]", ...values);

const UAT_STATE_SQL = `
SELECT
  enabled,
  all_clubs_enabled,
  cardinality(allowed_club_ids) AS allowlist_count,
  allowed_club_ids = ARRAY['${HSOP_CLUB_ID}']::uuid[] AS hsop_only
FROM public.dealer_swing_phone_rollout
WHERE id;`;

const ENABLE_HSOP_SQL = `
UPDATE public.dealer_swing_phone_rollout
SET enabled = true,
    all_clubs_enabled = false,
    allowed_club_ids = ARRAY['${HSOP_CLUB_ID}']::uuid[],
    updated_at = now(),
    updated_by = auth.uid()
WHERE id
  AND enabled = false
  AND all_clubs_enabled = false
  AND cardinality(allowed_club_ids) = 0
RETURNING true AS applied;`;

const DISABLE_HSOP_SQL = `
UPDATE public.dealer_swing_phone_rollout
SET enabled = false,
    all_clubs_enabled = false,
    allowed_club_ids = '{}'::uuid[],
    updated_at = now(),
    updated_by = auth.uid()
WHERE id
  AND all_clubs_enabled = false
  AND allowed_club_ids = ARRAY['${HSOP_CLUB_ID}']::uuid[]
RETURNING true AS applied;`;

function firstRow(result) {
  return Array.isArray(result) ? result[0] : result;
}

function safeUatState(state) {
  return {
    enabled: state?.enabled === true,
    all_clubs_enabled: state?.all_clubs_enabled === true,
    allowlist_count: Number(state?.allowlist_count ?? 0),
    hsop_only: state?.hsop_only === true,
  };
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

export async function readUatState(credentials, fetchImpl = fetch) {
  return firstRow(await request({
    ...credentials,
    path: "/database/query/read-only",
    method: "POST",
    body: { query: UAT_STATE_SQL },
    fetchImpl,
  }));
}

async function mutateUatState(credentials, query, fetchImpl = fetch) {
  return request({
    ...credentials,
    path: "/database/query",
    method: "POST",
    body: { query },
    fetchImpl,
  });
}

function transitionDecision(mode, state) {
  const current = safeUatState(state);
  if (mode === "enable_hsop") {
    if (current.enabled && !current.all_clubs_enabled && current.hsop_only && current.allowlist_count === 1) {
      return { action: "skip", reason: "hsop_already_enabled" };
    }
    if (!current.enabled && !current.all_clubs_enabled && current.allowlist_count === 0) {
      return { action: "enable", reason: "dark_defaults" };
    }
    return { action: "block", reason: "unexpected_runtime_gate_state" };
  }
  if (mode === "disable_hsop") {
    if (!current.all_clubs_enabled && current.hsop_only && current.allowlist_count === 1) {
      return { action: "disable", reason: "hsop_scope_confirmed" };
    }
    if (!current.enabled && !current.all_clubs_enabled && current.allowlist_count === 0) {
      return { action: "skip", reason: "already_disabled" };
    }
    return { action: "block", reason: "refusing_to_change_broad_or_unknown_scope" };
  }
  return { action: "block", reason: "invalid_mode" };
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const flag = argv.find((value) => value === "--enable-hsop" || value === "--disable-hsop" || value === "--preflight");
  const mode = flag === "--enable-hsop"
    ? "enable_hsop"
    : flag === "--disable-hsop"
      ? "disable_hsop"
      : flag === "--preflight"
        ? "preflight"
        : null;
  if (!mode || argv.filter((value) => value.startsWith("--")).length !== 1) {
    throw new Error("Choose exactly one of --preflight, --enable-hsop, or --disable-hsop");
  }
  if (!env.SUPABASE_ACCESS_TOKEN || !env.SUPABASE_PROJECT_REF) {
    throw new Error("Missing required Supabase credential context");
  }
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Refusing non-approved Supabase project ref");

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  const [schema, history, uat] = await Promise.all([
    readState(credentials, fetchImpl),
    request({ ...credentials, path: "/database/migrations", method: "GET", fetchImpl }),
    readUatState(credentials, fetchImpl),
  ]);
  const schemaDecision = runtimeSchemaDecision(schema, history);
  if (schemaDecision.action !== "ready") {
    throw new Error(`Phone schema is not ready: ${schemaDecision.reason}`);
  }
  log("PRE", JSON.stringify(safeUatState(uat)));
  if (mode === "preflight") return { applied: false, state: safeUatState(uat) };

  const expectedConfirmation = mode === "enable_hsop" ? ENABLE_CONFIRMATION : DISABLE_CONFIRMATION;
  if (env.CONFIRM_DEALER_SWING_PHONE_HSOP !== expectedConfirmation) {
    throw new Error("Exact runtime gate confirmation is missing");
  }
  const decision = transitionDecision(mode, uat);
  if (decision.action === "block") throw new Error(`Runtime gate transition blocked: ${decision.reason}`);
  if (decision.action === "skip") return { applied: false, state: safeUatState(uat), decision };

  await mutateUatState(credentials, decision.action === "enable" ? ENABLE_HSOP_SQL : DISABLE_HSOP_SQL, fetchImpl);
  const after = await readUatState(credentials, fetchImpl);
  const expected = decision.action === "enable"
    ? { enabled: true, all_clubs_enabled: false, allowlist_count: 1, hsop_only: true }
    : { enabled: false, all_clubs_enabled: false, allowlist_count: 0, hsop_only: false };
  const observed = safeUatState(after);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error("Runtime gate post-verification failed; do not infer rollback");
  }
  log("POST", JSON.stringify(observed));
  return { applied: true, state: observed, decision };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[dealer-swing-phone-hsop] FAIL", error.message);
    process.exitCode = 1;
  });
}
