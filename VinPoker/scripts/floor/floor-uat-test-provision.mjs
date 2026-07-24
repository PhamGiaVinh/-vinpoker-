import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_PROJECT_REF = "orlesggcjamwuknxwcpk";
const CONFIRMATION = "PROVISION_FLOOR_UAT_TEST_USERS";
const TARGET = Object.freeze({
  clubName: "HSOP",
  tournamentName: "TEST — Felt UAT (compact)",
  buyIn: 1_000_000,
});
const RUN_ID_RE = /^CODEX_FLOOR_UAT_[0-9]{14}_[a-f0-9]{8}$/;

function fail(code) { throw new Error(code); }

// Node's crypto hash is deliberately kept out of operational logging: these labels
// identify the run, never a user, session, or credential.
function awaitableHash(value) {
  let total = 2166136261;
  for (const character of value) total = Math.imul(total ^ character.charCodeAt(0), 16777619);
  return (total >>> 0).toString(16).padStart(8, "0");
}

function runId() {
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(), String(now.getUTCMonth() + 1).padStart(2, "0"), String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"), String(now.getUTCMinutes()).padStart(2, "0"), String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  return `CODEX_FLOOR_UAT_${stamp}_${randomBytes(4).toString("hex")}`;
}

function requireContext(environment = process.env) {
  for (const name of [
    "FLOOR_UAT_ENV", "FLOOR_UAT_CONFIRM", "FLOOR_UAT_OPERATION", "FLOOR_UAT_RUN_ID",
    "SUPABASE_PROJECT_REF", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GITHUB_REF",
  ]) if (!environment[name] && name !== "FLOOR_UAT_RUN_ID") fail(`missing_${name.toLowerCase()}`);
  if (environment.FLOOR_UAT_ENV !== "production-test") fail("floor_uat_env_invalid");
  if (environment.FLOOR_UAT_CONFIRM !== CONFIRMATION) fail("floor_uat_confirmation_missing");
  if (!["provision", "cleanup"].includes(environment.FLOOR_UAT_OPERATION)) fail("floor_uat_operation_invalid");
  if (environment.GITHUB_REF === "refs/heads/main") fail("floor_uat_must_not_run_from_main");
  if (environment.SUPABASE_PROJECT_REF !== PRODUCTION_PROJECT_REF) fail("production_project_ref_mismatch");
  if (environment.SUPABASE_URL !== `https://${PRODUCTION_PROJECT_REF}.supabase.co`) fail("production_url_mismatch");
  if (environment.FLOOR_UAT_OPERATION === "cleanup" && !RUN_ID_RE.test(environment.FLOOR_UAT_RUN_ID ?? "")) fail("floor_uat_cleanup_run_id_invalid");
  return {
    operation: environment.FLOOR_UAT_OPERATION,
    url: environment.SUPABASE_URL,
    serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    cleanupRunId: environment.FLOOR_UAT_RUN_ID ?? null,
  };
}

async function one(query, code) {
  const { data, error } = await query;
  if (error || !data) fail(code);
  return data;
}

async function removeUsers(admin, ids) {
  for (const id of ids) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) fail("floor_uat_cleanup_auth_user_failed");
  }
}

async function createTestUser(admin, id, label, ownedUsers) {
  const email = `${id.toLowerCase()}-${label}@floor-uat.invalid`;
  const password = `FloorUat-${randomBytes(24).toString("base64url")}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) fail(`floor_uat_create_${label}_failed`);
  const userId = created.data.user.id;
  ownedUsers.push(userId);
  const profile = await admin.from("profiles")
    .update({ display_name: `${id}_${label.toUpperCase()}` })
    .eq("user_id", userId)
    .select("user_id");
  if (profile.error || profile.data?.length !== 1) fail(`floor_uat_profile_${label}_failed`);
  return userId;
}

async function targetTournament(admin) {
  const clubs = await admin.from("clubs").select("id,name").eq("name", TARGET.clubName);
  if (clubs.error || !clubs.data || clubs.data.length !== 1) fail("floor_uat_target_club_not_unique");
  const tournaments = await admin.from("tournaments")
    .select("id,club_id,name,buy_in,status")
    .eq("club_id", clubs.data[0].id)
    .eq("name", TARGET.tournamentName);
  if (tournaments.error || !tournaments.data || tournaments.data.length !== 1) fail("floor_uat_target_tournament_not_unique");
  const tournament = tournaments.data[0];
  if (Number(tournament.buy_in) !== TARGET.buyIn || ["completed", "cancelled"].includes(tournament.status)) fail("floor_uat_target_tournament_invalid");
  return tournament;
}

async function provision(admin) {
  const id = runId();
  const owned = { users: [], registrations: [], entries: [], seats: [] };
  try {
    const tournament = await targetTournament(admin);
    const provisioner = await createTestUser(admin, id, "provisioner", owned.users);
    const players = [];
    for (const label of ["player1", "player2"]) players.push(await createTestUser(admin, id, label, owned.users));
    const registrationIds = [];
    for (const [index, playerId] of players.entries()) {
      const registration = await one(admin.from("tournament_registrations").insert({
        tournament_id: tournament.id, club_id: tournament.club_id, player_id: playerId,
        reference_code: `${id}_P${index + 1}`, buy_in: TARGET.buyIn, total_pay: 0,
        status: "pending", transfer_proof_submitted: false, used_free_rake: false,
      }).select("id").single(), `floor_uat_registration_${index + 1}_failed`);
      owned.registrations.push(registration.id);
      const confirmed = await admin.rpc("confirm_registration_and_assign_seat", {
        p_registration_id: registration.id, p_actor_user_id: provisioner, p_draw_mode: "fill_lowest_table",
      });
      if (confirmed.error || confirmed.data?.ok !== true || typeof confirmed.data.entry_id !== "string") fail(`floor_uat_confirm_${index + 1}_failed`);
      const entry = await one(admin.from("tournament_entries")
        .select("id,registration_id,player_id,status,seat_id").eq("id", confirmed.data.entry_id).single(), `floor_uat_entry_${index + 1}_failed`);
      const seat = await one(admin.from("tournament_seats")
        .select("id,entry_id,player_id,is_active").eq("id", entry.seat_id).single(), `floor_uat_seat_${index + 1}_failed`);
      if (entry.registration_id !== registration.id || entry.player_id !== playerId || entry.status !== "seated" || seat.entry_id !== entry.id || seat.player_id !== playerId || seat.is_active !== true) fail(`floor_uat_entry_link_${index + 1}_invalid`);
      owned.entries.push(entry.id);
      owned.seats.push(seat.id);
      registrationIds.push(registration.id);
    }
    console.log(`FLOOR_UAT PROVISION_PASS run_hash=${awaitableHash(id)} registrations=${registrationIds.length} players=${players.length} payment_actions=0`);
    console.log("FLOOR_UAT CLEANUP_REQUIRED operation=cleanup exact_run_id_recorded=true");
  } catch (error) {
    for (const [table, column, ids] of [["seat_assignment_history", "entry_id", owned.entries], ["seat_draw_receipts", "entry_id", owned.entries], ["tournament_seats", "id", owned.seats], ["tournament_entries", "id", owned.entries], ["tournament_registrations", "id", owned.registrations]]) {
      if (ids.length) {
        const deleted = await admin.from(table).delete().in(column, ids);
        if (deleted.error) fail(`floor_uat_recovery_${table}_failed`);
      }
    }
    if (owned.users.length) await removeUsers(admin, owned.users);
    throw error;
  }
}

async function cleanup(admin, id) {
  const registrations = await admin.from("tournament_registrations")
    .select("id,player_id,confirmed_by").like("reference_code", `${id}_P%`);
  if (registrations.error || !registrations.data || registrations.data.length !== 2) fail("floor_uat_cleanup_registration_scope_invalid");
  const playerIds = registrations.data.map((row) => row.player_id);
  const provisioners = [...new Set(registrations.data.map((row) => row.confirmed_by).filter(Boolean))];
  if (provisioners.length !== 1) fail("floor_uat_cleanup_provisioner_scope_invalid");
  const registrationIds = registrations.data.map((row) => row.id);
  const entries = await admin.from("tournament_entries").select("id,seat_id").in("registration_id", registrationIds);
  if (entries.error || !entries.data || entries.data.length !== 2) fail("floor_uat_cleanup_entry_scope_invalid");
  const entryIds = entries.data.map((row) => row.id);
  const seatIds = entries.data.map((row) => row.seat_id).filter(Boolean);
  for (const [table, column, ids] of [["seat_assignment_history", "entry_id", entryIds], ["seat_draw_receipts", "entry_id", entryIds], ["tournament_seats", "id", seatIds], ["tournament_entries", "id", entryIds], ["tournament_registrations", "id", registrationIds]]) {
    const deleted = await admin.from(table).delete().in(column, ids);
    if (deleted.error) fail(`floor_uat_cleanup_${table}_failed`);
  }
  await removeUsers(admin, [...playerIds, provisioners[0]]);
  console.log(`FLOOR_UAT CLEANUP_PASS run_hash=${awaitableHash(id)} users=3 registrations=2 entries=2 seats=${seatIds.length} payment_actions=0`);
}

export { CONFIRMATION, RUN_ID_RE, requireContext };

async function main() {
  const context = requireContext();
  const admin = createClient(context.url, context.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (context.operation === "provision") await provision(admin);
  else await cleanup(admin, context.cleanupRunId);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) main().catch((error) => {
  console.error(`FLOOR_UAT FAIL ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
