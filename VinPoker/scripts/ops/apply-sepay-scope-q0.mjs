#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CENTER_CLUB_ID,
  EXPECTED_ACCOUNT_FINGERPRINT,
  historyProblems,
  MIGRATION_NAME,
  MIGRATION_PATH,
  MIGRATION_VERSION,
  PROJECT_REF,
  ROYAL_CLUB_ID,
  sourcePolicyProblems,
} from "./sepay-scope-q0-policy.mjs";

export const CONFIRMATION = "APPLY_SEPAY_SCOPE_AND_Q0_20270114000000";
const REQUEST_TIMEOUT_MS = 90_000;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultVinPokerRoot = resolve(scriptDirectory, "..", "..");
const log = (...values) => console.log("[sepay-scope-q0]", ...values);

const ACCOUNT_FINGERPRINT_SQL = "left(encode(extensions.digest(account_number, 'sha256'), 'hex'), 12)";

export const STATE_SQL = `with center_accounts as (
  select pba.account_number
  from public.platform_bank_accounts pba
  where pba.club_id='${CENTER_CLUB_ID}'::uuid
    and pba.is_active=true
    and pba.account_number is not null
), q0 as (
  select
    to_regprocedure('public.resolve_sepay_account_club_v1(text)') as resolver_oid,
    to_regprocedure('public.get_ops_registration_pace_q0(uuid)') as pace_oid,
    to_regprocedure('public.get_ops_sepay_read_state_q0(uuid)') as sepay_oid
)
select
  (select count(*) from public.clubs where id='${CENTER_CLUB_ID}'::uuid) as center_club_count,
  (select count(*) from public.clubs where id='${ROYAL_CLUB_ID}'::uuid) as royal_club_count,
  (select count(*) from center_accounts) as center_active_mapping_count,
  (select min(${ACCOUNT_FINGERPRINT_SQL}) from public.platform_bank_accounts where account_number in (select account_number from center_accounts)) as center_account_fingerprint,
  (select count(*) from public.platform_bank_accounts pba where pba.club_id='${ROYAL_CLUB_ID}'::uuid and pba.is_active=true and pba.account_number not in (select account_number from center_accounts)) as royal_replacement_candidate_count,
  (select count(*) from public.club_payment_config c where c.club_id='${CENTER_CLUB_ID}'::uuid and c.provider='sepay' and c.is_active=true and c.master_account_number in (select account_number from center_accounts)) as center_active_config_count,
  (select count(*) from public.club_payment_config c where c.club_id='${ROYAL_CLUB_ID}'::uuid and c.provider='sepay' and c.is_active=true and c.master_account_number in (select account_number from center_accounts)) as royal_active_conflict_count,
  (select count(*) from public.club_payment_config c where c.club_id='${ROYAL_CLUB_ID}'::uuid and c.provider='sepay' and c.is_active=false and c.master_account_number in (select account_number from center_accounts)) as royal_disabled_conflict_count,
  (select count(*) from public.club_payment_config c where c.club_id='${ROYAL_CLUB_ID}'::uuid and c.api_token_vault_key is not null) as royal_api_vault_pointer_count,
  (select count(*) from public.club_payment_config c where c.club_id not in ('${CENTER_CLUB_ID}'::uuid,'${ROYAL_CLUB_ID}'::uuid) and c.provider='sepay' and c.is_active=true and c.master_account_number in (select account_number from center_accounts)) as third_club_active_claim_count,
  (select count(*) from public.bank_transactions bt where bt.provider='sepay' and bt.club_id is null) as null_stored_club_count,
  (select count(*) from public.bank_transactions bt where bt.provider='sepay' and bt.account_number in (select account_number from center_accounts) and bt.club_id='${ROYAL_CLUB_ID}'::uuid and bt.status='matched' and bt.transfer_type='in' and bt.api_verified_at is not null and not exists (select 1 from public.payment_settlements ps where ps.bank_transaction_id=bt.id)) as repairable_stored_conflict_count,
  (select count(*) from public.bank_transactions bt where bt.provider='sepay' and bt.account_number in (select account_number from center_accounts) and bt.club_id is not null and bt.club_id<>'${CENTER_CLUB_ID}'::uuid) as total_stored_conflict_count,
  (select count(*) from public.payment_settlements ps join public.bank_transactions bt on bt.id=ps.bank_transaction_id where bt.provider='sepay' and bt.account_number in (select account_number from center_accounts) and ps.club_id<>'${CENTER_CLUB_ID}'::uuid) as settlement_club_conflict_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='resolve_sepay_account_club_v1') as resolver_overloads,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_ops_registration_pace_q0') as pace_overloads,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_ops_sepay_read_state_q0') as sepay_overloads,
  coalesce(has_function_privilege('authenticated', (select pace_oid from q0), 'EXECUTE'), false) as pace_authenticated_execute,
  coalesce(has_function_privilege('authenticated', (select sepay_oid from q0), 'EXECUTE'), false) as sepay_authenticated_execute,
  coalesce(has_function_privilege('anon', (select pace_oid from q0), 'EXECUTE'), false) as pace_anon_execute,
  coalesce(has_function_privilege('anon', (select sepay_oid from q0), 'EXECUTE'), false) as sepay_anon_execute,
  coalesce(has_function_privilege('authenticated', (select resolver_oid from q0), 'EXECUTE'), false) as resolver_authenticated_execute,
  coalesce(has_function_privilege('service_role', (select resolver_oid from q0), 'EXECUTE'), false) as resolver_service_role_execute
from q0;`;

export const DISABLE_ROYAL_SQL = `begin;
set local lock_timeout='5s';
do $repair$
declare v_account text; v_updated integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sepay_scope_q0_repair', 0));
  lock table public.platform_bank_accounts in share mode;
  lock table public.club_payment_config in share row exclusive mode;
  lock table public.bank_transactions in share mode;
  lock table public.payment_settlements in share mode;
  if to_regprocedure('public.resolve_sepay_account_club_v1(text)') is not null
    or to_regprocedure('public.get_ops_registration_pace_q0(uuid)') is not null
    or to_regprocedure('public.get_ops_sepay_read_state_q0(uuid)') is not null
  then raise exception 'Q0_ALREADY_PRESENT_BEFORE_SCOPE_REPAIR'; end if;
  select pba.account_number into strict v_account
  from public.platform_bank_accounts pba
  where pba.club_id='${CENTER_CLUB_ID}'::uuid and pba.is_active=true and pba.account_number is not null;
  if left(encode(extensions.digest(v_account, 'sha256'), 'hex'), 12) <> '${EXPECTED_ACCOUNT_FINGERPRINT}' then raise exception 'CENTER_ACCOUNT_FINGERPRINT_DRIFT'; end if;
  if exists (select 1 from public.platform_bank_accounts pba where pba.club_id='${ROYAL_CLUB_ID}'::uuid and pba.is_active=true and pba.account_number<>v_account) then raise exception 'ROYAL_REPLACEMENT_CANDIDATE_PRESENT'; end if;
  if exists (select 1 from public.club_payment_config c where c.club_id not in ('${CENTER_CLUB_ID}'::uuid,'${ROYAL_CLUB_ID}'::uuid) and c.provider='sepay' and c.is_active=true and c.master_account_number=v_account) then raise exception 'THIRD_CLUB_ACCOUNT_CLAIM'; end if;
  if (select count(*) from public.club_payment_config c where c.club_id='${CENTER_CLUB_ID}'::uuid and c.provider='sepay' and c.is_active=true and c.master_account_number=v_account)<>1 then raise exception 'CENTER_CONFIG_DRIFT'; end if;
  if (select count(*) from public.bank_transactions bt where bt.provider='sepay' and bt.account_number=v_account and bt.club_id<>'${CENTER_CLUB_ID}'::uuid)<>1 then raise exception 'STORED_CONFLICT_COUNT_DRIFT'; end if;
  if exists (select 1 from public.payment_settlements ps join public.bank_transactions bt on bt.id=ps.bank_transaction_id where bt.provider='sepay' and bt.account_number=v_account and ps.club_id<>'${CENTER_CLUB_ID}'::uuid) then raise exception 'SETTLEMENT_SCOPE_CONFLICT'; end if;
  update public.club_payment_config
  set is_active=false, updated_at=pg_catalog.clock_timestamp()
  where club_id='${ROYAL_CLUB_ID}'::uuid and provider='sepay' and is_active=true and master_account_number=v_account and api_token_vault_key is not null;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'ROYAL_DISABLE_PRECONDITION_FAILED'; end if;
end
$repair$;
commit;`;

export const REPAIR_STORED_CONFLICT_SQL = `begin;
set local lock_timeout='5s';
do $repair$
declare v_account text; v_transaction_id uuid; v_updated integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sepay_scope_q0_repair', 0));
  lock table public.platform_bank_accounts in share mode;
  lock table public.club_payment_config in share mode;
  lock table public.payment_settlements in share mode;
  if to_regprocedure('public.resolve_sepay_account_club_v1(text)') is not null
    or to_regprocedure('public.get_ops_registration_pace_q0(uuid)') is not null
    or to_regprocedure('public.get_ops_sepay_read_state_q0(uuid)') is not null
  then raise exception 'Q0_ALREADY_PRESENT_BEFORE_SCOPE_REPAIR'; end if;
  select pba.account_number into strict v_account
  from public.platform_bank_accounts pba
  where pba.club_id='${CENTER_CLUB_ID}'::uuid and pba.is_active=true and pba.account_number is not null;
  if left(encode(extensions.digest(v_account, 'sha256'), 'hex'), 12) <> '${EXPECTED_ACCOUNT_FINGERPRINT}' then raise exception 'CENTER_ACCOUNT_FINGERPRINT_DRIFT'; end if;
  if (select count(*) from public.club_payment_config c where c.club_id='${ROYAL_CLUB_ID}'::uuid and c.provider='sepay' and c.is_active=false and c.master_account_number=v_account)<>1 then raise exception 'ROYAL_NOT_DISABLED'; end if;
  select bt.id into strict v_transaction_id
  from public.bank_transactions bt
  where bt.provider='sepay' and bt.account_number=v_account and bt.club_id='${ROYAL_CLUB_ID}'::uuid
    and bt.status='matched' and bt.transfer_type='in' and bt.api_verified_at is not null
    and not exists (select 1 from public.payment_settlements ps where ps.bank_transaction_id=bt.id)
  for update;
  update public.bank_transactions set club_id='${CENTER_CLUB_ID}'::uuid where id=v_transaction_id and club_id='${ROYAL_CLUB_ID}'::uuid;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'STORED_CONFLICT_REPAIR_PRECONDITION_FAILED'; end if;
end
$repair$;
commit;`;

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

const number = (value) => Number(value ?? 0);

export function safeState(state) {
  const output = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    if (key.endsWith("_count") || key.endsWith("_overloads")) output[key] = number(value);
    else if (key.endsWith("_execute")) output[key] = value === true;
    else if (key === "center_account_fingerprint") output[key] = /^[a-f0-9]{12}$/u.test(String(value)) ? value : "invalid";
  }
  return output;
}

function commonProblems(state) {
  const problems = [];
  for (const [key, expected] of [
    ["center_club_count", 1], ["royal_club_count", 1], ["center_active_mapping_count", 1],
    ["center_active_config_count", 1], ["royal_replacement_candidate_count", 0],
    ["third_club_active_claim_count", 0], ["settlement_club_conflict_count", 0],
    ["royal_api_vault_pointer_count", 1],
  ]) if (number(state[key]) !== expected) problems.push(`${key} expected ${expected}`);
  if (state.center_account_fingerprint !== EXPECTED_ACCOUNT_FINGERPRINT) problems.push("center account fingerprint drift");
  return problems;
}

export function classifyState(state, history = []) {
  const problems = [...commonProblems(state), ...historyProblems(history)];
  const q0Counts = number(state.resolver_overloads) + number(state.pace_overloads) + number(state.sepay_overloads);
  if (![0, 3].includes(q0Counts)) problems.push("Q0 function set is partial");
  if (number(state.total_stored_conflict_count) !== number(state.repairable_stored_conflict_count)) problems.push("stored conflict set is not exactly repairable");
  if (number(state.total_stored_conflict_count) > 1) problems.push("more than one stored conflict exists");
  if (number(state.royal_active_conflict_count) + number(state.royal_disabled_conflict_count) !== 1) problems.push("Royal config state is not singular");
  if (q0Counts !== 0 && (number(state.royal_active_conflict_count) === 1 || number(state.total_stored_conflict_count) === 1)) {
    problems.push("Q0 cannot precede SePay scope repair");
  }
  if (q0Counts === 3) {
    for (const key of ["pace_authenticated_execute", "sepay_authenticated_execute"]) if (state[key] !== true) problems.push(`${key} is not true`);
    for (const key of ["pace_anon_execute", "sepay_anon_execute", "resolver_authenticated_execute", "resolver_service_role_execute"]) if (state[key] !== false) problems.push(`${key} is not false`);
  }
  if (problems.length) return { action: "block", problems };
  if (number(state.royal_active_conflict_count) === 1) return { action: "disable_royal", problems: [] };
  if (number(state.total_stored_conflict_count) === 1) return { action: "repair_stored_conflict", problems: [] };
  if (q0Counts === 0) return { action: "apply_q0", problems: [] };
  return { action: "complete", problems: [] };
}

async function request({ projectRef, token, path, method, body, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Management API network request failed");
  }
  if (!response.ok) throw new Error(`Management API request failed with status ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export async function readState(credentials, fetchImpl = fetch) {
  return firstRow(await request({ ...credentials, path: "/database/query/read-only", method: "POST", body: { query: STATE_SQL }, fetchImpl }));
}

export async function listHistory(credentials, fetchImpl = fetch) {
  const result = await request({ ...credentials, path: "/database/migrations", method: "GET", fetchImpl });
  if (!Array.isArray(result)) throw new Error("Migration history payload is invalid");
  return result.map((entry) => ({ version: String(entry?.version ?? ""), name: String(entry?.name ?? "") }));
}

async function executeSql(credentials, query, fetchImpl = fetch) {
  try {
    return await request({ ...credentials, path: "/database/query", method: "POST", body: { query }, fetchImpl });
  } catch {
    throw new Error("WRITE_OUTCOME_UNKNOWN: guarded SQL request did not return a trustworthy acknowledgement; rerun preflight");
  }
}

async function applyQ0(credentials, sql, fetchImpl = fetch) {
  try {
    return await request({ ...credentials, path: "/database/query", method: "POST", body: { query: sql }, fetchImpl });
  } catch {
    throw new Error("APPLY_OUTCOME_UNKNOWN: Q0 migration request did not return a trustworthy acknowledgement; rerun preflight");
  }
}

function sourceRootFromArgv(argv) {
  const index = argv.indexOf("--source-root");
  if (index === -1) return defaultVinPokerRoot;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error("--source-root requires a directory");
  return resolve(value);
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const apply = argv.includes("--apply");
  const preflight = argv.includes("--preflight");
  if (apply === preflight) throw new Error("Choose exactly one of --preflight or --apply");
  const sourceRoot = sourceRootFromArgv(argv);
  const sourceProblems = sourcePolicyProblems(sourceRoot, { requireDarkFlag: false });
  if (sourceProblems.length) throw new Error(`Source policy failed: ${sourceProblems.join("; ")}`);
  if (!env.SUPABASE_PROJECT_REF || !env.SUPABASE_ACCESS_TOKEN) throw new Error("Missing Supabase credential context");
  if (env.SUPABASE_PROJECT_REF !== PROJECT_REF) throw new Error("Refusing non-approved project ref");
  if (apply && env.CONFIRM_APPLY_SEPAY_SCOPE_Q0 !== CONFIRMATION) throw new Error("Exact apply confirmation is missing");

  const credentials = { projectRef: env.SUPABASE_PROJECT_REF, token: env.SUPABASE_ACCESS_TOKEN };
  let [state, history] = await Promise.all([readState(credentials, fetchImpl), listHistory(credentials, fetchImpl)]);
  let decision = classifyState(state, history);
  if (decision.action !== "complete") {
    const darkSourceProblems = sourcePolicyProblems(sourceRoot);
    if (darkSourceProblems.length) throw new Error(`Source policy failed: ${darkSourceProblems.join("; ")}`);
  }
  log("PRE", JSON.stringify(safeState(state)));
  log("DECISION", decision.action);
  if (decision.action === "block") throw new Error(`Live state is not allowlisted: ${decision.problems.join("; ")}`);
  if (preflight || decision.action === "complete") return { applied: false, decision, state };

  for (const expectedAction of ["disable_royal", "repair_stored_conflict", "apply_q0"]) {
    if (decision.action === "complete") break;
    if (decision.action !== expectedAction) continue;
    if (expectedAction === "disable_royal") await executeSql(credentials, DISABLE_ROYAL_SQL, fetchImpl);
    else if (expectedAction === "repair_stored_conflict") await executeSql(credentials, REPAIR_STORED_CONFLICT_SQL, fetchImpl);
    else {
      const sql = readFileSync(resolve(sourceRoot, MIGRATION_PATH), "utf8");
      await applyQ0(credentials, sql, fetchImpl);
    }
    [state, history] = await Promise.all([readState(credentials, fetchImpl), listHistory(credentials, fetchImpl)]);
    decision = classifyState(state, history);
    log(`POST_${expectedAction.toUpperCase()}`, JSON.stringify(safeState(state)));
    if (decision.action === "block") throw new Error(`Post-step verification failed: ${decision.problems.join("; ")}`);
  }

  if (decision.action !== "complete") throw new Error(`Apply sequence stopped before completion at ${decision.action}`);
  log("APPLY_AND_VERIFY_PASS", MIGRATION_VERSION, MIGRATION_NAME, "ledger_unchanged");
  return { applied: true, decision, state };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error("[sepay-scope-q0] FAIL", error.message);
    process.exitCode = 1;
  });
}
