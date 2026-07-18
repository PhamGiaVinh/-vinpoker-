import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const PRODUCTION_REF = "orlesggcjamwuknxwcpk";
const REQUIRED_CONFIRMATION = "RUN_FLOOR_PRODUCTION_CANARY";
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
  if (!environment.FLOOR_CANARY_PREFIX.startsWith("CODEX_FLOOR_CANARY_")) fail("floor_canary_prefix_invalid");
  if (environment.SUPABASE_PROJECT_REF !== PRODUCTION_REF) fail("production_project_ref_mismatch");
  if (new URL(environment.SUPABASE_URL).hostname !== `${PRODUCTION_REF}.supabase.co`) fail("production_url_mismatch");
  if (environment.GITHUB_REF === "refs/heads/main") fail("floor_canary_must_not_run_from_main");

  return {
    prefix: environment.FLOOR_CANARY_PREFIX,
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

async function single(query, code) {
  const { data, error } = await query.single();
  if (error || !data) fail(code);
  return data;
}

async function createActor(admin, anonKey, url, runId, label, owned) {
  const email = `${runId.toLowerCase()}-${label}@floor-canary.invalid`;
  const password = `Canary-${randomBytes(24).toString("base64url")}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) fail(`create_test_actor_${label}`);
  owned.users.push(created.data.user.id);

  const client = createClient(url, anonKey, {
    ...NODE_REALTIME_OPTIONS,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) fail(`sign_in_test_actor_${label}`);
  return {
    id: created.data.user.id,
    label,
    email,
    password,
    client,
    jwt: signedIn.data.session.access_token,
  };
}

async function createFixture(admin, actors, runId, scenario, owned) {
  const club = await single(admin.from("clubs").insert({
    id: randomUUID(),
    owner_id: actors.owner.id,
    name: `${runId}_${scenario}`,
    region: "TEST",
    status: "approved",
  }).select("id"), `create_fixture_club_${scenario}`);
  owned.clubs.push(club.id);

  for (const actor of [actors.cashier, actors.floor]) {
    const membership = await admin.from(actor.label === "cashier" ? "club_cashiers" : "club_floors").insert({
      club_id: club.id,
      user_id: actor.id,
      granted_by: actors.owner.id,
    });
    if (membership.error) fail(`create_${actor.label}_membership_${scenario}`);
  }

  const tournament = await single(admin.from("tournaments").insert({
    id: randomUUID(),
    club_id: club.id,
    name: `${runId}_${scenario}`,
    start_time: new Date().toISOString(),
    buy_in: 0,
    starting_stack: 10000,
    status: "active",
    current_level: 1,
  }).select("id,club_id"), `create_fixture_tournament_${scenario}`);
  owned.tournaments.push(tournament.id);

  const levels = await admin.from("tournament_levels").insert([
    { id: randomUUID(), tournament_id: tournament.id, level_number: 1, small_blind: 100, big_blind: 200, ante: 0, duration_minutes: 20, is_break: false },
    { id: randomUUID(), tournament_id: tournament.id, level_number: 2, small_blind: 200, big_blind: 400, ante: 0, duration_minutes: 20, is_break: false },
  ]).select("id");
  if (levels.error || !levels.data || levels.data.length !== 2) fail(`create_fixture_levels_${scenario}`);
  owned.levels.push(...levels.data.map((row) => row.id));

  const gameTable = await single(admin.from("game_tables").insert({
    id: randomUUID(),
    club_id: club.id,
    table_name: `${runId}_${scenario}_T1`,
    table_type: "tournament",
    status: "active",
    current_blind_level: 1,
  }).select("id"), `create_fixture_game_table_${scenario}`);
  owned.gameTables.push(gameTable.id);

  const tournamentTable = await single(admin.from("tournament_tables").insert({
    id: randomUUID(),
    tournament_id: tournament.id,
    table_id: gameTable.id,
    table_number: 1,
    max_seats: 9,
    status: "active",
  }).select("id"), `create_fixture_tournament_table_${scenario}`);
  owned.tournamentTables.push(tournamentTable.id);

  const seatFixtures = [];
  for (const seatNumber of [1, 2]) {
    const playerId = randomUUID();
    const entry = await single(admin.from("tournament_entries").insert({
      id: randomUUID(),
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
    owned.entries.push(entry.id);
    const seat = await single(admin.from("tournament_seats").insert({
      id: randomUUID(),
      tournament_id: tournament.id,
      player_id: playerId,
      entry_number: 1,
      table_id: gameTable.id,
      seat_number: seatNumber,
      chip_count: 10000,
      is_active: true,
      entry_id: entry.id,
    }).select("id,chip_count,entry_id"), `create_fixture_seat_${scenario}_${seatNumber}`);
    owned.seats.push(seat.id);
    seatFixtures.push(seat);
  }

  return { scenario, clubId: club.id, tournamentId: tournament.id, seat: seatFixtures[0] };
}

async function createCrossClub(admin, actor, runId, owned) {
  const club = await single(admin.from("clubs").insert({
    id: randomUUID(),
    owner_id: actor.id,
    name: `${runId}_CROSS_CLUB`,
    region: "TEST",
    status: "approved",
  }).select("id"), "create_cross_club");
  owned.clubs.push(club.id);
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
  if (deletion.error) fail(code);
}

async function cleanup(admin, owned) {
  await deleteExact(admin, "tournament_seats", owned.seats, "cleanup_seats");
  await deleteExact(admin, "tournament_entries", owned.entries, "cleanup_entries");
  await deleteExact(admin, "tournament_levels", owned.levels, "cleanup_levels");
  await deleteExact(admin, "tournament_tables", owned.tournamentTables, "cleanup_tournament_tables");
  await deleteExact(admin, "tournaments", owned.tournaments, "cleanup_tournaments");
  await deleteExact(admin, "game_tables", owned.gameTables, "cleanup_game_tables");
  for (const clubId of owned.clubs) {
    const cashier = await admin.from("club_cashiers").delete().eq("club_id", clubId);
    const floor = await admin.from("club_floors").delete().eq("club_id", clubId);
    if (cashier.error || floor.error) fail("cleanup_memberships");
  }
  await deleteExact(admin, "clubs", owned.clubs, "cleanup_clubs");
  for (const userId of owned.users) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) fail("cleanup_auth_users");
  }
  console.log(`FLOOR_CANARY CLEANUP_PASS users=${owned.users.length} clubs=${owned.clubs.length} tournaments=${owned.tournaments.length}`);
}

export { createRunId, requireProductionCanaryContext };

async function main() {
  const context = requireProductionCanaryContext();
  const runId = createRunId(context.prefix);
  const owned = { users: [], clubs: [], tournaments: [], gameTables: [], tournamentTables: [], entries: [], seats: [], levels: [] };
  const admin = createClient(context.url, context.serviceKey, {
    ...NODE_REALTIME_OPTIONS,
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
