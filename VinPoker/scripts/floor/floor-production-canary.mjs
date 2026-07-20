import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const PRODUCTION_REF = "orlesggcjamwuknxwcpk";
const REQUIRED_CONFIRMATION = "RUN_FLOOR_PRODUCTION_CANARY";
const CANARY_BROWSER_LOCALE = "vi-VN";
const CANARY_SIGN_IN_LABEL = "Đăng nhập";
const CANARY_MODES = new Set(["run", "cleanup", "hold"]);
const SCENARIOS = [
  "ACCESS",
  "SETUP_CLOCK",
  "TABLE_LIFECYCLE",
  "CLOSE_ORPHAN",
  "REDRAW",
  "CHIP_CAS",
  "BUST_RESTORE",
  "PAYOUT_CLOSE",
  "CONCURRENCY",
];
const SCENARIO_SECOND_TABLE_NUMBER = Object.freeze({
  TABLE_LIFECYCLE: 21,
  CLOSE_ORPHAN: 31,
  REDRAW: 41,
});
const CLEANUP_RUN_ID_RE = /^CODEX_FLOOR_CANARY_[0-9]{14}_[a-f0-9]{8}$/;
const CLEANUP_SCENARIO_RE = new RegExp(`^(CODEX_FLOOR_CANARY_[0-9]{14}_[a-f0-9]{8})_(${[...SCENARIOS, "CROSS_CLUB"].join("|")})$`);
const CLEANUP_SCENARIOS = new Set(["ACCESS", "SETUP_CLOCK", "TABLE_LIFECYCLE", "CLOSE_ORPHAN", "REDRAW", "CHIP_CAS", "BUST_RESTORE", "PAYOUT_CLOSE", "CONCURRENCY", "CROSS_CLUB"]);
const CLEANUP_RUN_GROUP_COUNT = 1;
const CLEANUP_CLUBS_PER_RUN = 2;
const CLEANUP_TOTAL_CLUB_COUNT = 2;
const CLEANUP_SCOPE_PREFIX = "CODEX_FLOOR_CANARY_";
const CLEANUP_GAME_TABLE_BATCH_SIZE = 50;
const CLEANUP_MAX_BATCH_ATTEMPTS = 3;
const CLEANUP_SLOW_FK = "dealer_rotation_schedule.table_id";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLEANUP_CHILD_SCOPES = [
  { table: "dealer_assignments", column: "table_id", source: "gameTableIds", constraint: "dealer_assignments_table_id_fkey", indexed: true },
  { table: "dealer_attendance", column: "pre_assigned_table_id", source: "gameTableIds", constraint: "dealer_attendance_pre_assigned_table_id_fkey", indexed: false },
  { table: "dealer_incidents", column: "table_id", source: "gameTableIds", constraint: "dealer_incidents_table_id_fkey", indexed: false },
  { table: "swing_audit_logs", column: "table_id", source: "gameTableIds", constraint: "swing_audit_logs_table_id_fkey", indexed: false },
  { table: "tournament_hands", column: "table_id", source: "gameTableIds", constraint: "tournament_hands_table_id_fkey", indexed: false },
  { table: "seat_draw_receipts", column: "table_id", source: "gameTableIds", constraint: "seat_draw_receipts_table_id_fkey", indexed: false },
  { table: "seat_assignment_history", column: "to_table_id", source: "gameTableIds", constraint: "seat_assignment_history_to_table_id_fkey", indexed: false },
  { table: "dealer_rotation_schedule", column: "table_id", source: "gameTableIds", constraint: "dealer_rotation_schedule_table_id_fkey", indexed: true },
  { table: "dealer_table_profiles", column: "table_id", source: "gameTableIds", constraint: "dealer_table_profiles_table_id_fkey", indexed: true },
  { table: "dealer_override_claims", column: "table_id", source: "gameTableIds", constraint: "dealer_override_claims_table_id_fkey", indexed: false },
  { table: "tournament_chip_counts", column: "tournament_id", source: "tournamentIds", constraint: "tournament_chip_counts_tournament_id_fkey", indexed: true },
  { table: "tournament_eliminations", column: "tournament_id", source: "tournamentIds", constraint: "tournament_eliminations_tournament_id_fkey", indexed: true },
  { table: "tournament_state_transitions", column: "tournament_id", source: "tournamentIds", constraint: "tournament_state_transitions_tournament_id_fkey", indexed: true },
  { table: "tournament_close_report", column: "tournament_id", source: "tournamentIds", constraint: "tournament_close_report_tournament_id_fkey", indexed: true },
];

// These columns are verified in the repository migrations. A missing table or
// column is a hard stop: cleanup must never guess at money-related schema.
const MONEY_SCOPES = [
  { table: "bank_transactions", column: "club_id", bucket: "bank" },
  { table: "payment_settlements", column: "club_id", bucket: "payment" },
  { table: "payment_records", column: "club_id", bucket: "payment" },
  { table: "club_payment_config", column: "club_id", bucket: "payment" },
  { table: "club_wallets", column: "club_id", bucket: "staking" },
  { table: "staking_deals", column: "club_id", bucket: "staking" },
  { table: "staking_purchases", column: "deal_id", bucket: "staking" },
  { table: "staking_ledger", column: "deal_id", bucket: "staking" },
  { table: "escrow_transactions", column: "deal_id", bucket: "staking" },
  { table: "escrow_funding_proofs", column: "deal_id", bucket: "staking" },
  { table: "tournament_payout_runs", column: "tournament_id", bucket: "payout" },
  { table: "tournament_prizes", column: "tournament_id", bucket: "payout" },
  { table: "tournament_prize_payments", column: "tournament_id", bucket: "payout" },
  { table: "tournament_close_report", column: "tournament_id", bucket: "close_report" },
  { table: "tournament_registrations", column: "tournament_id", bucket: "registration" },
  { table: "payout_recipients", column: "deal_id", bucket: "payout" },
  { table: "payout_templates", column: "club_id", bucket: "payout" },
  { table: "fnb_orders", column: "club_id", bucket: "fnb" },
  { table: "dealer_payroll", column: "club_id", bucket: "payroll" },
  { table: "payroll_periods", column: "club_id", bucket: "payroll" },
  { table: "payroll_audit_log", column: "club_id", bucket: "payroll" },
  { table: "chip_inventory_ledger", column: "club_id", bucket: "cashier" },
  { table: "chip_bank", column: "club_id", bucket: "cashier" },
  { table: "chip_bank_ledger", column: "club_id", bucket: "cashier" },
  { table: "online_poker_chip_ledger", column: "user_id", bucket: "cashier" },
];

function fail(code) {
  throw new Error(code);
}

function actorHash(id) {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

function requireProductionCanaryContext(environment = process.env) {
  const required = [
    "FLOOR_CANARY_ENV",
    "FLOOR_CANARY_CONFIRM",
    "FLOOR_CANARY_PREFIX",
    "FLOOR_CANARY_MODE",
    "FLOOR_CANARY_BROWSER_ACTIONS_READY",
    "SUPABASE_PROJECT_REF",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GITHUB_REF",
  ];
  const missing = required.filter((name) => !environment[name]);
  if (missing.length > 0) fail(`missing:${missing.join(",")}`);
  if (environment.FLOOR_CANARY_ENV !== "production") fail("floor_canary_env_must_be_production");
  if (environment.FLOOR_CANARY_CONFIRM !== REQUIRED_CONFIRMATION) fail("floor_canary_confirmation_missing");
  if (!CANARY_MODES.has(environment.FLOOR_CANARY_MODE)) fail("floor_canary_mode_invalid");
  if (environment.FLOOR_CANARY_MODE === "run" && environment.FLOOR_CANARY_BROWSER_ACTIONS_READY !== "true") {
    fail("browser_action_matrix_not_ready");
  }
  if (!environment.FLOOR_CANARY_PREFIX.startsWith("CODEX_FLOOR_CANARY_")) fail("floor_canary_prefix_invalid");
  if (environment.SUPABASE_PROJECT_REF !== PRODUCTION_REF) fail("production_project_ref_mismatch");
  if (new URL(environment.SUPABASE_URL).hostname !== `${PRODUCTION_REF}.supabase.co`) fail("production_url_mismatch");
  if (environment.GITHUB_REF === "refs/heads/main") fail("floor_canary_must_not_run_from_main");

  return {
    prefix: environment.FLOOR_CANARY_PREFIX,
    mode: environment.FLOOR_CANARY_MODE,
    projectRef: environment.SUPABASE_PROJECT_REF,
    url: environment.SUPABASE_URL,
    anonKey: environment.SUPABASE_ANON_KEY,
    serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY,
  };
}

function createRunId(prefix) {
  return `${prefix}${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomBytes(4).toString("hex")}`;
}

function result(name, passed, detail = "") {
  console.log(`FLOOR_CANARY ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` ${detail}` : ""}`);
  if (!passed) fail(`assertion_failed:${name}`);
}

const NODE_REALTIME_OPTIONS = { realtime: { transport: WebSocket } };

function safeAuthErrorDetail(error) {
  const status = Number.isInteger(error?.status) ? String(error.status) : "unknown";
  const code = typeof error?.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code)
    ? error.code
    : "unknown";
  return `status=${status} code=${code}`;
}

function safeDbErrorDetail(error) {
  const code = typeof error?.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(error.code)
    ? error.code
    : "unknown";
  const constraint = typeof error?.constraint === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(error.constraint)
    ? ` constraint=${error.constraint}`
    : "";
  const referencedTable = typeof error?.details === "string"
    ? error.details.match(/referenced from table ["']([A-Za-z0-9_]+)["']/i)?.[1]
    : null;
  const referencedBy = referencedTable ? ` referenced_by=${referencedTable}` : "";
  return `code=${code}${constraint}${referencedBy}`;
}

function hashIds(ids) {
  return createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 12);
}

function cleanupScopeError(detail = "") {
  const suffix = detail ? `:${detail}` : "";
  fail(`CLEANUP_SCOPE_UNEXPECTED${suffix}`);
}

async function readCleanupCandidates(admin) {
  const response = await admin.from("clubs")
    .select("id,name,region,owner_id")
    .like("name", `${CLEANUP_SCOPE_PREFIX}%`)
    .limit(1000);
  if (response.error || !Array.isArray(response.data)) {
    console.log(`FLOOR_CANARY CLEANUP_SCOPE_FAIL op=discover_clubs ${safeDbErrorDetail(response.error)}`);
    fail("cleanup_scope_discovery");
  }
  return response.data;
}

async function discoverCleanupScope(admin) {
  const rows = await readCleanupCandidates(admin);
  const parsed = [];
  for (const row of rows) {
    const match = typeof row.name === "string" ? row.name.match(CLEANUP_SCENARIO_RE) : null;
    const ownerIdOk = row.owner_id === null || UUID_RE.test(row.owner_id);
    if (!match || !CLEANUP_RUN_ID_RE.test(match[1]) || !CLEANUP_SCENARIOS.has(match[2]) || row.region !== "TEST" || !UUID_RE.test(row.id) || !ownerIdOk) {
      console.log(`FLOOR_CANARY CLEANUP_SCOPE_FAIL invalid_prefixed_row name_ok=${Boolean(match)} region_ok=${row.region === "TEST"} club_id_ok=${UUID_RE.test(row.id)} owner_id_ok=${ownerIdOk}`);
      cleanupScopeError("invalid_row");
    }
    parsed.push({ id: row.id, ownerId: row.owner_id, runId: match[1], scenario: match[2] });
  }

  const groups = new Map();
  for (const row of parsed) {
    const group = groups.get(row.runId) ?? [];
    group.push(row);
    groups.set(row.runId, group);
  }
  for (const [runId, group] of groups) {
    console.log(`FLOOR_CANARY CLEANUP_SCOPE run_hash=${actorHash(runId)} clubs=${group.length}`);
  }
  if (groups.size !== CLEANUP_RUN_GROUP_COUNT || parsed.length !== CLEANUP_TOTAL_CLUB_COUNT) cleanupScopeError("run_count");
  const scopes = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([runId, clubs]) => {
    if (clubs.length !== CLEANUP_CLUBS_PER_RUN) cleanupScopeError("club_count");
    const scenarios = new Set(clubs.map((row) => row.scenario));
    if (scenarios.size !== CLEANUP_CLUBS_PER_RUN) cleanupScopeError("scenario_set");
    return { runId, clubs };
  });
  if (scopes.length !== CLEANUP_RUN_GROUP_COUNT) {
    cleanupScopeError("run_count");
  }
  return scopes;
}

async function idsByColumn(admin, table, column, values, code) {
  if (values.length === 0) return [];
  const ids = [];
  const uniqueValues = [...new Set(values)];
  for (let offset = 0; offset < uniqueValues.length; offset += CLEANUP_GAME_TABLE_BATCH_SIZE) {
    const batch = uniqueValues.slice(offset, offset + CLEANUP_GAME_TABLE_BATCH_SIZE);
    const response = await admin.from(table).select("id").in(column, batch);
    if (response.error || !Array.isArray(response.data)) {
      console.log(`FLOOR_CANARY CLEANUP_SCOPE_FAIL op=${code} ${safeDbErrorDetail(response.error)}`);
      fail(code);
    }
    ids.push(...response.data.map((row) => row.id).filter((id) => typeof id === "string"));
  }
  return [...new Set(ids)];
}

async function countByColumn(admin, table, column, values, code) {
  if (values.length === 0) return 0;
  const response = await admin.from(table).select("*", { count: "exact", head: true }).in(column, values);
  if (response.error || !Number.isInteger(response.count)) {
    console.log(`FLOOR_CANARY CLEANUP_SCOPE_FAIL op=${code} ${safeDbErrorDetail(response.error)}`);
    fail(code);
  }
  return response.count;
}

async function moneySafetyPreflight(admin, ledger, allowOwnedAuditRows = false) {
  const valuesFor = (scope) => {
    if (scope.column === "club_id") return ledger.clubIds;
    if (scope.column === "tournament_id") return ledger.tournamentIds;
    if (scope.column === "deal_id") return ledger.stakingDealIds;
    if (scope.column === "user_id") return ledger.userIds;
    return [];
  };
  const counts = {};
  for (const scope of MONEY_SCOPES) {
    const values = valuesFor(scope);
    const count = await countByColumn(admin, scope.table, scope.column, values, `cleanup_money_schema_${scope.table}`);
    counts[scope.table] = count;
    const allowed = allowOwnedAuditRows && scope.table === "payout_templates"
      ? (ledger.childRows.payout_templates?.length ?? 0)
      : allowOwnedAuditRows && scope.table === "tournament_close_report"
        ? (ledger.childRows.tournament_close_report?.length ?? 0)
        : 0;
    console.log(`FLOOR_CANARY CLEANUP_MONEY table=${scope.table} bucket=${scope.bucket} count=${count} allowed_exact=${allowed}`);
    if (count !== allowed) fail(`CLEANUP_BLOCKED_BY_MONEY_ROW:${scope.table}`);
  }
  return counts;
}

async function validateExactAuthUserIds(admin, runId, ids, { allowPartial = false } = {}) {
  const uniqueIds = [...new Set(ids)];
  if (
    uniqueIds.length !== ids.length
    || (allowPartial ? ids.length > 4 : ![0, 4].includes(ids.length))
    || ids.some((id) => !UUID_RE.test(id))
  ) fail("cleanup_scope_actor_count");
  const emailPattern = new RegExp(`^${runId.toLowerCase()}-(owner|cashier|floor|cross)@floor-canary\\.invalid$`);
  const labels = new Set();
  for (const id of ids) {
    const fetched = await admin.auth.admin.getUserById(id);
    if (fetched.error || !fetched.data?.user) {
      console.log(`FLOOR_CANARY CLEANUP_SCOPE_FAIL op=get_auth_user id_hash=${actorHash(id)} ${safeAuthErrorDetail(fetched.error)}`);
      fail("cleanup_scope_auth_user");
    }
    const email = typeof fetched.data.user.email === "string" ? fetched.data.user.email.toLowerCase() : "";
    const match = email.match(emailPattern);
    if (!match || fetched.data.user.id !== id) fail("cleanup_scope_auth_identity_mismatch");
    labels.add(match[1]);
  }
  if (labels.size !== ids.length || (!allowPartial && ids.length === 4 && labels.size !== 4)) {
    fail("cleanup_scope_actor_labels");
  }
  return ids;
}

async function verifyExactAuthUsersDeleted(admin, ids) {
  for (const id of ids) {
    const fetched = await admin.auth.admin.getUserById(id);
    if (fetched.error) {
      if (fetched.error.status === 404 || fetched.error.code === "user_not_found") continue;
      throw new Error(`verify_auth_user:${actorHash(id)}:${safeAuthErrorDetail(fetched.error)}`);
    }
    if (fetched.data?.user) throw new Error(`verify_auth_user:remaining=1:id_hash=${actorHash(id)}`);
  }
}

async function recoverAttemptedAuthUserIds(anonKey, url, owned, createClientImpl = createClient) {
  const ids = new Set(owned.users);
  const unresolvedRoles = [];
  for (const actorAttempt of owned.actorAttempts) {
    if (actorAttempt.id) {
      ids.add(actorAttempt.id);
      continue;
    }
    const client = createClientImpl(url, anonKey, {
      ...NODE_REALTIME_OPTIONS,
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let recoveredId = null;
    for (let retry = 1; retry <= 3 && !recoveredId; retry += 1) {
      let recovered;
      try {
        recovered = await client.auth.signInWithPassword({
          email: actorAttempt.email,
          password: actorAttempt.password,
        });
      } catch {
        continue;
      }
      const recoveredUser = recovered.data?.user;
      if (
        !recovered.error
        && recoveredUser
        && UUID_RE.test(recoveredUser.id)
        && recoveredUser.email?.toLowerCase() === actorAttempt.email.toLowerCase()
      ) {
        recoveredId = recoveredUser.id;
        actorAttempt.id = recoveredId;
        actorAttempt.outcome = "recovered";
        ids.add(recoveredId);
      }
    }
    if (!recoveredId) unresolvedRoles.push(actorAttempt.label);
  }
  return { ids: [...ids], unresolvedRoles };
}

function scrubActorAttempts(owned) {
  for (const actorAttempt of owned.actorAttempts) {
    actorAttempt.email = null;
    actorAttempt.password = null;
  }
}

async function buildCleanupLedger(admin, scope, expectedAuthUserIds = null) {
  const clubIds = scope.clubs.map((club) => club.id);
  const tournaments = await admin.from("tournaments").select("id,club_id").in("club_id", clubIds);
  if (tournaments.error || !Array.isArray(tournaments.data)) fail("cleanup_scope_tournaments");
  const tournamentIds = tournaments.data.map((row) => row.id).filter((id) => typeof id === "string");
  const tournamentTableIds = await idsByColumn(admin, "tournament_tables", "tournament_id", tournamentIds, "cleanup_scope_tournament_tables");
  const levels = await idsByColumn(admin, "tournament_levels", "tournament_id", tournamentIds, "cleanup_scope_levels");
  const entries = await idsByColumn(admin, "tournament_entries", "tournament_id", tournamentIds, "cleanup_scope_entries");
  const seats = await idsByColumn(admin, "tournament_seats", "tournament_id", tournamentIds, "cleanup_scope_seats");
  const gameTables = await admin.from("game_tables").select("id").in("club_id", clubIds);
  if (gameTables.error || !Array.isArray(gameTables.data)) fail("cleanup_scope_game_tables");
  const gameTableIds = gameTables.data.map((row) => row.id).filter((id) => typeof id === "string");
  const auditRows = await idsByColumn(admin, "swing_config_audit", "club_id", clubIds, "cleanup_scope_audit");
  const cashierMemberships = await admin.from("club_cashiers").select("club_id,user_id").in("club_id", clubIds);
  const floorMemberships = await admin.from("club_floors").select("club_id,user_id").in("club_id", clubIds);
  if (cashierMemberships.error || floorMemberships.error) fail("cleanup_scope_memberships");
  const userIds = new Set([
    ...scope.clubs.map((club) => club.ownerId),
    ...cashierMemberships.data.map((row) => row.user_id),
    ...floorMemberships.data.map((row) => row.user_id),
  ].filter((id) => typeof id === "string"));
  const referencedUserIds = [...userIds];
  if (referencedUserIds.length > 4) fail("CLEANUP_SCOPE_UNEXPECTED:referenced_actor_set");
  let authCandidates = referencedUserIds;
  if (expectedAuthUserIds !== null) {
    const expected = [...new Set(expectedAuthUserIds)];
    if (expected.length > 4 || expected.some((id) => !UUID_RE.test(id))) fail("cleanup_scope_expected_actor_set");
    if (referencedUserIds.some((id) => !expected.includes(id))) fail("cleanup_scope_unowned_actor_reference");
    authCandidates = expected;
  }
  const authUsers = await validateExactAuthUserIds(admin, scope.runId, authCandidates, {
    allowPartial: expectedAuthUserIds !== null,
  });
  console.log(`FLOOR_CANARY CLEANUP_AUTH_SCOPE run_hash=${actorHash(scope.runId)} users=${authUsers.length} source=exact_references ids_hash=${hashIds(authUsers)}`);
  for (const userId of authUsers) userIds.add(userId);

  const ledger = {
    runId: scope.runId,
    clubIds,
    tournamentIds,
    tournamentTableIds,
    gameTableIds,
    levels,
    entries,
    seats,
    auditRows,
    cashierMemberships: cashierMemberships.data,
    floorMemberships: floorMemberships.data,
    authUserIds: [...new Set(authUsers)],
    userIds: [...userIds],
    stakingDealIds: await idsByColumn(admin, "staking_deals", "club_id", clubIds, "cleanup_scope_staking_deals"),
    childRows: {},
  };
  for (const child of CLEANUP_CHILD_SCOPES) {
    const values = ledger[child.source];
    const ids = await idsByColumn(admin, child.table, child.column, values, `cleanup_scope_${child.table}_${child.column}`);
    const existing = ledger.childRows[child.table] ?? [];
    ledger.childRows[child.table] = [...new Set([...existing, ...ids])];
    console.log(`FLOOR_CANARY CLEANUP_FK child=${child.table} constraint=${child.constraint} column=${child.column} indexed=${child.indexed} count=${ids.length} ids_hash=${hashIds(ids)}`);
  }
  const payoutTemplates = await admin.from("payout_templates")
    .select("id,club_id,name")
    .in("club_id", clubIds);
  if (payoutTemplates.error || !Array.isArray(payoutTemplates.data)) fail("cleanup_scope_payout_templates");
  if (payoutTemplates.data.some((row) => (
    !clubIds.includes(row.club_id)
    || typeof row.name !== "string"
    || !row.name.startsWith(`${scope.runId}_`)
    || !UUID_RE.test(row.id)
  ))) fail("CLEANUP_SCOPE_UNEXPECTED:payout_template_identity");
  ledger.childRows.payout_templates = payoutTemplates.data.map((row) => row.id);
  console.log(`FLOOR_CANARY CLEANUP_FK child=payout_templates constraint=payout_templates_club_id_fkey column=club_id indexed=true count=${payoutTemplates.data.length} ids_hash=${hashIds(ledger.childRows.payout_templates)}`);
  console.log(`FLOOR_CANARY CLEANUP_LEDGER run_hash=${actorHash(scope.runId)} clubs=${clubIds.length} tournaments=${tournamentIds.length} game_tables=${gameTableIds.length} users=${ledger.authUserIds.length} ids_hash=${hashIds([...clubIds, ...gameTableIds])}`);
  return ledger;
}

async function single(query, code) {
  const { data, error } = await query.single();
  if (error || !data) {
    console.log(`FLOOR_CANARY DB_FAIL op=${code} ${safeDbErrorDetail(error)}`);
    fail(code);
  }
  return data;
}

async function createActor(admin, anonKey, url, runId, label, owned) {
  const email = `${runId.toLowerCase()}-${label}@floor-canary.invalid`;
  const password = `Canary-${randomBytes(24).toString("base64url")}`;
  const attempt = { label, email, password, id: null, outcome: "pending" };
  owned.actorAttempts.push(attempt);
  let created;
  try {
    created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  } catch {
    attempt.outcome = "ambiguous";
    fail(`create_test_actor_${label}`);
  }
  if (created.error || !created.data.user) {
    attempt.outcome = "ambiguous";
    console.log(`FLOOR_CANARY ACTOR_CREATE_FAIL label=${label} ${safeAuthErrorDetail(created.error)}`);
    fail(`create_test_actor_${label}`);
  }
  attempt.id = created.data.user.id;
  attempt.outcome = "confirmed";
  owned.users.push(created.data.user.id);

  const client = createClient(url, anonKey, {
    ...NODE_REALTIME_OPTIONS,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    console.log(`FLOOR_CANARY ACTOR_SIGNIN_FAIL label=${label} ${safeAuthErrorDetail(signedIn.error)}`);
    fail(`sign_in_test_actor_${label}`);
  }
  return {
    id: created.data.user.id,
    label,
    email,
    password,
    client,
    jwt: signedIn.data.session.access_token,
  };
}

async function trackClubOwnedRows(admin, clubId, owned) {
  const tables = await admin.from("game_tables").select("id").eq("club_id", clubId);
  if (tables.error || !tables.data) {
    console.log(`FLOOR_CANARY DB_FAIL op=track_game_tables ${safeDbErrorDetail(tables.error)}`);
    fail("track_game_tables");
  }
  owned.gameTables.push(...tables.data.map((row) => row.id));

  const audits = await admin.from("swing_config_audit").select("id").eq("club_id", clubId);
  if (audits.error || !audits.data) {
    console.log(`FLOOR_CANARY DB_FAIL op=track_swing_config_audit ${safeDbErrorDetail(audits.error)}`);
    fail("track_swing_config_audit");
  }
  owned.auditRows.push(...audits.data.map((row) => row.id));
}

async function createPrimaryClub(admin, actors, runId, owned) {
  const clubId = randomUUID();
  const clubAttempt = {
    id: clubId,
    name: `${runId}_ACCESS`,
    region: "TEST",
    ownerId: actors.owner.id,
  };
  owned.clubAttempts.push(clubAttempt);
  owned.clubs.push(clubId);
  const club = await single(admin.from("clubs").insert({
    id: clubId,
    owner_id: actors.owner.id,
    name: clubAttempt.name,
    region: clubAttempt.region,
    status: "approved",
  }).select("id"), "create_primary_club");
  await trackClubOwnedRows(admin, club.id, owned);
  for (const actor of [actors.cashier, actors.floor]) {
    const membership = await admin.from(actor.label === "cashier" ? "club_cashiers" : "club_floors").insert({
      club_id: club.id,
      user_id: actor.id,
      granted_by: actors.owner.id,
    });
    if (membership.error) {
      console.log(`FLOOR_CANARY DB_FAIL op=create_${actor.label}_membership ${safeDbErrorDetail(membership.error)}`);
      fail(`create_${actor.label}_membership`);
    }
  }
  return club.id;
}

async function createFixture(admin, runId, scenario, clubId, owned) {
  const tournamentId = randomUUID();
  const tournamentName = `${runId}_${scenario}`;
  const tableName = `${runId}_${scenario}_T1`;
  owned.tournaments.push(tournamentId);
  const tournament = await single(admin.from("tournaments").insert({
    id: tournamentId,
    club_id: clubId,
    name: tournamentName,
    start_time: new Date().toISOString(),
    buy_in: scenario === "PAYOUT_CLOSE" ? 1000 : 0,
    starting_stack: 10000,
    status: "active",
    current_level: 1,
  }).select("id,club_id"), `create_fixture_tournament_${scenario}`);

  const levelIds = [randomUUID(), randomUUID()];
  owned.levels.push(...levelIds);
  const levels = await admin.from("tournament_levels").insert([
    { id: levelIds[0], tournament_id: tournament.id, level_number: 1, small_blind: 100, big_blind: 200, ante: 0, duration_minutes: 20, is_break: false },
    { id: levelIds[1], tournament_id: tournament.id, level_number: 2, small_blind: 200, big_blind: 400, ante: 0, duration_minutes: 20, is_break: false },
  ]).select("id");
  if (levels.error || !levels.data || levels.data.length !== 2) {
    console.log(`FLOOR_CANARY DB_FAIL op=create_fixture_levels_${scenario} ${safeDbErrorDetail(levels.error)}`);
    fail(`create_fixture_levels_${scenario}`);
  }

  const gameTableId = randomUUID();
  owned.gameTables.push(gameTableId);
  const gameTable = await single(admin.from("game_tables").insert({
    id: gameTableId,
    club_id: clubId,
    table_name: tableName,
    table_type: "tournament",
    status: "active",
    current_blind_level: 1,
  }).select("id"), `create_fixture_game_table_${scenario}`);

  const tournamentTableId = randomUUID();
  owned.tournamentTables.push(tournamentTableId);
  const tournamentTable = await single(admin.from("tournament_tables").insert({
    id: tournamentTableId,
    tournament_id: tournament.id,
    table_id: gameTable.id,
    table_number: 1,
    table_name: tableName,
    max_seats: 9,
    status: "active",
  }).select("id"), `create_fixture_tournament_table_${scenario}`);

  const seatFixtures = [];
  const entryFixtures = [];
  for (const seatNumber of [1, 2]) {
    const playerId = randomUUID();
    const entryId = randomUUID();
    owned.entries.push(entryId);
    const entry = await single(admin.from("tournament_entries").insert({
      id: entryId,
      tournament_id: tournament.id,
      registration_id: null,
      player_id: playerId,
      entry_no: 1,
      source: "manual",
      status: "seated",
      current_stack: 10000,
      table_id: gameTable.id,
      seat_number: seatNumber,
      seated_at: new Date().toISOString(),
    }).select("id,player_id"), `create_fixture_entry_${scenario}_${seatNumber}`);
    const seatId = randomUUID();
    owned.seats.push(seatId);
    const seat = await single(admin.from("tournament_seats").insert({
      id: seatId,
      tournament_id: tournament.id,
      player_id: playerId,
      entry_number: 1,
      table_id: tournamentTable.id,
      seat_number: seatNumber,
      chip_count: 10000,
      is_active: true,
      entry_id: entry.id,
      player_name: `${runId}_${scenario}_P${seatNumber}`,
    }).select("id,tournament_id,player_id,entry_number,table_id,seat_number,chip_count,is_active,entry_id,status,player_name"), `create_fixture_seat_${scenario}_${seatNumber}`);
    entryFixtures.push({ id: entry.id, playerId: entry.player_id, seatId: seat.id, seatNumber });
    seatFixtures.push(seat);
  }

  return {
    scenario,
    runId,
    clubId,
    tournamentId: tournament.id,
    tournamentName,
    tableName,
    gameTableId: gameTable.id,
    tournamentTableId: tournamentTable.id,
    entries: entryFixtures,
    seats: seatFixtures,
    seat: seatFixtures[0],
    initialSnapshot: {
      activeSeatCount: seatFixtures.length,
      chipTotal: seatFixtures.reduce((sum, seat) => sum + Number(seat.chip_count), 0),
      entryIdsHash: hashIds(entryFixtures.map((entry) => entry.id)),
    },
  };
}

async function createCrossClub(admin, actor, runId, owned) {
  const clubId = randomUUID();
  const clubAttempt = {
    id: clubId,
    name: `${runId}_CROSS_CLUB`,
    region: "TEST",
    ownerId: actor.id,
  };
  owned.clubAttempts.push(clubAttempt);
  owned.clubs.push(clubId);
  const club = await single(admin.from("clubs").insert({
    id: clubId,
    owner_id: actor.id,
    name: clubAttempt.name,
    region: clubAttempt.region,
    status: "approved",
  }).select("id"), "create_cross_club");
  await trackClubOwnedRows(admin, club.id, owned);
  return club.id;
}

async function invokeFunction(url, anonKey, name, jwt, body) {
  const headers = { "Content-Type": "application/json" };
  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`;
    headers.apikey = anonKey;
  }
  const response = await fetch(`${url}/functions/v1/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
  let payload = {};
  try { payload = await response.json(); } catch { /* status-only evidence */ }
  return { status: response.status, error: typeof payload?.error === "string" ? payload.error : null };
}

function safeEdgeResultDetail(response) {
  const errorHash = response.error
    ? createHash("sha256").update(response.error).digest("hex").slice(0, 12)
    : "none";
  return `status=${response.status} error_hash=${errorHash}`;
}

async function assertScope(actor, fixture, capability) {
  const scope = await actor.client.rpc("get_my_floor_operator_scope");
  if (scope.error || !Array.isArray(scope.data)) fail(`scope_query_${actor.label}`);
  const rows = scope.data.filter((candidate) => candidate.club_id === fixture.clubId);
  const row = rows[0];
  const expected = {
    can_owner: capability === "can_owner",
    can_cashier: capability === "can_cashier",
    can_floor: capability === "can_floor",
  };
  result(
    `scope_${actor.label}_${fixture.scenario}`,
    rows.length === 1
      && row?.can_owner === expected.can_owner
      && row?.can_cashier === expected.can_cashier
      && row?.can_floor === expected.can_floor,
  );
}

async function rpcJson(actor, name, args, code) {
  const response = await actor.client.rpc(name, args);
  if (response.error || !response.data || typeof response.data !== "object") {
    console.log(`FLOOR_CANARY RPC_FAIL op=${code} ${safeDbErrorDetail(response.error)}`);
    fail(code);
  }
  return response.data;
}

async function queryRows(query, code) {
  const response = await query;
  if (response.error || !Array.isArray(response.data)) {
    console.log(`FLOOR_CANARY DB_FAIL op=${code} ${safeDbErrorDetail(response.error)}`);
    fail(code);
  }
  return response.data;
}

async function activeSeatGraph(admin, fixture, code) {
  const rows = await queryRows(
    admin.from("tournament_seats")
      .select("id,entry_id,player_id,entry_number,table_id,seat_number,chip_count,is_active,status")
      .eq("tournament_id", fixture.tournamentId)
      .eq("is_active", true),
    code,
  );
  return {
    rows,
    entryIds: rows.map((row) => row.entry_id),
    chipTotal: rows.reduce((sum, row) => sum + Number(row.chip_count ?? 0), 0),
  };
}

function canonicalSeatGraph(rows) {
  return JSON.stringify(
    rows
      .map((row) => ({
        id: row.id,
        entry_id: row.entry_id,
        player_id: row.player_id,
        entry_number: row.entry_number,
        table_id: row.table_id,
        seat_number: row.seat_number,
        chip_count: row.chip_count,
        is_active: row.is_active,
        status: row.status,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );
}

async function openFixtureTable(actor, fixture, tableNumber, code) {
  const payload = await rpcJson(actor, "open_tournament_table", {
    p_tournament_id: fixture.tournamentId,
    p_table_number: tableNumber,
    p_max_seats: 9,
  }, code);
  result(code, payload.ok === true && UUID_RE.test(payload.tournament_table_id));
  return payload;
}

async function updateSeatChip(context, actor, fixture, seat, expectedChip, chipCount, code) {
  const response = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actor.jwt, {
    tournament_id: fixture.tournamentId,
    action: "update_seats",
    seats: [{ seat_id: seat.id, expected_chip_count: expectedChip, chip_count: chipCount }],
  });
  result(code, response.status === 200, safeEdgeResultDetail(response));
  return response;
}

async function bustSeat(context, actor, fixture, seat, code) {
  const response = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actor.jwt, {
    tournament_id: fixture.tournamentId,
    action: "update_seats",
    seats: [{ seat_id: seat.id, chip_count: 0, is_active: false }],
  });
  result(code, response.status === 200, safeEdgeResultDetail(response));
  return response;
}

async function assertTournamentMoneyZero(admin, fixture, code, allowCloseReport = false) {
  const counts = {};
  for (const table of [
    "tournament_registrations",
    "tournament_payout_runs",
    "tournament_prizes",
    "tournament_prize_payments",
    "tournament_close_report",
  ]) {
    counts[table] = await countByColumn(admin, table, "tournament_id", [fixture.tournamentId], `${code}_${table}`);
  }
  result(
    code,
    counts.tournament_registrations === 0
      && counts.tournament_payout_runs === 0
      && counts.tournament_prizes === 0
      && counts.tournament_prize_payments === 0
      && counts.tournament_close_report === (allowCloseReport ? 1 : 0),
  );
  return counts;
}

async function runTableLifecycle(admin, actors, fixture) {
  const opened = await openFixtureTable(
    actors.floor,
    fixture,
    SCENARIO_SECOND_TABLE_NUMBER.TABLE_LIFECYCLE,
    "table_lifecycle_open_table",
  );
  const added = await rpcJson(actors.floor, "floor_assign_player_to_seat", {
    p_tournament_id: fixture.tournamentId,
    p_player_name: `${fixture.runId}_TABLE_LIFECYCLE_ADDED`,
    p_tournament_table_id: opened.tournament_table_id,
    p_seat_number: 3,
  }, "table_lifecycle_add_player");
  result("table_lifecycle_add_player", added.ok === true && UUID_RE.test(added.entry_id) && UUID_RE.test(added.seat_id));

  const moved = await rpcJson(actors.floor, "move_player_seat", {
    p_entry_id: fixture.entries[0].id,
    p_to_tournament_table_id: opened.tournament_table_id,
    p_to_seat_number: 4,
    p_actor_user_id: null,
    p_reason: "floor_canary_table_lifecycle",
  }, "table_lifecycle_move_player");
  result("table_lifecycle_move_player", moved.ok === true && moved.entry_id === fixture.entries[0].id);

  const active = await activeSeatGraph(admin, fixture, "table_lifecycle_active_graph");
  const movedRows = active.rows.filter((row) => row.entry_id === fixture.entries[0].id);
  const addedRows = active.rows.filter((row) => row.entry_id === added.entry_id);
  result(
    "table_lifecycle_db_invariant",
    active.rows.length === 3
      && new Set(active.entryIds).size === 3
      && movedRows.length === 1
      && movedRows[0].table_id === opened.tournament_table_id
      && movedRows[0].seat_number === 4
      && addedRows.length === 1
      && addedRows[0].seat_number === 3
      && active.chipTotal === 30000,
  );
  const receipts = await queryRows(
    admin.from("seat_draw_receipts").select("id,entry_id,status").eq("tournament_id", fixture.tournamentId),
    "table_lifecycle_receipts",
  );
  const history = await queryRows(
    admin.from("seat_assignment_history").select("id,entry_id,reason").eq("tournament_id", fixture.tournamentId),
    "table_lifecycle_history",
  );
  result("table_lifecycle_receipt_and_history", receipts.length >= 2 && history.some((row) => row.entry_id === fixture.entries[0].id));
}

async function runCloseTableInvariant(admin, actors, fixture) {
  await openFixtureTable(
    actors.floor,
    fixture,
    SCENARIO_SECOND_TABLE_NUMBER.CLOSE_ORPHAN,
    "close_orphan_open_target_table",
  );
  const closed = await rpcJson(actors.floor, "close_tournament_table", {
    p_tournament_table_id: fixture.tournamentTableId,
    p_draw_mode: "redraw_balanced",
    p_reason: "floor_canary_close_table",
  }, "close_orphan_close_table");
  result("close_orphan_close_table", closed.ok === true && closed.closed === true && closed.moved_count === 2);
  const active = await activeSeatGraph(admin, fixture, "close_orphan_active_graph");
  const source = await single(
    admin.from("tournament_tables").select("id,table_id,status").eq("id", fixture.tournamentTableId),
    "close_orphan_source_table",
  );
  const sourceGame = await single(
    admin.from("game_tables").select("id,status").eq("id", fixture.gameTableId),
    "close_orphan_source_game_table",
  );
  const entries = await queryRows(
    admin.from("tournament_entries").select("id,status").eq("tournament_id", fixture.tournamentId),
    "close_orphan_entries",
  );
  result(
    "close_orphan_no_bust_invariant",
    active.rows.length === 2
      && new Set(active.entryIds).size === 2
      && active.chipTotal === fixture.initialSnapshot.chipTotal
      && source.status === "closed"
      && sourceGame.status === "inactive"
      && entries.every((entry) => entry.status === "seated"),
  );
}

async function runRedrawInvariant(admin, actors, fixture) {
  const target = await openFixtureTable(
    actors.floor,
    fixture,
    SCENARIO_SECOND_TABLE_NUMBER.REDRAW,
    "redraw_open_second_table",
  );
  const moved = await rpcJson(actors.floor, "move_player_seat", {
    p_entry_id: fixture.entries[0].id,
    p_to_tournament_table_id: target.tournament_table_id,
    p_to_seat_number: 1,
    p_actor_user_id: null,
    p_reason: "floor_canary_redraw_seed",
  }, "redraw_seed_second_table");
  result("redraw_seed_second_table", moved.ok === true);

  const before = await activeSeatGraph(admin, fixture, "redraw_before");
  const preview = await rpcJson(actors.floor, "redraw_tournament", {
    p_tournament_id: fixture.tournamentId,
    p_mode: "final_table",
    p_eligible_entry_ids: null,
    p_target_table_count: null,
    p_draw_mode: "redraw_balanced",
    p_dry_run: true,
  }, "redraw_preview");
  result("redraw_preview", preview.ok === true && preview.dry_run === true);
  const afterPreview = await activeSeatGraph(admin, fixture, "redraw_after_preview");
  result(
    "redraw_preview_zero_write",
    canonicalSeatGraph(before.rows) === canonicalSeatGraph(afterPreview.rows),
  );

  const confirmed = await rpcJson(actors.floor, "redraw_tournament", {
    p_tournament_id: fixture.tournamentId,
    p_mode: "final_table",
    p_eligible_entry_ids: null,
    p_target_table_count: null,
    p_draw_mode: "redraw_balanced",
    p_dry_run: false,
  }, "redraw_confirm");
  result("redraw_confirm", confirmed.ok === true && confirmed.dry_run === false);
  const after = await activeSeatGraph(admin, fixture, "redraw_after");
  result(
    "redraw_entry_and_chip_invariant",
    after.rows.length === 2
      && new Set(after.entryIds).size === 2
      && hashIds(after.entryIds) === hashIds(fixture.entries.map((entry) => entry.id))
      && after.chipTotal === fixture.initialSnapshot.chipTotal
      && new Set(after.rows.map((row) => row.table_id)).size === 1,
  );
}

async function runBustRestoreInvariant(context, admin, actors, fixture) {
  const seat = fixture.seats[0];
  await updateSeatChip(context, actors.floor, fixture, seat, seat.chip_count, 0, "bust_restore_zero_chip");
  await bustSeat(context, actors.floor, fixture, seat, "bust_restore_bust");
  const bustedEntry = await single(
    admin.from("tournament_entries").select("id,status,current_stack").eq("id", seat.entry_id),
    "bust_restore_busted_entry",
  );
  const bustedSeat = await single(
    admin.from("tournament_seats").select("id,status,is_active,chip_count").eq("id", seat.id),
    "bust_restore_busted_seat",
  );
  const bustAudits = await queryRows(
    admin.from("audit_logs")
      .select("id,action,entity_id,payload")
      .eq("club_id", fixture.clubId)
      .eq("action", "floor_player_busted")
      .eq("entity_id", fixture.tournamentId),
    "bust_restore_audit",
  );
  result(
    "bust_restore_bust_db_invariant",
    bustedEntry.status === "busted"
      && Number(bustedEntry.current_stack) === 0
      && bustedSeat.is_active === false
      && Number(bustedSeat.chip_count) === 0
      && bustAudits.length === 1
      && bustAudits[0].payload?.entry_id === seat.entry_id
      && bustAudits[0].payload?.payout_applied === false,
  );

  const restored = await rpcJson(actors.floor, "restore_busted_player_to_seat", {
    p_entry_id: seat.entry_id,
    p_to_tournament_table_id: fixture.tournamentTableId,
    p_to_seat_number: 3,
    p_actor_user_id: null,
    p_reason: "floor_canary_restore",
  }, "bust_restore_restore");
  result("bust_restore_restore", restored.ok === true && restored.entry_id === seat.entry_id);
  const active = await activeSeatGraph(admin, fixture, "bust_restore_active_graph");
  const restoredEntry = await single(
    admin.from("tournament_entries").select("id,status,current_stack,seat_number").eq("id", seat.entry_id),
    "bust_restore_restored_entry",
  );
  result(
    "bust_restore_restore_db_invariant",
    active.rows.filter((row) => row.entry_id === seat.entry_id).length === 1
      && restoredEntry.status === "seated"
      && Number(restoredEntry.current_stack) === 0
      && restoredEntry.seat_number === 3,
  );
  await assertTournamentMoneyZero(admin, fixture, "bust_restore_no_payout_side_effect");
}

async function preparePayoutCloseInvariant(context, admin, actors, fixture) {
  await assertTournamentMoneyZero(admin, fixture, "payout_preview_before");
  const preview = await invokeFunction(context.url, context.anonKey, "compute-payouts", actors.owner.jwt, {
    mode: "preview",
    tournament_id: fixture.tournamentId,
    archetype: "DAILY",
    itm_percent: 0.5,
    min_cash_x: 1,
    rounding_unit: 1,
    entries_override: 2,
    prize_pool_override: 2000,
  });
  result("payout_preview_owner_200", preview.status === 200, safeEdgeResultDetail(preview));
  await assertTournamentMoneyZero(admin, fixture, "payout_preview_zero_write");

  for (const seat of fixture.seats) {
    await updateSeatChip(context, actors.floor, fixture, seat, seat.chip_count, 0, `payout_close_zero_chip_${seat.seat_number}`);
    await bustSeat(context, actors.floor, fixture, seat, `payout_close_bust_${seat.seat_number}`);
  }
  const activeBeforeClose = await activeSeatGraph(admin, fixture, "payout_close_active_before_close");
  result("payout_close_no_active_seats", activeBeforeClose.rows.length === 0);
  const tournament = await single(
    admin.from("tournaments").select("id,status,registration_closed_at").eq("id", fixture.tournamentId),
    "payout_close_prepared_tournament",
  );
  const reportCount = await countByColumn(
    admin,
    "tournament_close_report",
    "tournament_id",
    [fixture.tournamentId],
    "payout_close_prepared_report_count",
  );
  fixture.closeTransitionCountBefore = await countByColumn(
    admin,
    "tournament_state_transitions",
    "tournament_id",
    [fixture.tournamentId],
    "payout_close_prepared_transition_count",
  );
  result(
    "payout_close_prepared_for_browser",
    tournament.status === "active" && tournament.registration_closed_at === null && reportCount === 0,
  );
}

async function verifyPayoutCloseAfterBrowser(admin, actors, fixture) {
  const planned = await single(
    admin.from("tournaments")
      .select("id,status,registration_closed_at,planned_itm_percent,planned_payout_archetype,planned_min_cash_x,planned_rounding_unit")
      .eq("id", fixture.tournamentId),
    "payout_browser_planned_settings",
  );
  result(
    "payout_browser_planned_settings_db_invariant",
    Number(planned.planned_itm_percent) === 0.5
      && planned.planned_payout_archetype === "DAILY"
      && Number(planned.planned_min_cash_x) === 1
      && Number(planned.planned_rounding_unit) === 1,
  );

  const templateName = `${fixture.runId}_PAYOUT_BROWSER_TEMPLATE`;
  const template = await single(
    admin.from("payout_templates")
      .select("id,club_id,name,archetype,custom_percents")
      .eq("club_id", fixture.clubId)
      .eq("name", templateName),
    "payout_browser_custom_template",
  );
  const customPercents = Array.isArray(template.custom_percents) ? template.custom_percents : [];
  result(
    "payout_browser_template_save_load_db_invariant",
    template.club_id === fixture.clubId
      && template.name === templateName
      && template.archetype === "CUSTOM"
      && JSON.stringify(customPercents) === JSON.stringify([
        { position: 1, percent_bp: 5000 },
        { position: 2, percent_bp: 3000 },
        { position: 3, percent_bp: 2000 },
      ]),
  );

  const transitionCountAfterBrowser = await countByColumn(
    admin,
    "tournament_state_transitions",
    "tournament_id",
    [fixture.tournamentId],
    "payout_close_transition_count_after_browser",
  );
  const retry = await rpcJson(actors.owner, "close_tournament", {
    p_tournament_id: fixture.tournamentId,
    p_reason: "floor_canary_close_report_retry",
  }, "payout_close_close_retry");
  const transitionCountAfterRetry = await countByColumn(
    admin,
    "tournament_state_transitions",
    "tournament_id",
    [fixture.tournamentId],
    "payout_close_transition_count_after_retry",
  );
  const reportOwner = await queryRows(
    actors.owner.client.from("tournament_close_report").select("id,tournament_id,reconciled,buy_in_total,cash_in_total,prize_total").eq("tournament_id", fixture.tournamentId),
    "payout_close_report_owner",
  );
  const reportCashier = await queryRows(
    actors.cashier.client.from("tournament_close_report").select("id,tournament_id,reconciled").eq("tournament_id", fixture.tournamentId),
    "payout_close_report_cashier",
  );
  const reportFloor = await queryRows(
    actors.floor.client.from("tournament_close_report").select("id").eq("tournament_id", fixture.tournamentId),
    "payout_close_report_floor",
  );
  result(
    "payout_close_close_idempotent",
    retry.ok === true
      && retry.outcome === "already_closed"
      && reportOwner.length === 1
      && retry.report_id === reportOwner[0].id
      && transitionCountAfterBrowser === fixture.closeTransitionCountBefore + 1
      && transitionCountAfterRetry === transitionCountAfterBrowser,
  );
  result(
    "payout_close_report_db_and_rls",
    reportOwner.length === 1
      && reportCashier.length === 1
      && reportFloor.length === 0
      && planned.status === "completed"
      && planned.registration_closed_at === null
      && reportOwner[0].reconciled === true
      && Number(reportOwner[0].buy_in_total) === 0
      && Number(reportOwner[0].cash_in_total) === 0
      && Number(reportOwner[0].prize_total) === 0,
  );
  await assertTournamentMoneyZero(admin, fixture, "payout_close_no_official_payment", true);
}

async function runApiCanary(context, admin, actors, fixtures) {
  const setup = fixtures.get("SETUP_CLOCK");
  const chips = fixtures.get("CHIP_CAS");
  const access = fixtures.get("ACCESS");
  const lifecycle = fixtures.get("TABLE_LIFECYCLE");
  const closeOrphan = fixtures.get("CLOSE_ORPHAN");
  const redraw = fixtures.get("REDRAW");
  const bustRestore = fixtures.get("BUST_RESTORE");
  const payoutClose = fixtures.get("PAYOUT_CLOSE");
  const concurrent = fixtures.get("CONCURRENCY");
  if (!setup || !chips || !access || !lifecycle || !closeOrphan || !redraw || !bustRestore || !payoutClose || !concurrent) {
    fail("required_scenarios_missing");
  }

  await assertScope(actors.owner, access, "can_owner");
  await assertScope(actors.cashier, access, "can_cashier");
  await assertScope(actors.floor, access, "can_floor");
  const crossScope = await actors.cross.client.rpc("get_my_floor_operator_scope");
  result("scope_cross_club_denied", !crossScope.error && !crossScope.data?.some((row) => row.club_id === access.clubId));

  for (const actor of [actors.owner, actors.cashier, actors.floor]) {
    const seats = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actor.jwt, {
      tournament_id: access.tournamentId,
      action: "get_seats",
    });
    result(`edge_draw_get_seats_${actor.label}`, seats.status === 200, safeEdgeResultDetail(seats));
  }
  const crossSeats = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.cross.jwt, {
    tournament_id: access.tournamentId,
    action: "get_seats",
  });
  result("edge_draw_get_seats_cross_403", crossSeats.status === 403, safeEdgeResultDetail(crossSeats));

  const missingAuth = await invokeFunction(context.url, context.anonKey, "tournament-live-clock", null, {});
  result("edge_clock_missing_auth_401", missingAuth.status === 401);
  const invalidPayload = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.floor.jwt, {});
  result("edge_draw_invalid_payload_400", invalidPayload.status === 400);
  const crossClub = await invokeFunction(context.url, context.anonKey, "tournament-live-clock", actors.cross.jwt, { tournament_id: setup.tournamentId, action: "start" });
  result("edge_clock_cross_club_403", crossClub.status === 403);

  const started = await invokeFunction(context.url, context.anonKey, "tournament-live-clock", actors.floor.jwt, { tournament_id: setup.tournamentId, action: "start" });
  result("edge_clock_start", started.status === 200);
  const startAgain = await invokeFunction(context.url, context.anonKey, "tournament-live-clock", actors.floor.jwt, { tournament_id: setup.tournamentId, action: "start" });
  result("edge_clock_double_start_409", startAgain.status === 409);

  const concurrentStart = await Promise.all([
    invokeFunction(context.url, context.anonKey, "tournament-live-clock", actors.floor.jwt, { tournament_id: concurrent.tournamentId, action: "start" }),
    invokeFunction(context.url, context.anonKey, "tournament-live-clock", actors.floor.jwt, { tournament_id: concurrent.tournamentId, action: "start" }),
  ]);
  result("edge_clock_concurrent_start_one_wins", concurrentStart.map((entry) => entry.status).sort().join(",") === "200,409");

  const setupTournament = await single(
    admin.from("tournaments").select("id,status,current_level,clock_started_at").eq("id", setup.tournamentId),
    "clock_setup_db_state",
  );
  const setupTransitions = await queryRows(
    admin.from("tournament_state_transitions").select("id,new_state,reason").eq("tournament_id", setup.tournamentId),
    "clock_setup_transitions",
  );
  const concurrentTransitions = await queryRows(
    admin.from("tournament_state_transitions").select("id,new_state,reason").eq("tournament_id", concurrent.tournamentId),
    "clock_concurrency_transitions",
  );
  result(
    "edge_clock_db_invariant",
    setupTournament.status === "live"
      && setupTournament.current_level === 1
      && typeof setupTournament.clock_started_at === "string"
      && setupTransitions.filter((row) => row.reason === "floor_clock_started").length === 1
      && concurrentTransitions.filter((row) => row.reason === "floor_clock_started").length === 1,
  );

  await updateSeatChip(context, actors.owner, chips, chips.seats[0], 10000, 10001, "edge_draw_chip_cas_owner_write");
  await updateSeatChip(context, actors.cashier, chips, chips.seats[1], 10000, 10001, "edge_draw_chip_cas_cashier_write");
  await updateSeatChip(context, actors.floor, chips, chips.seats[0], 10001, 10002, "edge_draw_chip_cas_floor_write");
  const stale = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.floor.jwt, {
    tournament_id: chips.tournamentId,
    action: "update_seats",
    seats: [{ seat_id: chips.seats[0].id, chip_count: 10003, expected_chip_count: 10001 }],
  });
  result("edge_draw_chip_cas_stale_409", stale.status === 409, safeEdgeResultDetail(stale));
  const crossChip = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.cross.jwt, {
    tournament_id: chips.tournamentId,
    action: "update_seats",
    seats: [{ seat_id: chips.seats[0].id, chip_count: 10003, expected_chip_count: 10002 }],
  });
  result("edge_draw_chip_cas_cross_403", crossChip.status === 403, safeEdgeResultDetail(crossChip));
  const chipRows = await queryRows(
    admin.from("tournament_seats").select("id,chip_count").in("id", chips.seats.map((seat) => seat.id)),
    "chip_cas_db_state",
  );
  result(
    "edge_draw_chip_cas_db_invariant",
    Number(chipRows.find((row) => row.id === chips.seats[0].id)?.chip_count) === 10002
      && Number(chipRows.find((row) => row.id === chips.seats[1].id)?.chip_count) === 10001,
  );

  const concurrentChip = await Promise.all([
    invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.floor.jwt, {
      tournament_id: concurrent.tournamentId,
      action: "update_seats",
      seats: [{ seat_id: concurrent.seats[0].id, chip_count: 10001, expected_chip_count: 10000 }],
    }),
    invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.floor.jwt, {
      tournament_id: concurrent.tournamentId,
      action: "update_seats",
      seats: [{ seat_id: concurrent.seats[0].id, chip_count: 10002, expected_chip_count: 10000 }],
    }),
  ]);
  result("edge_draw_chip_cas_concurrent_one_wins", concurrentChip.map((entry) => entry.status).sort().join(",") === "200,409");
  const concurrentSeat = await single(
    admin.from("tournament_seats").select("id,chip_count").eq("id", concurrent.seats[0].id),
    "chip_cas_concurrent_db_state",
  );
  result("edge_draw_chip_cas_concurrent_refresh", [10001, 10002].includes(Number(concurrentSeat.chip_count)));

  await runTableLifecycle(admin, actors, lifecycle);
  await runCloseTableInvariant(admin, actors, closeOrphan);
  await runRedrawInvariant(admin, actors, redraw);
  await runBustRestoreInvariant(context, admin, actors, bustRestore);
  await preparePayoutCloseInvariant(context, admin, actors, payoutClose);
}

function productionBaseUrl(environment = process.env) {
  const value = environment.FLOOR_CANARY_BASE_URL ?? "https://vinpoker.vercel.app";
  if (new URL(value).hostname !== "vinpoker.vercel.app") fail("production_base_url_mismatch");
  return value.replace(/\/$/, "");
}

function runCommand(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: environment, stdio: "inherit" });
    child.once("error", () => reject(new Error("browser_manifest_command_start_failed")));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function browserChildEnvironment(baseUrl, stateDirectory, routeAssignments, environment = process.env) {
  const childEnvironment = {};
  for (const name of [
    "PATH",
    "HOME",
    "CI",
    "RUNNER_TEMP",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SystemRoot",
    "COMSPEC",
    "PATHEXT",
    "NODE_PATH",
    "PLAYWRIGHT_BROWSERS_PATH",
  ]) {
    if (environment[name]) childEnvironment[name] = environment[name];
  }
  return {
    ...childEnvironment,
    PLAYWRIGHT_BASE_URL: baseUrl,
    FLOOR_UAT_RUN_BROWSER: "true",
    FLOOR_UAT_STORAGE_STATE_DIR: stateDirectory,
    FLOOR_UAT_ROUTE_ASSIGNMENTS: routeAssignments,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeBrowserResponseDetail(response) {
  return `method=${response.request().method()} path=${new URL(response.url()).pathname} status=${response.status()}`;
}

async function selectOwnedFloorTournament(page, baseUrl, tournament) {
  if (!tournament.runId.startsWith(CLEANUP_SCOPE_PREFIX) || !tournament.tournamentName.startsWith(`${tournament.runId}_`)) {
    fail("browser_floor_fixture_ownership_invalid");
  }
  await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" });
  const tournamentButton = page.getByRole("button", {
    name: new RegExp(`^${escapeRegex(tournament.tournamentName)}$`, "u"),
  }).first();
  await tournamentButton.waitFor({ state: "visible", timeout: 15_000 });
  await tournamentButton.click();
  await page.getByRole("button", { name: "Tất cả giải", exact: true }).waitFor({ state: "visible", timeout: 15_000 });
}

function safeRequestJson(request) {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
}

function exactObjectKeys(value, expectedKeys) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort());
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isExactPayoutPreviewBody(body, tournamentId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const archetypes = new Set(["DAILY", "CUSTOM", "MULTI", "INTL"]);
  if (
    body.mode !== "preview"
    || body.tournament_id !== tournamentId
    || !archetypes.has(body.archetype)
    || !Number.isInteger(body.entries_override)
    || body.entries_override <= 0
    || body.entries_override > 100_000
    || !isFiniteNumber(body.min_cash_x)
    || body.min_cash_x <= 0
    || !isFiniteNumber(body.rounding_unit)
    || body.rounding_unit <= 0
  ) return false;

  const expectedKeys = [
    "mode",
    "tournament_id",
    "archetype",
    "min_cash_x",
    "rounding_unit",
    "entries_override",
    body.archetype === "CUSTOM" ? "custom_percents" : "itm_percent",
  ];
  if ("prize_pool_override" in body) expectedKeys.push("prize_pool_override");
  if (!exactObjectKeys(body, expectedKeys)) return false;
  if (
    "prize_pool_override" in body
    && (!isFiniteNumber(body.prize_pool_override) || body.prize_pool_override < 0)
  ) return false;
  if (body.archetype === "CUSTOM") {
    return JSON.stringify(body.custom_percents) === JSON.stringify([
      { position: 1, percent_bp: 5000 },
      { position: 2, percent_bp: 3000 },
      { position: 3, percent_bp: 2000 },
    ]);
  }
  return isFiniteNumber(body.itm_percent) && body.itm_percent > 0 && body.itm_percent <= 1;
}

function expectedBlockedBrowserRequestReason(request, policy = null) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const supabaseOrigin = `https://${PRODUCTION_REF}.supabase.co`;
  const actorId = policy?.actorId ?? policy?.ownerId ?? null;
  if (
    method === "POST"
    && url.origin === supabaseOrigin
    && url.pathname === "/functions/v1/report-vitals"
  ) return "expected_blocked_telemetry";
  if (
    ["GET", "HEAD"].includes(method)
    && url.origin === "https://cdn.onesignal.com"
    && url.pathname === "/sdks/web/v16/OneSignalSDK.page.js"
  ) return "expected_blocked_push_bootstrap";
  if (
    actorId
    && method === "PATCH"
    && url.origin === supabaseOrigin
    && url.pathname === "/rest/v1/profiles"
    && JSON.stringify([...url.searchParams.keys()].sort()) === JSON.stringify(["user_id"])
    && url.searchParams.get("user_id") === `eq.${actorId}`
    && exactObjectKeys(request.body, ["onesignal_external_user_id"])
    && request.body.onesignal_external_user_id === actorId
  ) return "expected_blocked_profile_push_link";
  if (
    method === "POST"
    && url.origin === supabaseOrigin
    && url.pathname === "/functions/v1/send-welcome-email"
    && (request.body == null || exactObjectKeys(request.body, []))
  ) return "expected_blocked_welcome_email";
  return null;
}

function safeBlockedBrowserRequestDetail(reason, request) {
  const method = /^[A-Z]{1,12}$/.test(request.method.toUpperCase())
    ? request.method.toUpperCase()
    : "UNKNOWN";
  const pathname = new URL(request.url).pathname;
  const safePath = /^\/[A-Za-z0-9_./-]{0,159}$/.test(pathname)
    ? pathname
    : `hash:${createHash("sha256").update(pathname).digest("hex").slice(0, 12)}`;
  return `reason=${reason} method=${method} path=${safePath}`;
}

function payoutBrowserRequestBlockReason(request, policy) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const baseOrigin = new URL(policy.baseUrl).origin;
  const supabaseOrigin = `https://${PRODUCTION_REF}.supabase.co`;
  const staticReadOrigins = new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
  if (staticReadOrigins.has(url.origin) && ["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (url.origin !== baseOrigin && url.origin !== supabaseOrigin) return "external_origin";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (url.origin !== supabaseOrigin) return "unexpected_mutation";

  const path = url.pathname;
  const body = request.body;
  if (method === "POST" && path === "/auth/v1/token") return null;
  if (
    method === "POST"
    && path === "/rest/v1/rpc/get_my_floor_operator_scope"
    && (body == null || exactObjectKeys(body, []))
  ) return null;
  if (
    method === "POST"
    && path === "/rest/v1/rpc/dealer_control_club_ids"
    && exactObjectKeys(body, ["_user_id"])
    && body._user_id === policy.ownerId
  ) return null;
  if (
    method === "POST"
    && path === "/rest/v1/rpc/get_tournament_prizes"
    && exactObjectKeys(body, ["p_tournament_id"])
    && body.p_tournament_id === policy.fixture.tournamentId
  ) return null;
  if (
    method === "POST"
    && path === "/functions/v1/tournament-live-draw"
    && exactObjectKeys(body, ["tournament_id", "action"])
    && body.tournament_id === policy.fixture.tournamentId
    && body.action === "get_seats"
  ) return null;
  if (
    method === "PATCH"
    && path === "/rest/v1/tournaments"
    && url.searchParams.get("id") === `eq.${policy.fixture.tournamentId}`
    && exactObjectKeys(body, [
      "planned_itm_percent",
      "planned_payout_archetype",
      "planned_min_cash_x",
      "planned_rounding_unit",
    ])
  ) return null;
  if (
    method === "POST"
    && path === "/rest/v1/payout_templates"
    && exactObjectKeys(body, [
      "club_id",
      "name",
      "archetype",
      "custom_percents",
      "itm_percent",
      "min_cash_x",
      "rounding_unit",
      "created_by",
    ])
    && body.club_id === policy.fixture.clubId
    && body.name === policy.templateName
    && body.archetype === "CUSTOM"
    && body.created_by === policy.ownerId
    && JSON.stringify(body.custom_percents) === JSON.stringify([
      { position: 1, percent_bp: 5000 },
      { position: 2, percent_bp: 3000 },
      { position: 3, percent_bp: 2000 },
    ])
  ) return null;
  if (
    method === "POST"
    && path === "/functions/v1/compute-payouts"
    && isExactPayoutPreviewBody(body, policy.fixture.tournamentId)
  ) return null;
  if (
    method === "POST"
    && path === "/rest/v1/rpc/close_tournament"
    && exactObjectKeys(body, ["p_tournament_id", "p_reason"])
    && body.p_tournament_id === policy.fixture.tournamentId
    && body.p_reason === "close_report"
  ) return null;
  return "unexpected_mutation";
}

function chipCasBrowserRequestBlockReason(request, policy) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const baseOrigin = new URL(policy.baseUrl).origin;
  const supabaseOrigin = `https://${PRODUCTION_REF}.supabase.co`;
  const staticReadOrigins = new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
  if (staticReadOrigins.has(url.origin) && ["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (url.origin !== baseOrigin && url.origin !== supabaseOrigin) return "external_origin";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return null;
  if (url.origin !== supabaseOrigin) return "unexpected_mutation";
  const path = url.pathname;
  const body = request.body;
  if (method === "POST" && path === "/auth/v1/token") return null;
  if (
    method === "POST"
    && path === "/rest/v1/rpc/get_my_floor_operator_scope"
    && (body == null || exactObjectKeys(body, []))
  ) return null;
  if (
    method === "POST"
    && path === "/rest/v1/rpc/dealer_control_club_ids"
    && exactObjectKeys(body, ["_user_id"])
    && body._user_id === policy.actorId
  ) return null;
  if (
    method === "POST"
    && path === "/rest/v1/rpc/get_tournament_prizes"
    && exactObjectKeys(body, ["p_tournament_id"])
    && body.p_tournament_id === policy.fixture.tournamentId
  ) return null;
  if (method === "POST" && path === "/functions/v1/tournament-live-draw") {
    if (
      exactObjectKeys(body, ["tournament_id", "action"])
      && body.tournament_id === policy.fixture.tournamentId
      && body.action === "get_seats"
    ) return null;
    const seat = Array.isArray(body?.seats) && body.seats.length === 1 ? body.seats[0] : null;
    if (
      exactObjectKeys(body, ["tournament_id", "action", "seats"])
      && body.tournament_id === policy.fixture.tournamentId
      && body.action === "update_seats"
      && exactObjectKeys(seat, [
        "seat_id",
        "player_id",
        "entry_number",
        "table_id",
        "seat_number",
        "chip_count",
        "expected_chip_count",
        "is_active",
        "player_name",
      ])
      && seat.seat_id === policy.seat.id
      && seat.player_id === policy.seat.player_id
      && seat.entry_number === policy.seat.entry_number
      && seat.table_id === policy.seat.table_id
      && seat.seat_number === policy.seat.seat_number
      && seat.expected_chip_count === policy.initialChip
      && policy.candidateChips.includes(seat.chip_count)
      && seat.is_active === true
      && seat.player_name === policy.seat.player_name
    ) return null;
  }
  return "unexpected_mutation";
}

async function installExactSupabaseWebSocketGuard(browserContext, blocked) {
  await browserContext.routeWebSocket(/.*/u, async (webSocketRoute) => {
    if (new URL(webSocketRoute.url()).hostname !== `${PRODUCTION_REF}.supabase.co`) {
      blocked.push("external_websocket");
      await webSocketRoute.close({ code: 1008, reason: "blocked" });
      return;
    }
    webSocketRoute.connectToServer();
  });
}

async function installChipCasEgressGuard(browserContext, policy) {
  const blocked = [];
  const expectedBlocked = [];
  await browserContext.route("**/*", async (route) => {
    const request = route.request();
    const requestSummary = {
      url: request.url(),
      method: request.method(),
      body: safeRequestJson(request),
    };
    const expectedReason = expectedBlockedBrowserRequestReason(requestSummary, policy);
    if (expectedReason) {
      expectedBlocked.push(expectedReason);
      await route.abort("blockedbyclient");
      return;
    }
    const reason = chipCasBrowserRequestBlockReason(requestSummary, policy);
    if (reason) {
      blocked.push(safeBlockedBrowserRequestDetail(reason, requestSummary));
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await installExactSupabaseWebSocketGuard(browserContext, blocked);
  return { blocked, expectedBlocked };
}

async function installPayoutEgressGuard(browserContext, policy) {
  const blocked = [];
  const expectedBlocked = [];
  await browserContext.route("**/*", async (route) => {
    const request = route.request();
    const requestSummary = {
      url: request.url(),
      method: request.method(),
      body: safeRequestJson(request),
    };
    const expectedReason = expectedBlockedBrowserRequestReason(requestSummary, policy);
    if (expectedReason) {
      expectedBlocked.push(expectedReason);
      await route.abort("blockedbyclient");
      return;
    }
    const reason = payoutBrowserRequestBlockReason(requestSummary, policy);
    if (reason) {
      blocked.push(safeBlockedBrowserRequestDetail(reason, requestSummary));
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  await installExactSupabaseWebSocketGuard(browserContext, blocked);
  return { blocked, expectedBlocked };
}

async function runFloorRoleAndViewportMatrix(browser, baseUrl, stateDirectory, actors, fixture) {
  const viewports = [
    { viewport: { width: 360, height: 800 }, suffix: "mobile_360", phone: true },
    { viewport: { width: 390, height: 844 }, suffix: "mobile_390", phone: true },
    { viewport: { width: 768, height: 1024 }, suffix: "tablet_portrait", phone: false },
    { viewport: { width: 1024, height: 768 }, suffix: "tablet_landscape", phone: false },
    { viewport: { width: 1280, height: 900 }, suffix: "desktop_1280", phone: false },
    { viewport: { width: 1920, height: 1080 }, suffix: "desktop_1920", phone: false },
  ];
  const roles = [
    { label: "anonymous", actor: null },
    { label: "owner", actor: actors.owner },
    { label: "cashier", actor: actors.cashier },
    { label: "floor", actor: actors.floor },
    { label: "cross", actor: actors.cross },
  ];
  for (const role of roles) {
    for (const viewport of viewports) {
      const browserContext = await browser.newContext({
        ...(role.actor ? { storageState: join(stateDirectory, `${role.label}.json`) } : {}),
        locale: CANARY_BROWSER_LOCALE,
        viewport: viewport.viewport,
      });
      try {
        const page = await browserContext.newPage();
        const evidenceName = `browser_role_viewport_${role.label}_${viewport.suffix}`;
        if (!role.actor) {
          await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" });
          result(evidenceName, page.url().includes("/auth"));
          continue;
        }
        if (viewport.phone) {
          await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" });
          const redirectedToOps = new URL(page.url()).pathname.startsWith("/ops");
          await page.goto(`${baseUrl}/ops/tables?tour=${fixture.tournamentId}`, { waitUntil: "networkidle" });
          const tablesSurface = await page.getByRole("heading", { name: "Bàn", exact: true }).count() === 1;
          const primaryVisible = await page.getByText(fixture.tournamentName, { exact: true }).count() > 0
            || await page.getByText(fixture.seats[0].player_name, { exact: true }).count() > 0;
          result(
            evidenceName,
            redirectedToOps && tablesSurface && (role.label === "cross" ? !primaryVisible : primaryVisible),
          );
          continue;
        }
        if (role.label === "cross") {
          await page.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" });
          result(
            evidenceName,
            !page.url().includes("/auth")
              && await page.getByRole("button", { name: "Giải thường", exact: true }).count() === 1
              && await page.getByRole("button", { name: fixture.tournamentName, exact: true }).count() === 0,
          );
          continue;
        }
        await selectOwnedFloorTournament(page, baseUrl, fixture);
        result(
          evidenceName,
          !page.url().includes("/auth")
            && await page.getByRole("tab", { name: "Sơ đồ bàn", exact: true }).count() === 1
            && await page.getByRole("tab", { name: "Giải thưởng", exact: true }).count() === 1,
        );
      } finally {
        await browserContext.close();
      }
    }
  }
}

async function openOwnedChipDialog(page, baseUrl, fixture, seat) {
  await selectOwnedFloorTournament(page, baseUrl, fixture);
  if (!fixture.tableName.startsWith(`${fixture.runId}_${fixture.scenario}_`)) {
    fail("browser_chip_table_ownership_invalid");
  }
  console.log("FLOOR_CANARY BROWSER_CHIP_PHASE phase=owned_tournament_selected");
  const tableButton = page.getByTitle(new RegExp(`^${escapeRegex(fixture.tableName)} ·`, "u")).first();
  await tableButton.waitFor({ state: "visible", timeout: 15_000 });
  await tableButton.click();
  console.log("FLOOR_CANARY BROWSER_CHIP_PHASE phase=owned_table_selected");
  const seatButton = page.getByRole("button", {
    name: new RegExp(escapeRegex(seat.player_name), "u"),
  }).first();
  await seatButton.waitFor({ state: "visible", timeout: 15_000 });
  await seatButton.click();
  console.log("FLOOR_CANARY BROWSER_CHIP_PHASE phase=owned_seat_selected");
  const editChipButton = page.getByRole("button", { name: /^Sửa chip(?:\s|$)/u }).first();
  await editChipButton.waitFor({ state: "visible", timeout: 15_000 });
  await editChipButton.click({ timeout: 15_000 });
  console.log("FLOOR_CANARY BROWSER_CHIP_PHASE phase=edit_chip_selected");
  const dialog = page.getByRole("dialog", { name: new RegExp(`Sửa chip.*${escapeRegex(seat.player_name)}`, "u") });
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  console.log("FLOOR_CANARY BROWSER_CHIP_PHASE phase=chip_dialog_ready");
  return dialog;
}

async function runBrowserChipCasConcurrency(browser, baseUrl, stateDirectory, admin, actors, fixture) {
  if (!fixture.runId.startsWith(CLEANUP_SCOPE_PREFIX) || fixture.scenario !== "CONCURRENCY") {
    fail("browser_chip_cas_fixture_ownership_invalid");
  }
  const seat = await single(
    admin.from("tournament_seats")
      .select("id,tournament_id,player_id,entry_number,table_id,seat_number,chip_count,is_active,player_name")
      .eq("id", fixture.seats[0].id),
    "browser_chip_cas_initial_seat",
  );
  result(
    "browser_chip_cas_initial_owned_snapshot",
    seat.tournament_id === fixture.tournamentId
      && seat.player_id === fixture.seats[0].player_id
      && seat.is_active === true,
  );
  const initialChip = Number(seat.chip_count);
  const candidateChips = [initialChip + 101, initialChip + 202];
  const policy = { baseUrl, fixture, seat, initialChip, candidateChips, actorId: actors.floor.id };
  const contexts = [];
  const blocked = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const context = await browser.newContext({
        storageState: join(stateDirectory, "floor.json"),
        locale: CANARY_BROWSER_LOCALE,
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      });
      contexts.push(context);
      blocked.push(await installChipCasEgressGuard(context, policy));
    }
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const dialogs = await Promise.all(pages.map((page) => openOwnedChipDialog(page, baseUrl, fixture, seat)));
    const inputs = dialogs.map((dialog) => dialog.getByRole("spinbutton"));
    const snapshots = await Promise.all(inputs.map((input) => input.inputValue()));
    result("browser_chip_cas_two_context_same_snapshot", snapshots.every((value) => Number(value) === initialChip));
    await Promise.all(inputs.map((input, index) => input.fill(String(candidateChips[index]))));
    const responsePromises = pages.map((page) => page.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/functions/v1/tournament-live-draw"
    )));
    await Promise.all(dialogs.map((dialog) => dialog.getByRole("button", { name: "Lưu chip", exact: true }).click()));
    const responses = await Promise.all(responsePromises);
    result(
      "browser_chip_cas_concurrent_one_wins",
      responses.map((response) => response.status()).sort((a, b) => a - b).join(",") === "200,409",
      responses.map(safeBrowserResponseDetail).join(" "),
    );
    await pages[0].waitForTimeout(500);
    const visibleDialogs = (await Promise.all(dialogs.map((dialog) => dialog.isVisible()))).filter(Boolean).length;
    result("browser_chip_cas_stale_dialog_remains", visibleDialogs === 1);
    const finalSeat = await single(
      admin.from("tournament_seats").select("id,chip_count,is_active").eq("id", seat.id),
      "browser_chip_cas_final_seat",
    );
    const graph = await activeSeatGraph(admin, fixture, "browser_chip_cas_final_graph");
    const other = graph.rows.find((row) => row.id === fixture.seats[1].id);
    result(
      "browser_chip_cas_db_invariant",
      candidateChips.includes(Number(finalSeat.chip_count))
        && finalSeat.is_active === true
        && graph.rows.length === 2
        && Number(other?.chip_count) === Number(fixture.seats[1].chip_count),
    );
    const forbiddenEgress = blocked.flatMap((guard) => guard.blocked);
    result(
      "browser_chip_cas_forbidden_egress_zero",
      forbiddenEgress.length === 0,
      [...new Set(forbiddenEgress)].join(","),
    );
    result(
      "browser_chip_cas_known_non_audit_egress_blocked",
      blocked.flatMap((guard) => guard.expectedBlocked).every((reason) => reason.startsWith("expected_blocked_")),
    );
    await assertTournamentMoneyZero(admin, fixture, "browser_chip_cas_no_money_side_effect");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

async function runPayoutAndCloseBrowserFlow(browser, baseUrl, stateDirectory, actors, fixture) {
  const templateName = `${fixture.runId}_PAYOUT_BROWSER_TEMPLATE`;
  if (!templateName.startsWith(CLEANUP_SCOPE_PREFIX)) fail("browser_payout_template_prefix_invalid");
  const payoutPolicy = { baseUrl, fixture, templateName, ownerId: actors.owner.id };

  const tabletContext = await browser.newContext({
    storageState: join(stateDirectory, "owner.json"),
    locale: CANARY_BROWSER_LOCALE,
    viewport: { width: 1024, height: 768 },
    serviceWorkers: "block",
  });
  const tabletBlocked = await installPayoutEgressGuard(tabletContext, payoutPolicy);
  try {
    const page = await tabletContext.newPage();
    await selectOwnedFloorTournament(page, baseUrl, fixture);
    await page.getByRole("tab", { name: "Giải thưởng", exact: true }).click();
    await page.getByRole("button", { name: "Xem trước (Dự kiến)", exact: true }).waitFor({ state: "visible", timeout: 15_000 });

    await page.getByRole("spinbutton", { name: "ITM %", exact: true }).fill("50");
    await page.getByRole("spinbutton", { name: "Min-cash ×", exact: true }).fill("1");
    await page.getByRole("spinbutton", { name: "Làm tròn (đ)", exact: true }).fill("1");
    const plannedResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "PATCH" && new URL(response.url()).pathname === "/rest/v1/tournaments"
    ));
    await page.getByRole("button", { name: "Lưu mặc định cho giải này", exact: true }).click();
    const plannedResponse = await plannedResponsePromise;
    result("browser_payout_planned_save_clicked", plannedResponse.ok(), safeBrowserResponseDetail(plannedResponse));

    const previewResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/functions/v1/compute-payouts")
    ));
    await page.getByRole("button", { name: "Xem trước (Dự kiến)", exact: true }).click();
    const previewResponse = await previewResponsePromise;
    result("browser_payout_preview_clicked", previewResponse.ok(), safeBrowserResponseDetail(previewResponse));
    await page.getByText(/^DỰ KIẾN/u).first().waitFor({ state: "visible", timeout: 15_000 });

    const styleControl = page.getByText("Kiểu giải", { exact: true }).locator("..").getByRole("combobox");
    await styleControl.click();
    await page.getByRole("option", { name: /^CUSTOM — CLB tự cấu hình$/u }).click();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Tải file (Excel/CSV)", exact: true }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: "floor-payout.csv", mimeType: "text/csv", buffer: Buffer.from("50\n30\n20\n") });
    await page.getByText(/Đã nạp 3 hạng từ file/u).waitFor({ state: "visible", timeout: 15_000 });

    await page.getByPlaceholder("Tên mẫu", { exact: true }).fill(templateName);
    const templateResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST" && new URL(response.url()).pathname === "/rest/v1/payout_templates"
    ));
    await page.getByRole("button", { name: "Lưu mẫu", exact: true }).click();
    const templateResponse = await templateResponsePromise;
    result("browser_payout_template_save_clicked", templateResponse.ok(), safeBrowserResponseDetail(templateResponse));
    const templateButton = page.getByRole("button", { name: templateName, exact: true });
    await templateButton.waitFor({ state: "visible", timeout: 15_000 });
    await templateButton.click();
    await page.getByText(new RegExp(`Đã nạp mẫu "${escapeRegex(templateName)}"`, "u")).waitFor({ state: "visible", timeout: 15_000 });
    result("browser_payout_template_load_clicked", true);

    const runCurrentPreview = async (evidenceName) => {
      const responsePromise = page.waitForResponse((response) => (
        response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/functions/v1/compute-payouts")
      ));
      await page.getByRole("button", { name: "Xem trước (Dự kiến)", exact: true }).click();
      const response = await responsePromise;
      result(evidenceName, response.ok(), safeBrowserResponseDetail(response));
    };
    await runCurrentPreview("browser_payout_custom_preview_clicked");

    const entryControl = page.getByText(/^Số entry/u).first().locator("..").getByRole("spinbutton");
    await entryControl.fill("12");
    await styleControl.click();
    await page.getByRole("option", { name: /^MULTI/u }).click();
    await runCurrentPreview("browser_payout_multi_banded_preview_clicked");
    await styleControl.click();
    await page.getByRole("option", { name: /^INTL/u }).click();
    await runCurrentPreview("browser_payout_intl_banded_preview_clicked");

    const official = page.getByRole("button", { name: /^(Đóng đăng ký & tạo payout|Tạo payout chính thức)$/u });
    result("browser_payout_official_excluded", await official.count() === 1 && await official.isEnabled());

    await page.getByRole("button", { name: "Chốt giải", exact: true }).click();
    const cancelDialog = page.getByRole("dialog", { name: "Chốt giải" });
    await cancelDialog.getByRole("button", { name: "Huỷ", exact: true }).click();
    await cancelDialog.waitFor({ state: "hidden", timeout: 15_000 });
    result("browser_close_report_cancel_clicked", true);
    result("browser_payout_tablet_forbidden_egress_zero", tabletBlocked.blocked.length === 0);
    result(
      "browser_payout_tablet_known_non_audit_egress_blocked",
      tabletBlocked.expectedBlocked.every((reason) => reason.startsWith("expected_blocked_")),
    );
  } finally {
    await tabletContext.close();
  }

  const desktopContext = await browser.newContext({
    storageState: join(stateDirectory, "owner.json"),
    locale: CANARY_BROWSER_LOCALE,
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
  });
  const desktopBlocked = await installPayoutEgressGuard(desktopContext, payoutPolicy);
  try {
    const page = await desktopContext.newPage();
    await selectOwnedFloorTournament(page, baseUrl, fixture);
    await page.getByRole("button", { name: "Chốt giải", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Chốt giải" });
    await dialog.getByRole("button", { name: "Tiếp tục", exact: true }).click();
    await dialog.getByRole("button", { name: "Quay lại", exact: true }).click();
    await dialog.getByRole("button", { name: "Tiếp tục", exact: true }).click();
    await dialog.getByPlaceholder("CHOT GIAI", { exact: true }).fill("CHOT GIAI");
    const closeResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/rest/v1/rpc/close_tournament")
    ));
    await dialog.getByRole("button", { name: "Chốt giải", exact: true }).click();
    const closeResponse = await closeResponsePromise;
    result("browser_close_report_confirm_clicked", closeResponse.ok(), safeBrowserResponseDetail(closeResponse));
    await dialog.waitFor({ state: "hidden", timeout: 15_000 });
    result("browser_payout_desktop_forbidden_egress_zero", desktopBlocked.blocked.length === 0);
    result(
      "browser_payout_desktop_known_non_audit_egress_blocked",
      desktopBlocked.expectedBlocked.every((reason) => reason.startsWith("expected_blocked_")),
    );
  } finally {
    await desktopContext.close();
  }
}

function browserIsOnAuthRoute(page) {
  return new URL(page.url()).pathname === "/auth";
}

async function waitForSignInNavigation(page) {
  try {
    await page.waitForURL((url) => new URL(url).pathname === "/", { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

async function navigateAuthenticatedOps(page, baseUrl) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${baseUrl}/ops`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const appHome = page.getByRole("button", { name: "App chính", exact: true });
    for (let poll = 1; poll <= 30; poll += 1) {
      if (await appHome.isVisible()) return true;
      if (browserIsOnAuthRoute(page)) break;
      await page.waitForTimeout(500);
    }
    if (attempt < 3) await page.waitForTimeout(attempt * 500);
  }
  return false;
}

async function resolveCashierRouteAccess(page, baseUrl, expectedAccess, roleLabel) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.goto(`${baseUrl}/ops/cashier`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const allowedControl = page.getByRole("button", { name: "Hàng chờ", exact: true });
    const deniedGuard = page.getByText("Không có quyền Cashier", { exact: true });
    const scopeError = page.getByText("Không tải được phạm vi Cashier", { exact: true });
    const clubUnassigned = page.getByText("Chưa được phân công CLB", { exact: true });
    const dataError = page.getByText("Không tải được", { exact: true });
    const opsDenied = page.getByText("Bạn chưa có quyền Vận hành", { exact: true });
    for (let poll = 1; poll <= 30; poll += 1) {
      let outcome = null;
      if (browserIsOnAuthRoute(page)) outcome = "auth";
      else if (await allowedControl.isVisible()) outcome = "allowed";
      else if (await deniedGuard.isVisible()) outcome = "cashier_denied";
      else if (await scopeError.isVisible()) outcome = "scope_error";
      else if (await clubUnassigned.isVisible()) outcome = "club_unassigned";
      else if (await dataError.isVisible()) outcome = "data_error";
      else if (await opsDenied.isVisible()) outcome = "ops_denied";

      if (outcome) {
        console.log(`FLOOR_CANARY BROWSER_CASHIER_ROUTE role=${roleLabel} outcome=${outcome}`);
        return {
          passed: expectedAccess ? outcome === "allowed" : outcome === "cashier_denied",
          outcome,
        };
      }
      await page.waitForTimeout(500);
    }
    if (attempt < 3) await page.waitForTimeout(attempt * 500);
  }
  console.log(`FLOOR_CANARY BROWSER_CASHIER_ROUTE role=${roleLabel} outcome=unresolved`);
  return { passed: false, outcome: "unresolved" };
}

async function runBrowserManifest(admin, actors, fixtures) {
  if (process.env.FLOOR_CANARY_RUN_BROWSER !== "true") {
    fail("browser_audit_required_for_run_mode");
  }
  const { chromium } = await import("@playwright/test");
  const stateDirectory = await mkdtemp(join(tmpdir(), "floor-canary-"));
  await chmod(stateDirectory, 0o700);
  const baseUrl = productionBaseUrl();
  const browser = await chromium.launch({ headless: true });
  try {
    const access = fixtures.get("ACCESS");
    const lifecycle = fixtures.get("TABLE_LIFECYCLE");
    const payoutClose = fixtures.get("PAYOUT_CLOSE");
    const concurrency = fixtures.get("CONCURRENCY");
    if (!access || !lifecycle || !payoutClose || !concurrency) fail("browser_required_scenarios_missing");
    for (const actor of [actors.owner, actors.cashier, actors.floor, actors.cross]) {
      const context = await browser.newContext({ locale: CANARY_BROWSER_LOCALE });
      try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
        const emailInput = page.locator('input[type="email"]');
        const passwordInput = page.locator('input[type="password"]');
        result(`browser_login_email_input_${actor.label}`, await emailInput.count() === 1);
        result(`browser_login_password_input_${actor.label}`, await passwordInput.count() === 1);
        await emailInput.fill(actor.email);
        await passwordInput.fill(actor.password);
        const signIn = page.getByRole("button", { name: CANARY_SIGN_IN_LABEL, exact: true });
        result(`browser_login_button_${actor.label}`, await signIn.count() === 1);
        const signInNavigation = waitForSignInNavigation(page);
        await signIn.click();
        const signInSucceeded = await signInNavigation;
        result(`browser_signin_navigation_${actor.label}`, signInSucceeded);
        const opsAuthenticated = signInSucceeded && await navigateAuthenticatedOps(page, baseUrl);
        result(`browser_ops_authenticated_${actor.label}`, opsAuthenticated);
        if (actor.label === "floor") {
          const cashierRoute = await resolveCashierRouteAccess(page, baseUrl, false, actor.label);
          result("browser_floor_cashier_direct_url_requires_guard", cashierRoute.passed);
        }
        if (actor.label === "cross") {
          result("browser_cross_actor_owns_only_test_cross_club", !page.url().endsWith("/auth"));
          await page.goto(`${baseUrl}/ops/tables?tour=${access.tournamentId}`, { waitUntil: "networkidle" });
          result(
            "browser_cross_club_direct_tournament_denied",
            await page.getByText(access.tournamentName, { exact: true }).count() === 0
              && await page.getByText(access.seats[0].player_name, { exact: true }).count() === 0,
          );
        }
        if (actor.label === "owner" || actor.label === "cashier") {
          const cashierRoute = await resolveCashierRouteAccess(page, baseUrl, true, actor.label);
          result(
            `browser_cashier_route_allowed_${actor.label}`,
            cashierRoute.passed,
          );
        }
        await page.goto(`${baseUrl}/ops/tournaments`, { waitUntil: "networkidle" });
        await page.reload({ waitUntil: "networkidle" });
        result(`browser_refresh_session_${actor.label}`, !page.url().endsWith("/auth"));
        await page.goto(`${baseUrl}/ops`, { waitUntil: "networkidle" });
        await page.goBack({ waitUntil: "networkidle" });
        await page.goForward({ waitUntil: "networkidle" });
        result(`browser_history_session_${actor.label}`, !page.url().endsWith("/auth"));
        const statePath = join(stateDirectory, `${actor.label}.json`);
        await context.storageState({ path: statePath });
        await chmod(statePath, 0o600);
      } finally {
        await context.close();
      }
    }

    const anonymousContext = await browser.newContext({ locale: CANARY_BROWSER_LOCALE });
    try {
      const anonymousPage = await anonymousContext.newPage();
      await anonymousPage.goto(`${baseUrl}/ops`, { waitUntil: "networkidle" });
      result("browser_anonymous_ops_redirects_auth", anonymousPage.url().includes("/auth"));
      await anonymousPage.goto(`${baseUrl}/floor`, { waitUntil: "networkidle" });
      result("browser_anonymous_floor_redirects_auth", anonymousPage.url().includes("/auth"));
      await anonymousPage.goto(`${baseUrl}/tv/${access.tournamentId}`, { waitUntil: "networkidle" });
      result("browser_public_tv_reachable", !anonymousPage.url().includes("/auth"));
    } finally {
      await anonymousContext.close();
    }

    const routeAssignments = JSON.stringify([
      { route: "/ops/tournaments", role: "owner" },
      { route: "/ops/cashier", role: "owner" },
      { route: "/ops/cashier", role: "cashier" },
      { route: `/ops/tables?tour=${lifecycle.tournamentId}`, manifestRoute: "/ops/tables", role: "floor" },
      { route: `/ops/tournaments/${access.tournamentId}`, manifestRoute: "/ops/tournaments/:id", role: "floor" },
      {
        route: "/floor",
        role: "owner",
        ownedTournamentName: payoutClose.tournamentName,
        tabName: "Giải thưởng",
        viewports: ["tablet-portrait", "tablet-landscape", "desktop-1280x900", "desktop-1920"],
      },
      { route: `/tv/${access.tournamentId}`, manifestRoute: "/tv/:tournamentId", role: "anonymous" },
    ]);
    const exitCode = await runCommand(
      "npx",
      ["playwright", "test", "e2e/floor-button-coverage.spec.ts", "--project", "chromium"],
      browserChildEnvironment(baseUrl, stateDirectory, routeAssignments),
    );
    result("browser_button_manifest", exitCode === 0);
    await runFloorRoleAndViewportMatrix(browser, baseUrl, stateDirectory, actors, access);
    await runBrowserChipCasConcurrency(browser, baseUrl, stateDirectory, admin, actors, concurrency);
    await runPayoutAndCloseBrowserFlow(browser, baseUrl, stateDirectory, actors, payoutClose);
  } finally {
    await browser.close();
    await rm(stateDirectory, { recursive: true, force: true });
  }
}

async function deleteExact(client, table, ids, code) {
  if (ids.length === 0) return;
  const deletion = await client.from(table).delete().in("id", ids);
  if (deletion.error) throw new Error(`${code}:${safeDbErrorDetail(deletion.error)}`);
}

async function verifyExactRows(client, table, ids, code) {
  if (ids.length === 0) return;
  const remaining = await client.from(table).select("id", { count: "exact", head: true }).in("id", ids);
  if (remaining.error) throw new Error(`${code}:${safeDbErrorDetail(remaining.error)}`);
  if ((remaining.count ?? 0) !== 0) throw new Error(`${code}:remaining=${remaining.count}`);
}

async function deleteByColumnExact(client, table, column, values, code) {
  if (values.length === 0) return;
  const deletion = await client.from(table).delete().in(column, values);
  if (deletion.error) throw new Error(`${code}:${safeDbErrorDetail(deletion.error)}`);
}

async function verifyByColumnExact(client, table, column, values, code) {
  if (values.length === 0) return;
  const remaining = await client.from(table).select(column, { count: "exact", head: true }).in(column, values);
  if (remaining.error) throw new Error(`${code}:${safeDbErrorDetail(remaining.error)}`);
  if ((remaining.count ?? 0) !== 0) throw new Error(`${code}:remaining=${remaining.count}`);
}

async function remainingExactIds(client, table, ids, code) {
  if (ids.length === 0) return [];
  const response = await client.from(table).select("id").in("id", ids);
  if (response.error || !Array.isArray(response.data)) throw new Error(`${code}:${safeDbErrorDetail(response.error)}`);
  return response.data.map((row) => row.id).filter((id) => typeof id === "string");
}

async function deleteBatchOnce(client, table, ids, code) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await client.from(table).delete().in("id", ids).select("id").abortSignal(controller.signal);
    if (response.error || !Array.isArray(response.data)) throw new Error(`${code}:${safeDbErrorDetail(response.error)}`);
    const deletedIds = response.data.map((row) => row.id).filter((id) => typeof id === "string");
    if (deletedIds.length > ids.length || deletedIds.some((id) => !ids.includes(id))) throw new Error(`${code}:affected_scope_mismatch`);
    return deletedIds;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function deleteExactBatches(client, table, ids, code) {
  const queue = [];
  const uniqueIds = [...new Set(ids)];
  for (let offset = 0; offset < uniqueIds.length; offset += CLEANUP_GAME_TABLE_BATCH_SIZE) {
    queue.push({ ids: uniqueIds.slice(offset, offset + CLEANUP_GAME_TABLE_BATCH_SIZE), attempt: 1 });
  }
  let deletedCount = 0;
  while (queue.length > 0) {
    const batch = queue.shift();
    try {
      const deleted = await deleteBatchOnce(client, table, batch.ids, code);
      const remaining = await remainingExactIds(client, table, batch.ids, `${code}_verify_batch`);
      if (remaining.length !== 0) throw new Error(`${code}:remaining=${remaining.length}`);
      deletedCount += deleted.length;
      console.log(`FLOOR_CANARY CLEANUP_BATCH table=${table} count=${batch.ids.length} ids_hash=${hashIds(batch.ids)} attempt=${batch.attempt}`);
    } catch (error) {
      const remaining = await remainingExactIds(client, table, batch.ids, `${code}_requery_after_error`);
      deletedCount += batch.ids.length - remaining.length;
      if (remaining.length === 0) continue;
      console.log(`FLOOR_CANARY CLEANUP_BATCH_RETRY table=${table} remaining=${remaining.length} ids_hash=${hashIds(remaining)} attempt=${batch.attempt}`);
      if (batch.attempt >= CLEANUP_MAX_BATCH_ATTEMPTS) {
        const detail = error instanceof Error ? error.message : "unknown";
        throw new Error(`${code}:bounded_retries_exhausted:missing_index=${CLEANUP_SLOW_FK}:${detail}`);
      }
      const nextAttempt = batch.attempt + 1;
      const smallerSize = nextAttempt === CLEANUP_MAX_BATCH_ATTEMPTS
        ? 1
        : Math.max(1, Math.ceil(remaining.length / 2));
      for (let offset = 0; offset < remaining.length; offset += smallerSize) {
        queue.unshift({ ids: remaining.slice(offset, offset + smallerSize), attempt: nextAttempt });
      }
    }
  }
  return deletedCount;
}

async function deleteExactAuthUser(admin, userId, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let lastFailure = "unknown";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let deleted;
    try {
      deleted = await admin.auth.admin.deleteUser(userId);
    } catch {
      lastFailure = "delete_auth_transport";
      if (attempt === 3) throw new Error(lastFailure);
      console.log(`FLOOR_CANARY CLEANUP_AUTH_RETRY id_hash=${actorHash(userId)} attempt=${attempt}`);
      await sleep(attempt * 250);
      continue;
    }
    if (!deleted.error) return;
    lastFailure = safeAuthErrorDetail(deleted.error);
    let fetched;
    try {
      fetched = await admin.auth.admin.getUserById(userId);
    } catch {
      lastFailure = "verify_auth_transport";
      if (attempt === 3) throw new Error(lastFailure);
      console.log(`FLOOR_CANARY CLEANUP_AUTH_RETRY id_hash=${actorHash(userId)} attempt=${attempt}`);
      await sleep(attempt * 250);
      continue;
    }
    if (fetched.error?.status === 404 || fetched.error?.code === "user_not_found" || !fetched.data?.user) return;
    if (attempt === 3) throw new Error(lastFailure);
    console.log(`FLOOR_CANARY CLEANUP_AUTH_RETRY id_hash=${actorHash(userId)} attempt=${attempt}`);
    await sleep(attempt * 250);
  }
}

async function deleteExactAuthUsersBestEffort(admin, userIds, sleep) {
  const failures = [];
  for (const userId of userIds) {
    try {
      await deleteExactAuthUser(admin, userId, sleep);
    } catch {
      failures.push(`delete:${actorHash(userId)}`);
    }
  }
  for (const userId of userIds) {
    try {
      await verifyExactAuthUsersDeleted(admin, [userId]);
    } catch {
      failures.push(`verify:${actorHash(userId)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`cleanup_auth_users_incomplete:${failures.join(",")}`);
  }
}

async function cleanupExactLedger(admin, ledger) {
  const failures = [];
  const deletedCounts = {};
  const attempt = async (name, action) => {
    try {
      const deleted = await action();
      if (Number.isInteger(deleted)) deletedCounts[name] = (deletedCounts[name] ?? 0) + deleted;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      failures.push(`${name}:${detail}`);
      console.log(`FLOOR_CANARY CLEANUP_FAIL step=${name} detail=${detail}`);
    }
  };

  // Child-to-parent order is derived from the checked-in FK inventory. Every
  // mutation uses exact IDs captured in this run group's in-memory ledger.
  for (const [table, ids] of Object.entries(ledger.childRows)) {
    await attempt(table, async () => {
      await deleteExact(admin, table, ids, `cleanup_${table}`);
      return ids.length;
    });
  }
  await attempt("seats", async () => { await deleteExact(admin, "tournament_seats", ledger.seats, "cleanup_seats"); return ledger.seats.length; });
  await attempt("entries", async () => { await deleteExact(admin, "tournament_entries", ledger.entries, "cleanup_entries"); return ledger.entries.length; });
  await attempt("tournament_tables", async () => { await deleteExact(admin, "tournament_tables", ledger.tournamentTableIds, "cleanup_tournament_tables"); return ledger.tournamentTableIds.length; });
  await attempt("levels", async () => { await deleteExact(admin, "tournament_levels", ledger.levels, "cleanup_levels"); return ledger.levels.length; });
  await attempt("tournaments", async () => { await deleteExact(admin, "tournaments", ledger.tournamentIds, "cleanup_tournaments"); return ledger.tournamentIds.length; });
  await attempt("swing_config_audit", async () => {
    const generatedAuditIds = await idsByColumn(admin, "swing_config_audit", "club_id", ledger.clubIds, "cleanup_generated_audit");
    ledger.auditRows = generatedAuditIds;
    await deleteExact(admin, "swing_config_audit", generatedAuditIds, "cleanup_swing_config_audit");
    return generatedAuditIds.length;
  });
  await attempt("cashier_memberships", async () => { await deleteByColumnExact(admin, "club_cashiers", "club_id", ledger.clubIds, "cleanup_cashier_memberships"); return ledger.cashierMemberships.length; });
  await attempt("floor_memberships", async () => { await deleteByColumnExact(admin, "club_floors", "club_id", ledger.clubIds, "cleanup_floor_memberships"); return ledger.floorMemberships.length; });
  await attempt("game_tables", () => deleteExactBatches(admin, "game_tables", ledger.gameTableIds, "cleanup_game_tables"));
  await attempt("audit_logs", async () => {
    const auditLogIds = await idsByColumn(admin, "audit_logs", "club_id", ledger.clubIds, "cleanup_scope_audit_logs");
    ledger.auditLogIds = auditLogIds;
    await deleteExact(admin, "audit_logs", auditLogIds, "cleanup_audit_logs");
    return auditLogIds.length;
  });
  await attempt("clubs", async () => { await deleteExact(admin, "clubs", ledger.clubIds, "cleanup_clubs"); return ledger.clubIds.length; });
  for (const [index, userId] of ledger.authUserIds.entries()) {
    await attempt(`auth_user_${index}`, async () => {
      await deleteExactAuthUser(admin, userId);
      return 1;
    });
  }

  for (const [table, ids] of Object.entries(ledger.childRows)) {
    await attempt(`verify_${table}`, () => verifyExactRows(admin, table, ids, `verify_${table}`));
  }
  await attempt("verify_seats", () => verifyExactRows(admin, "tournament_seats", ledger.seats, "verify_seats"));
  await attempt("verify_entries", () => verifyExactRows(admin, "tournament_entries", ledger.entries, "verify_entries"));
  await attempt("verify_levels", () => verifyExactRows(admin, "tournament_levels", ledger.levels, "verify_levels"));
  await attempt("verify_tournament_tables", () => verifyExactRows(admin, "tournament_tables", ledger.tournamentTableIds, "verify_tournament_tables"));
  await attempt("verify_tournaments", () => verifyExactRows(admin, "tournaments", ledger.tournamentIds, "verify_tournaments"));
  await attempt("verify_game_tables", () => verifyExactRows(admin, "game_tables", ledger.gameTableIds, "verify_game_tables"));
  await attempt("verify_audit_rows", () => verifyExactRows(admin, "swing_config_audit", ledger.auditRows, "verify_audit_rows"));
  await attempt("verify_audit_logs", () => verifyExactRows(admin, "audit_logs", ledger.auditLogIds ?? [], "verify_audit_logs"));
  await attempt("verify_cashier_memberships", () => verifyByColumnExact(admin, "club_cashiers", "club_id", ledger.clubIds, "verify_cashier_memberships"));
  await attempt("verify_floor_memberships", () => verifyByColumnExact(admin, "club_floors", "club_id", ledger.clubIds, "verify_floor_memberships"));
  await attempt("verify_clubs", () => verifyExactRows(admin, "clubs", ledger.clubIds, "verify_clubs"));
  await attempt("verify_auth_users", async () => {
    await verifyExactAuthUsersDeleted(admin, ledger.authUserIds);
  });
  await attempt("verify_money_rows", () => moneySafetyPreflight(admin, ledger));
  if (failures.length > 0) {
    console.log(`FLOOR CANARY CLEANUP FAIL - REMAINING_ROWS failures=${failures.length}`);
    fail(`FLOOR CANARY CLEANUP FAIL - REMAINING_ROWS:${failures.join(",")}`);
  }
  for (const [table, count] of Object.entries(deletedCounts)) {
    console.log(`FLOOR_CANARY CLEANUP_DELETED run_hash=${actorHash(ledger.runId)} object=${table} count=${count}`);
  }
  console.log(`FLOOR_CANARY CLEANUP_GROUP_PASS run_hash=${actorHash(ledger.runId)} users=${ledger.authUserIds.length} clubs=${ledger.clubIds.length} tournaments=${ledger.tournamentIds.length} game_tables=${ledger.gameTableIds.length}`);
  return deletedCounts;
}

async function cleanupCurrentRun(admin, anonKey, url, runId, owned) {
  const clubIds = [...new Set(owned.clubs)];
  const recoveredActors = await recoverAttemptedAuthUserIds(anonKey, url, owned);
  const userIds = recoveredActors.ids;
  if (clubIds.some((id) => !UUID_RE.test(id)) || userIds.some((id) => !UUID_RE.test(id))) {
    fail("cleanup_current_run_invalid_owned_id");
  }
  if (clubIds.length === 0) {
    const exactUsers = await validateExactAuthUserIds(admin, runId, userIds, { allowPartial: true });
    await deleteExactAuthUsersBestEffort(admin, exactUsers);
    if (recoveredActors.unresolvedRoles.length > 0) {
      console.log(`FLOOR_CANARY CLEANUP_INCOMPLETE object=auth_user unresolved_roles=${recoveredActors.unresolvedRoles.length}`);
      fail("FLOOR_PRODUCTION_CANARY_FAIL_CLEANUP_INCOMPLETE:auth_response_ambiguous");
    }
    console.log(`FLOOR_CANARY CLEANUP_PASS users=${exactUsers.length} clubs=0 tournaments=0`);
    return;
  }

  const response = await admin.from("clubs").select("id,name,region,owner_id").in("id", clubIds);
  if (response.error || !Array.isArray(response.data)) {
    fail("cleanup_current_run_club_scope");
  }
  const clubAttempts = new Map(owned.clubAttempts.map((attempt) => [attempt.id, attempt]));
  if (clubAttempts.size !== clubIds.length) fail("cleanup_current_run_club_attempt_scope");
  const clubs = response.data.map((row) => {
    const expected = clubAttempts.get(row.id);
    if (
      !expected
      || row.name !== expected.name
      || row.region !== expected.region
      || row.owner_id !== expected.ownerId
    ) {
      fail("cleanup_current_run_club_identity");
    }
    return { id: row.id, ownerId: row.owner_id, runId, scenario: row.name.slice(runId.length + 1) };
  });
  if (clubs.length > 0) {
    const ledger = await buildCleanupLedger(admin, { runId, clubs }, userIds);
    await moneySafetyPreflight(admin, ledger, true);
    await cleanupExactLedger(admin, ledger);
  } else {
    const exactUsers = await validateExactAuthUserIds(admin, runId, userIds, { allowPartial: true });
    await deleteExactAuthUsersBestEffort(admin, exactUsers);
  }
  await verifyExactRows(admin, "clubs", clubIds, "verify_current_run_clubs");
  await verifyExactAuthUsersDeleted(admin, userIds);
  if (recoveredActors.unresolvedRoles.length > 0) {
    console.log(`FLOOR_CANARY CLEANUP_INCOMPLETE object=auth_user unresolved_roles=${recoveredActors.unresolvedRoles.length}`);
    fail("FLOOR_PRODUCTION_CANARY_FAIL_CLEANUP_INCOMPLETE:auth_response_ambiguous");
  }
  console.log(`FLOOR_CANARY CLEANUP_PASS users=${userIds.length} club_attempts=${clubIds.length}`);
}

async function runCleanupCanary(admin) {
  const scopes = await discoverCleanupScope(admin);
  const ledgers = [];
  for (const scope of scopes) {
    const ledger = await buildCleanupLedger(admin, scope);
    await moneySafetyPreflight(admin, ledger, true);
    ledgers.push(ledger);
  }
  const totals = {};
  for (const ledger of ledgers) {
    const deleted = await cleanupExactLedger(admin, ledger);
    for (const [table, count] of Object.entries(deleted)) totals[table] = (totals[table] ?? 0) + count;
  }
  const remainingClubs = await readCleanupCandidates(admin);
  const exactAuthUserIds = ledgers.flatMap((ledger) => ledger.authUserIds);
  let remainingUsers = 0;
  try {
    await verifyExactAuthUsersDeleted(admin, exactAuthUserIds);
  } catch (error) {
    remainingUsers = 1;
    console.log(`FLOOR_CANARY CLEANUP_REMAINING_AUTH detail=${error instanceof Error ? error.message : "unknown"}`);
  }
  if (remainingClubs.length !== 0 || remainingUsers !== 0) {
    console.log(`FLOOR_CANARY CLEANUP_REMAINING clubs=${remainingClubs.length} users=${remainingUsers} ids_hash=${hashIds(remainingClubs.map((row) => row.id))}`);
    fail("FLOOR CANARY CLEANUP FAIL - REMAINING_ROWS");
  }
  for (const [table, count] of Object.entries(totals)) console.log(`FLOOR_CANARY CLEANUP_TOTAL object=${table} count=${count}`);
  console.log(`FLOOR CANARY CLEANUP PASS groups=${ledgers.length} clubs_remaining=0 users_remaining=0`);
}

export {
  chipCasBrowserRequestBlockReason,
  createRunId,
  deleteExactAuthUsersBestEffort,
  discoverCleanupScope,
  expectedBlockedBrowserRequestReason,
  payoutBrowserRequestBlockReason,
  recoverAttemptedAuthUserIds,
  requireProductionCanaryContext,
  runCleanupCanary,
};

async function main() {
  const context = requireProductionCanaryContext();
  const admin = createClient(context.url, context.serviceKey, {
    ...NODE_REALTIME_OPTIONS,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (context.mode === "hold") fail("floor_canary_hold_mode");
  if (context.mode === "cleanup") {
    await runCleanupCanary(admin);
    return;
  }

  const runId = createRunId(context.prefix);
  console.log(`FLOOR_CANARY RUN_STARTED run_hash=${actorHash(runId)}`);
  const owned = {
    actorAttempts: [],
    clubAttempts: [],
    users: [],
    clubs: [],
    tournaments: [],
    gameTables: [],
    tournamentTables: [],
    entries: [],
    seats: [],
    levels: [],
    auditRows: [],
  };
  let canaryError = null;
  try {
    const actors = {
      owner: await createActor(admin, context.anonKey, context.url, runId, "owner", owned),
      cashier: await createActor(admin, context.anonKey, context.url, runId, "cashier", owned),
      floor: await createActor(admin, context.anonKey, context.url, runId, "floor", owned),
      cross: await createActor(admin, context.anonKey, context.url, runId, "cross", owned),
    };
    console.log(`FLOOR_CANARY ACTORS_CREATED ${Object.values(actors).map((actor) => `${actor.label}:${actorHash(actor.id)}`).join(" ")}`);
    await createCrossClub(admin, actors.cross, runId, owned);
    const primaryClubId = await createPrimaryClub(admin, actors, runId, owned);
    const fixtures = new Map();
    for (const scenario of SCENARIOS) fixtures.set(scenario, await createFixture(admin, runId, scenario, primaryClubId, owned));
    console.log(`FLOOR_CANARY FIXTURES_CREATED scenarios=${fixtures.size}`);
    await runApiCanary(context, admin, actors, fixtures);
    await runBrowserManifest(admin, actors, fixtures);
    await verifyPayoutCloseAfterBrowser(admin, actors, fixtures.get("PAYOUT_CLOSE"));
    console.log("FLOOR_CANARY PARTIAL_API_BROWSER_MATRIX_PASS_NO_AUTOMATED_AUDIT_CLAIM");
  } catch (error) {
    canaryError = error instanceof Error ? error.message : "unknown_canary_error";
  } finally {
    try {
      await cleanupCurrentRun(admin, context.anonKey, context.url, runId, owned);
    } catch (error) {
      const cleanupError = error instanceof Error ? error.message : "unknown_cleanup_error";
      canaryError = canaryError ? `${canaryError};${cleanupError}` : cleanupError;
    } finally {
      scrubActorAttempts(owned);
    }
  }
  if (canaryError) fail(`canary_failed:${canaryError}`);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  main().catch((error) => {
    console.error(`FLOOR_CANARY FAIL ${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  });
}
