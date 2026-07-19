import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import {
  actorHash,
  cleanupCurrentRun,
  createActor,
  createCrossClub,
  createFixture,
  createPrimaryClub,
  createRunId,
  invokeFunction,
  requireProductionCanaryContext,
} from "./floor-production-canary.mjs";

const RPC = "floor_update_tournament_seat_chip";
const EDGE = "tournament-live-draw";
const TRANSPORTS = new Set(["rpc", "edge"]);
const NODE_REALTIME_OPTIONS = { realtime: { transport: WebSocket } };

function fail(code) {
  throw new Error(code);
}

function assert(name, passed, detail = "") {
  console.log(
    `FLOOR_CHIP_CAS_SMOKE ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` ${detail}` : ""}`,
  );
  if (!passed) fail(`assertion_failed:${name}`);
}

function safeError(error) {
  const code = typeof error?.code === "string" &&
      /^[A-Za-z0-9_.-]{1,64}$/.test(error.code)
    ? error.code
    : "unknown";
  const status = Number.isInteger(error?.status) ? error.status : "unknown";
  return { code, status };
}

async function rpcCall(actor, fixture, expectedChip, chipCount) {
  const { data, error } = await actor.client.rpc(RPC, {
    p_tournament_id: fixture.tournamentId,
    p_seat_id: fixture.seat.id,
    p_expected_chip_count: expectedChip,
    p_chip_count: chipCount,
  });
  return {
    ok: !error && data?.ok === true,
    error: typeof data?.error === "string" ? data.error : null,
    transportError: error ? safeError(error) : null,
  };
}

async function edgeCall(context, actor, fixture, expectedChip, chipCount) {
  return await invokeFunction(
    context.url,
    context.anonKey,
    EDGE,
    actor?.jwt ?? null,
    {
      action: "update_seats",
      tournament_id: fixture.tournamentId,
      seats: [{
        seat_id: fixture.seat.id,
        chip_count: chipCount,
        expected_chip_count: expectedChip,
      }],
    },
  );
}

async function call(context, transport, actor, fixture, expectedChip, chipCount) {
  return transport === "rpc"
    ? await rpcCall(actor, fixture, expectedChip, chipCount)
    : await edgeCall(context, actor, fixture, expectedChip, chipCount);
}

function success(transport, response) {
  return transport === "rpc" ? response.ok === true : response.status === 200;
}

function denied(transport, response, rpcCode, edgeStatus) {
  return transport === "rpc"
    ? response.ok === false && response.error === rpcCode
    : response.status === edgeStatus;
}

async function readSeat(admin, fixture, code) {
  const response = await admin.from("tournament_seats").select(
    "id,tournament_id,player_id,entry_id,entry_number,table_id,seat_number,chip_count,is_active,status",
  ).eq("id", fixture.seat.id).single();
  if (response.error || !response.data) fail(code);
  return response.data;
}

function identitySnapshot(row) {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    player_id: row.player_id,
    entry_id: row.entry_id,
    entry_number: row.entry_number,
    table_id: row.table_id,
    seat_number: row.seat_number,
    is_active: row.is_active,
    status: row.status,
  };
}

function sameIdentity(before, after) {
  return JSON.stringify(identitySnapshot(before)) ===
    JSON.stringify(identitySnapshot(after));
}

async function updateFixture(admin, fixture, patch, code) {
  const response = await admin.from("tournament_seats").update(patch).eq(
    "id",
    fixture.seat.id,
  ).select("id").single();
  if (response.error || !response.data) fail(code);
}

async function missingIdentity(context, transport, fixture) {
  if (transport === "edge") {
    const response = await edgeCall(context, null, fixture, 10000, 10001);
    assert("missing_identity_denied", response.status === 401, "status=401");
    const invalid = await invokeFunction(
      context.url,
      context.anonKey,
      EDGE,
      null,
      { action: "update_seats" },
    );
    assert(
      "missing_identity_precedes_payload",
      invalid.status === 401,
      "status=401",
    );
    return;
  }
  const anon = createClient(context.url, context.anonKey, {
    ...NODE_REALTIME_OPTIONS,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const response = await anon.rpc(RPC, {
    p_tournament_id: fixture.tournamentId,
    p_seat_id: fixture.seat.id,
    p_expected_chip_count: 10000,
    p_chip_count: 10001,
  });
  assert(
    "missing_identity_denied",
    Boolean(response.error) && !response.data,
    `transport_code=${safeError(response.error).code}`,
  );
}

async function invalidPayload(context, actor) {
  const response = await invokeFunction(
    context.url,
    context.anonKey,
    EDGE,
    actor.jwt,
    { action: "update_seats", seats: [] },
  );
  assert("invalid_payload_400", response.status === 400, "status=400");
}

async function runMatrix(context, transport, admin, actors, fixtures) {
  const chip = fixtures.chip;
  const initial = await readSeat(admin, chip, "chip_initial_read");
  await missingIdentity(context, transport, chip);
  if (transport === "edge") await invalidPayload(context, actors.floor);

  let expected = initial.chip_count;
  for (const { actor, marker } of [
    { actor: actors.owner, marker: "owner_first_write" },
    { actor: actors.cashier, marker: "cashier_first_write" },
    { actor: actors.floor, marker: "floor_first_write" },
  ]) {
    const next = expected + 1;
    const response = await call(
      context,
      transport,
      actor,
      chip,
      expected,
      next,
    );
    assert(
      marker,
      success(transport, response),
      transport === "edge" ? `status=${response.status}` : "rpc_ok=true",
    );
    expected = next;
  }

  const afterRoles = await readSeat(admin, chip, "chip_after_roles_read");
  assert("role_writes_server_state", afterRoles.chip_count === expected);
  assert("chip_only_identity_unchanged", sameIdentity(initial, afterRoles));

  const stale = await call(
    context,
    transport,
    actors.floor,
    chip,
    expected - 1,
    expected + 10,
  );
  assert(
    "stale_write_denied",
    denied(transport, stale, "stale_seat_state", 409),
    transport === "edge" ? `status=${stale.status}` : "error=stale_seat_state",
  );

  const cross = await call(
    context,
    transport,
    actors.cross,
    chip,
    expected,
    expected + 10,
  );
  assert(
    "cross_club_denied",
    denied(transport, cross, "actor_not_allowed", 403),
    transport === "edge" ? `status=${cross.status}` : "error=actor_not_allowed",
  );

  const rejectedState = await readSeat(admin, chip, "chip_rejected_state_read");
  assert("rejected_calls_db_unchanged", rejectedState.chip_count === expected);
  assert("rejected_calls_identity_unchanged", sameIdentity(initial, rejectedState));

  const concurrent = await Promise.all([
    call(context, transport, actors.floor, chip, expected, expected + 1),
    call(context, transport, actors.floor, chip, expected, expected + 2),
  ]);
  const successCount = concurrent.filter((response) =>
    success(transport, response)
  ).length;
  const conflictCount = concurrent.filter((response) =>
    denied(transport, response, "stale_seat_state", 409)
  ).length;
  assert(
    "concurrent_exactly_one_success",
    successCount === 1 && conflictCount === 1,
    `success=${successCount} conflict=${conflictCount}`,
  );
  const afterConcurrent = await readSeat(
    admin,
    chip,
    "chip_after_concurrent_read",
  );
  assert(
    "refresh_reads_committed_server_state",
    [expected + 1, expected + 2].includes(afterConcurrent.chip_count),
    "server_state=one_committed_value",
  );
  assert("concurrent_identity_unchanged", sameIdentity(initial, afterConcurrent));

  await updateFixture(
    admin,
    fixtures.inactive,
    { is_active: false, status: "busted" },
    "make_inactive_fixture",
  );
  const inactiveBefore = await readSeat(
    admin,
    fixtures.inactive,
    "inactive_before_read",
  );
  const inactive = await call(
    context,
    transport,
    actors.floor,
    fixtures.inactive,
    inactiveBefore.chip_count,
    inactiveBefore.chip_count + 1,
  );
  assert(
    "inactive_seat_denied",
    transport === "rpc"
      ? denied(transport, inactive, "seat_not_active", 409)
      : inactive.status === 409,
    transport === "edge" ? `status=${inactive.status}` : "error=seat_not_active",
  );
  const inactiveAfter = await readSeat(
    admin,
    fixtures.inactive,
    "inactive_after_read",
  );
  assert(
    "inactive_rejection_db_unchanged",
    inactiveAfter.chip_count === inactiveBefore.chip_count &&
      sameIdentity(inactiveBefore, inactiveAfter),
  );

  await updateFixture(
    admin,
    fixtures.mismatch,
    { entry_id: null },
    "make_mismatch_fixture",
  );
  const mismatchBefore = await readSeat(
    admin,
    fixtures.mismatch,
    "mismatch_before_read",
  );
  const mismatch = await call(
    context,
    transport,
    actors.floor,
    fixtures.mismatch,
    mismatchBefore.chip_count,
    mismatchBefore.chip_count + 1,
  );
  assert(
    "entry_mismatch_denied",
    denied(transport, mismatch, "seat_entry_mismatch", 409),
    transport === "edge" ? `status=${mismatch.status}` : "error=seat_entry_mismatch",
  );
  const mismatchAfter = await readSeat(
    admin,
    fixtures.mismatch,
    "mismatch_after_read",
  );
  assert(
    "mismatch_rejection_db_unchanged",
    mismatchAfter.chip_count === mismatchBefore.chip_count &&
      sameIdentity(mismatchBefore, mismatchAfter),
  );
  if (transport === "edge") {
    console.log(
      "FLOOR_CHIP_CAS_SMOKE PASS sanitized_500_source_contract live_500_not_forced=true",
    );
  }
}

async function main() {
  const context = requireProductionCanaryContext();
  const transport = process.env.FLOOR_CHIP_CAS_TRANSPORT;
  if (!TRANSPORTS.has(transport)) fail("smoke_transport_invalid");
  const admin = createClient(context.url, context.serviceKey, {
    ...NODE_REALTIME_OPTIONS,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = createRunId(context.prefix);
  const owned = {
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
  let smokeError = null;
  console.log(
    `FLOOR_CHIP_CAS_SMOKE RUN_START transport=${transport} run_hash=${actorHash(runId)}`,
  );
  try {
    const actors = {
      owner: await createActor(
        admin,
        context.anonKey,
        context.url,
        runId,
        "owner",
        owned,
      ),
      cashier: await createActor(
        admin,
        context.anonKey,
        context.url,
        runId,
        "cashier",
        owned,
      ),
      floor: await createActor(
        admin,
        context.anonKey,
        context.url,
        runId,
        "floor",
        owned,
      ),
      cross: await createActor(
        admin,
        context.anonKey,
        context.url,
        runId,
        "cross",
        owned,
      ),
    };
    console.log(
      `FLOOR_CHIP_CAS_SMOKE ACTORS ${Object.values(actors).map((actor) => `${actor.label}:${actorHash(actor.id)}`).join(" ")}`,
    );
    await createCrossClub(admin, actors.cross, runId, owned);
    const clubId = await createPrimaryClub(admin, actors, runId, owned);
    const fixtures = {
      chip: await createFixture(admin, runId, "CHIP_CAS", clubId, owned),
      inactive: await createFixture(
        admin,
        runId,
        "TABLE_LIFECYCLE",
        clubId,
        owned,
      ),
      mismatch: await createFixture(
        admin,
        runId,
        "CLOSE_ORPHAN",
        clubId,
        owned,
      ),
    };
    await runMatrix(context, transport, admin, actors, fixtures);
  } catch (error) {
    smokeError = error instanceof Error ? error.message : "unknown_smoke_error";
  } finally {
    try {
      await cleanupCurrentRun(admin, runId, owned);
    } catch (error) {
      const cleanupError = error instanceof Error
        ? error.message
        : "unknown_cleanup_error";
      smokeError = smokeError
        ? `${smokeError};${cleanupError}`
        : cleanupError;
    }
  }
  if (smokeError) fail(`smoke_failed:${smokeError}`);
  console.log(`FLOOR CHIP CAS ${transport.toUpperCase()} SMOKE PASS`);
}

main().catch((error) => {
  console.error(
    `FLOOR_CHIP_CAS_SMOKE FAIL ${error instanceof Error ? error.message : "unknown"}`,
  );
  process.exitCode = 1;
});
