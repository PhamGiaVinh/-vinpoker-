import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const PRODUCTION_REF = "orlesggcjamwuknxwcpk";
const REQUIRED_CONFIRMATION = "RUN_FLOOR_PRODUCTION_CANARY";
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
const CLEANUP_RUN_ID_RE = /^CODEX_FLOOR_CANARY_[0-9]{14}_[a-f0-9]{8}$/;
const CLEANUP_SCENARIO_RE = new RegExp(`^(CODEX_FLOOR_CANARY_[0-9]{14}_[a-f0-9]{8})_(${[...SCENARIOS, "CROSS_CLUB"].join("|")})$`);
const CLEANUP_SCENARIOS = new Set(["ACCESS", "SETUP_CLOCK", "TABLE_LIFECYCLE", "CLOSE_ORPHAN", "REDRAW", "CHIP_CAS", "BUST_RESTORE", "PAYOUT_CLOSE", "CONCURRENCY", "CROSS_CLUB"]);
const CLEANUP_RUN_GROUP_COUNT = 2;
const CLEANUP_CLUBS_PER_RUN = 2;
const CLEANUP_TOTAL_CLUB_COUNT = 4;
const CLEANUP_SCOPE_PREFIX = "CODEX_FLOOR_CANARY_";
const CLEANUP_GAME_TABLE_BATCH_SIZE = 50;
const CLEANUP_MAX_BATCH_ATTEMPTS = 2;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLEANUP_CHILD_SCOPES = [
  { table: "dealer_assignments", column: "table_id", source: "gameTableIds", constraint: "dealer_assignments_table_id_fkey", indexed: true },
  { table: "dealer_attendance", column: "pre_assigned_table_id", source: "gameTableIds", constraint: "dealer_attendance_pre_assigned_table_id_fkey", indexed: false },
  { table: "dealer_incidents", column: "table_id", source: "gameTableIds", constraint: "dealer_incidents_table_id_fkey", indexed: false },
  { table: "swing_audit_logs", column: "table_id", source: "gameTableIds", constraint: "swing_audit_logs_table_id_fkey", indexed: false },
  { table: "tournament_hands", column: "table_id", source: "gameTableIds", constraint: "tournament_hands_table_id_fkey", indexed: false },
  { table: "seat_draw_receipts", column: "table_id", source: "gameTableIds", constraint: "seat_draw_receipts_table_id_fkey", indexed: false },
  { table: "seat_assignment_history", column: "to_table_id", source: "gameTableIds", constraint: "seat_assignment_history_to_table_id_fkey", indexed: false },
  { table: "dealer_rotation_schedule", column: "table_id", source: "gameTableIds", constraint: "dealer_rotation_schedule_table_id_fkey", indexed: false },
  { table: "dealer_table_profiles", column: "table_id", source: "gameTableIds", constraint: "dealer_table_profiles_table_id_fkey", indexed: true },
  { table: "dealer_override_claims", column: "table_id", source: "gameTableIds", constraint: "dealer_override_claims_table_id_fkey", indexed: false },
  { table: "tournament_chip_counts", column: "tournament_id", source: "tournamentIds", constraint: "tournament_chip_counts_tournament_id_fkey", indexed: true },
  { table: "tournament_eliminations", column: "tournament_id", source: "tournamentIds", constraint: "tournament_eliminations_tournament_id_fkey", indexed: true },
  { table: "tournament_state_transitions", column: "tournament_id", source: "tournamentIds", constraint: "tournament_state_transitions_tournament_id_fkey", indexed: true },
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
  { table: "tournament_registrations", column: "tournament_id", bucket: "registration" },
  { table: "payout_recipients", column: "deal_id", bucket: "payout" },
  { table: "payout_templates", column: "club_id", bucket: "payout" },
  { table: "fnb_orders", column: "club_id", bucket: "fnb" },
  { table: "fnb_cashier_shifts", column: "club_id", bucket: "fnb" },
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
  return `code=${code}${constraint}`;
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

async function moneySafetyPreflight(admin, ledger) {
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
    console.log(`FLOOR_CANARY CLEANUP_MONEY table=${scope.table} bucket=${scope.bucket} count=${count}`);
    if (count !== 0) fail(`CLEANUP_BLOCKED_BY_MONEY_ROW:${scope.table}`);
  }
  return counts;
}

async function validateExactAuthUserIds(admin, runId, ids) {
  if (![0, 4].includes(ids.length) || ids.some((id) => !UUID_RE.test(id))) fail("cleanup_scope_actor_count");
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
  if (ids.length === 4 && labels.size !== 4) fail("cleanup_scope_actor_labels");
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

async function buildCleanupLedger(admin, scope) {
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
  if (![0, 4].includes(referencedUserIds.length)) fail("CLEANUP_SCOPE_UNEXPECTED:referenced_actor_set");
  const authUsers = await validateExactAuthUserIds(admin, scope.runId, referencedUserIds);
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
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    console.log(`FLOOR_CANARY ACTOR_CREATE_FAIL label=${label} ${safeAuthErrorDetail(created.error)}`);
    fail(`create_test_actor_${label}`);
  }
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

async function createFixture(admin, actors, runId, scenario, owned) {
  const clubId = randomUUID();
  owned.clubs.push(clubId);
  const club = await single(admin.from("clubs").insert({
    id: clubId,
    owner_id: actors.owner.id,
    name: `${runId}_${scenario}`,
    region: "TEST",
    status: "approved",
  }).select("id"), `create_fixture_club_${scenario}`);
  await trackClubOwnedRows(admin, club.id, owned);
  for (const actor of [actors.cashier, actors.floor]) {
    const membership = await admin.from(actor.label === "cashier" ? "club_cashiers" : "club_floors").insert({
      club_id: club.id,
      user_id: actor.id,
      granted_by: actors.owner.id,
    });
    if (membership.error) {
      console.log(`FLOOR_CANARY DB_FAIL op=create_${actor.label}_membership_${scenario} ${safeDbErrorDetail(membership.error)}`);
      fail(`create_${actor.label}_membership_${scenario}`);
    }
  }

  const tournamentId = randomUUID();
  owned.tournaments.push(tournamentId);
  const tournament = await single(admin.from("tournaments").insert({
    id: tournamentId,
    club_id: club.id,
    name: `${runId}_${scenario}`,
    start_time: new Date().toISOString(),
    buy_in: 0,
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
    club_id: club.id,
    table_name: `${runId}_${scenario}_T1`,
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
    max_seats: 9,
    status: "active",
  }).select("id"), `create_fixture_tournament_table_${scenario}`);

  const seatFixtures = [];
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
    }).select("id,chip_count,entry_id"), `create_fixture_seat_${scenario}_${seatNumber}`);
    seatFixtures.push(seat);
  }

  return { scenario, clubId: club.id, tournamentId: tournament.id, seat: seatFixtures[0] };
}

async function createCrossClub(admin, actor, runId, owned) {
  const clubId = randomUUID();
  owned.clubs.push(clubId);
  const club = await single(admin.from("clubs").insert({
    id: clubId,
    owner_id: actor.id,
    name: `${runId}_CROSS_CLUB`,
    region: "TEST",
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

async function assertScope(actor, fixture, capability) {
  const scope = await actor.client.rpc("get_my_floor_operator_scope");
  if (scope.error || !Array.isArray(scope.data)) fail(`scope_query_${actor.label}`);
  const row = scope.data.find((candidate) => candidate.club_id === fixture.clubId);
  result(`scope_${actor.label}_${fixture.scenario}`, row?.[capability] === true);
}

async function runApiCanary(context, actors, fixtures) {
  const setup = fixtures.get("SETUP_CLOCK");
  const chips = fixtures.get("CHIP_CAS");
  if (!setup || !chips) fail("required_scenarios_missing");

  await assertScope(actors.owner, setup, "can_owner");
  await assertScope(actors.cashier, setup, "can_cashier");
  await assertScope(actors.floor, setup, "can_floor");
  const crossScope = await actors.cross.client.rpc("get_my_floor_operator_scope");
  result("scope_cross_club_denied", !crossScope.data?.some((row) => row.club_id === setup.clubId));

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

  const concurrent = fixtures.get("CONCURRENCY");
  if (!concurrent) fail("concurrency_scenario_missing");
  const concurrentStart = await Promise.all([
    invokeFunction(context.url, context.anonKey, "tournament-live-clock", actors.floor.jwt, { tournament_id: concurrent.tournamentId, action: "start" }),
    invokeFunction(context.url, context.anonKey, "tournament-live-clock", actors.floor.jwt, { tournament_id: concurrent.tournamentId, action: "start" }),
  ]);
  result("edge_clock_concurrent_start_one_wins", concurrentStart.map((entry) => entry.status).sort().join(",") === "200,409");

  const updated = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.floor.jwt, {
    tournament_id: chips.tournamentId,
    action: "update_seats",
    seats: [{ seat_id: chips.seat.id, chip_count: 10001, expected_chip_count: chips.seat.chip_count }],
  });
  result("edge_draw_chip_cas_write", updated.status === 200);
  const stale = await invokeFunction(context.url, context.anonKey, "tournament-live-draw", actors.floor.jwt, {
    tournament_id: chips.tournamentId,
    action: "update_seats",
    seats: [{ seat_id: chips.seat.id, chip_count: 10002, expected_chip_count: chips.seat.chip_count }],
  });
  result("edge_draw_chip_cas_stale_409", stale.status === 409);
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

async function runBrowserManifest(actors) {
  if (process.env.FLOOR_CANARY_RUN_BROWSER !== "true") {
    console.log("FLOOR_CANARY BROWSER_NOT_REQUESTED");
    return;
  }
  const { chromium } = await import("@playwright/test");
  const stateDirectory = await mkdtemp(join(tmpdir(), "floor-canary-"));
  await chmod(stateDirectory, 0o700);
  const baseUrl = productionBaseUrl();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const actor of [actors.owner, actors.cashier, actors.floor, actors.cross]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(`${baseUrl}/auth`, { waitUntil: "networkidle" });
        const emailInput = page.locator('input[type="email"]');
        const passwordInput = page.locator('input[type="password"]');
        result(`browser_login_email_input_${actor.label}`, await emailInput.count() === 1);
        result(`browser_login_password_input_${actor.label}`, await passwordInput.count() === 1);
        await emailInput.fill(actor.email);
        await passwordInput.fill(actor.password);
        const signIn = page.getByRole("button", { name: "Sign In" });
        result(`browser_login_button_${actor.label}`, await signIn.count() === 1);
        await signIn.click();
        await page.waitForTimeout(700);
        await page.goto(`${baseUrl}/ops`, { waitUntil: "networkidle" });
        result(`browser_ops_authenticated_${actor.label}`, !page.url().endsWith("/auth"));
        if (actor.label === "floor") {
          await page.goto(`${baseUrl}/ops/cashier`, { waitUntil: "networkidle" });
          const deniedGuard = page.getByText("Chưa được phân công CLB", { exact: true });
          result("browser_floor_cashier_direct_url_requires_guard", await deniedGuard.count() === 1);
        }
        if (actor.label === "cross") {
          const noScopeGuard = page.getByText("Chưa được phân công CLB", { exact: true });
          result("browser_cross_club_no_scope_guard", await noScopeGuard.count() === 1);
        }
        const statePath = join(stateDirectory, `${actor.label}.json`);
        await context.storageState({ path: statePath });
        await chmod(statePath, 0o600);
      } finally {
        await context.close();
      }
    }

    const routeAssignments = JSON.stringify([
      { route: "/ops/tournaments", role: "owner" },
      { route: "/ops/tables", role: "floor" },
    ]);
    const exitCode = await runCommand("npx", ["playwright", "test", "e2e/floor-button-coverage.spec.ts", "--project", "chromium"], {
      ...process.env,
      PLAYWRIGHT_BASE_URL: baseUrl,
      FLOOR_UAT_RUN_BROWSER: "true",
      FLOOR_UAT_STORAGE_STATE_DIR: stateDirectory,
      FLOOR_UAT_ROUTE_ASSIGNMENTS: routeAssignments,
    });
    result("browser_button_manifest", exitCode === 0);
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

async function cleanup(admin, owned) {
  const failures = [];
  const attempt = async (name, action) => {
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      failures.push(`${name}:${detail}`);
      console.log(`FLOOR_CANARY CLEANUP_FAIL step=${name} detail=${detail}`);
    }
  };

  await attempt("seats", () => deleteExact(admin, "tournament_seats", owned.seats, "cleanup_seats"));
  await attempt("entries", () => deleteExact(admin, "tournament_entries", owned.entries, "cleanup_entries"));
  await attempt("levels", () => deleteExact(admin, "tournament_levels", owned.levels, "cleanup_levels"));
  await attempt("tournament_tables", () => deleteExact(admin, "tournament_tables", owned.tournamentTables, "cleanup_tournament_tables"));
  await attempt("tournaments", () => deleteExact(admin, "tournaments", owned.tournaments, "cleanup_tournaments"));
  await attempt("game_tables", () => deleteExact(admin, "game_tables", owned.gameTables, "cleanup_game_tables"));
  await attempt("swing_config_audit", () => deleteExact(admin, "swing_config_audit", owned.auditRows, "cleanup_swing_config_audit"));
  for (const [index, clubId] of owned.clubs.entries()) {
    await attempt(`memberships_${index}`, async () => {
      const cashier = await admin.from("club_cashiers").delete().eq("club_id", clubId);
      const floor = await admin.from("club_floors").delete().eq("club_id", clubId);
      if (cashier.error) throw new Error(`cashier:${safeDbErrorDetail(cashier.error)}`);
      if (floor.error) throw new Error(`floor:${safeDbErrorDetail(floor.error)}`);
    });
  }
  await attempt("clubs", () => deleteExact(admin, "clubs", owned.clubs, "cleanup_clubs"));
  for (const [index, userId] of owned.users.entries()) {
    await attempt(`auth_user_${index}`, async () => {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw new Error(safeAuthErrorDetail(deleted.error));
    });
  }
  await attempt("verify_seats", () => verifyExactRows(admin, "tournament_seats", owned.seats, "verify_seats"));
  await attempt("verify_entries", () => verifyExactRows(admin, "tournament_entries", owned.entries, "verify_entries"));
  await attempt("verify_levels", () => verifyExactRows(admin, "tournament_levels", owned.levels, "verify_levels"));
  await attempt("verify_tournament_tables", () => verifyExactRows(admin, "tournament_tables", owned.tournamentTables, "verify_tournament_tables"));
  await attempt("verify_tournaments", () => verifyExactRows(admin, "tournaments", owned.tournaments, "verify_tournaments"));
  await attempt("verify_game_tables", () => verifyExactRows(admin, "game_tables", owned.gameTables, "verify_game_tables"));
  await attempt("verify_audit_rows", () => verifyExactRows(admin, "swing_config_audit", owned.auditRows, "verify_audit_rows"));
  await attempt("verify_clubs", () => verifyExactRows(admin, "clubs", owned.clubs, "verify_clubs"));
  if (failures.length > 0) throw new Error(`cleanup_incomplete:${failures.join(",")}`);
  console.log(`FLOOR_CANARY CLEANUP_PASS users=${owned.users.length} clubs=${owned.clubs.length} tournaments=${owned.tournaments.length}`);
}

async function deleteByColumnExact(client, table, column, values, code) {
  if (values.length === 0) return;
  const deletion = await client.from(table).delete().in(column, values);
  if (deletion.error) throw new Error(`${code}:${safeDbErrorDetail(deletion.error)}`);
}

async function verifyByColumnExact(client, table, column, values, code) {
  if (values.length === 0) return;
  const remaining = await client.from(table).select("id", { count: "exact", head: true }).in(column, values);
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
        throw new Error(`${code}:bounded_retries_exhausted:${detail}`);
      }
      const smallerSize = Math.max(1, Math.ceil(remaining.length / 2));
      for (let offset = 0; offset < remaining.length; offset += smallerSize) {
        queue.unshift({ ids: remaining.slice(offset, offset + smallerSize), attempt: batch.attempt + 1 });
      }
    }
  }
  return deletedCount;
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
  await attempt("cashier_memberships", async () => { await deleteByColumnExact(admin, "club_cashiers", "club_id", ledger.clubIds, "cleanup_cashier_memberships"); return ledger.cashierMemberships.length; });
  await attempt("floor_memberships", async () => { await deleteByColumnExact(admin, "club_floors", "club_id", ledger.clubIds, "cleanup_floor_memberships"); return ledger.floorMemberships.length; });
  await attempt("swing_config_audit", async () => { await deleteExact(admin, "swing_config_audit", ledger.auditRows, "cleanup_swing_config_audit"); return ledger.auditRows.length; });
  await attempt("game_tables", () => deleteExactBatches(admin, "game_tables", ledger.gameTableIds, "cleanup_game_tables"));
  await attempt("clubs", async () => { await deleteExact(admin, "clubs", ledger.clubIds, "cleanup_clubs"); return ledger.clubIds.length; });
  for (const [index, userId] of ledger.authUserIds.entries()) {
    await attempt(`auth_user_${index}`, async () => {
      const deleted = await admin.auth.admin.deleteUser(userId);
      if (deleted.error) throw new Error(safeAuthErrorDetail(deleted.error));
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

async function runCleanupCanary(admin) {
  const scopes = await discoverCleanupScope(admin);
  const ledgers = [];
  for (const scope of scopes) {
    const ledger = await buildCleanupLedger(admin, scope);
    await moneySafetyPreflight(admin, ledger);
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

export { createRunId, requireProductionCanaryContext, discoverCleanupScope, runCleanupCanary };

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
  console.log(`FLOOR_CANARY RUN_ID ${runId}`);
  const owned = { users: [], clubs: [], tournaments: [], gameTables: [], tournamentTables: [], entries: [], seats: [], levels: [], auditRows: [] };
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
    const fixtures = new Map();
    for (const scenario of SCENARIOS) fixtures.set(scenario, await createFixture(admin, actors, runId, scenario, owned));
    console.log(`FLOOR_CANARY FIXTURES_CREATED scenarios=${fixtures.size}`);
    await runApiCanary(context, actors, fixtures);
    await runBrowserManifest(actors);
    console.log("FLOOR_CANARY API_MATRIX_PASS");
  } catch (error) {
    canaryError = error instanceof Error ? error.message : "unknown_canary_error";
  } finally {
    try {
      await cleanup(admin, owned);
    } catch (error) {
      const cleanupError = error instanceof Error ? error.message : "unknown_cleanup_error";
      canaryError = canaryError ? `${canaryError};${cleanupError}` : cleanupError;
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
