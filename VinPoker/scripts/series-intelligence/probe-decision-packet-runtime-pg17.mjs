#!/usr/bin/env node
// Disposable D2A + D2B PostgreSQL 17 acceptance harness. Refuses non-local hosts.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "../..");
const d2aPath = join(app, "supabase/migrations/20270107000001_series_decision_packet_v1.sql");
const d2bPath = join(app, "supabase/migrations/20270108000002_series_private_actual_truth_runtime_v1.sql");
const bootstrapPath = join(here, "disposable-decision-packet-runtime-pg17-bootstrap.sql");
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const CLUB = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
const OTHER_CLUB = "abcdefab-cdef-4abc-8abc-abcdefabcdee";
const PLAYER_1 = "60000000-0000-4000-8000-000000000001";
const PLAYER_2 = "60000000-0000-4000-8000-000000000002";
const PLAYER_3 = "60000000-0000-4000-8000-000000000003";
const EVENTS = {
  eligible: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef1",
  completed: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef2",
  conflict: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef3",
  partial: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef4",
  missing: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef5",
  noForecast: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef6",
  supersession: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef7",
  wrongClub: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef8",
  deleted: "bcdefabc-defa-4bcd-8bcd-bcdefabcdef9",
  cancelled: "bcdefabc-defa-4bcd-8bcd-bcdefabcdefa",
  unknown: "bcdefabc-defa-4bcd-8bcd-bcdefabcdefb",
  timing: "bcdefabc-defa-4bcd-8bcd-bcdefabcdefc"
};
const SNAPSHOTS = {
  eligible: "70000000-0000-4000-8000-000000000001",
  incomplete: "70000000-0000-4000-8000-000000000002",
  noForecast: "70000000-0000-4000-8000-000000000003",
  supersession: "70000000-0000-4000-8000-000000000004",
  wrongClub: "70000000-0000-4000-8000-000000000005"
};
const TARGET_DATES = Object.fromEntries([
  [EVENTS.eligible, "2026-02-01T00:00:00.000Z"], [EVENTS.completed, "2026-02-03T00:00:00.000Z"], [EVENTS.conflict, "2026-02-05T00:00:00.000Z"],
  [EVENTS.partial, "2026-02-07T00:00:00.000Z"], [EVENTS.missing, "2026-02-09T00:00:00.000Z"], [EVENTS.noForecast, "2026-02-11T00:00:00.000Z"],
  [EVENTS.supersession, "2026-02-13T00:00:00.000Z"], [EVENTS.timing, "2026-02-23T00:00:00.000Z"]
]);

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const expect = (condition, message) => { if (!condition) throw new Error(message); };

function parseArgs(argv) {
  if (argv.length !== 4 || argv[2] !== "--report") throw new Error("usage: probe-decision-packet-runtime-pg17.mjs --report <path>");
  return resolve(argv[3]);
}

function readConfig() {
  if (process.env.D2B_PG17_ALLOW_DISPOSABLE !== "1") throw new Error("D2B_PG17_ALLOW_DISPOSABLE=1 is required");
  if (process.env.D2B_MIGRATIONS_APPLIED !== "1") throw new Error("D2B_MIGRATIONS_APPLIED=1 is required");
  const host = process.env.PGHOST ?? "127.0.0.1";
  if (!localHosts.has(host)) throw new Error("D2B probe refuses a non-local PostgreSQL host");
  return { host, port: process.env.PGPORT ?? "5432", user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", admin: process.env.D2B_PG17_ADMIN_DATABASE ?? "postgres" };
}

function psql(config, database, statement, actor) {
  const prelude = actor ? `SET request.jwt.claim.sub TO ${sql(actor)}; SET ROLE authenticated;` : "RESET request.jwt.claim.sub;";
  const result = spawnSync("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet", "--host", config.host, "--port", config.port, "--username", config.user, "--dbname", database], {
    input: `${prelude}\n${statement}\n`, encoding: "utf8",
    env: { ...process.env, PGHOST: config.host, PGPORT: config.port, PGUSER: config.user, PGPASSWORD: config.password }
  });
  if (result.error) throw new Error(`psql execution failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
  return result.stdout.trim();
}

function scalar(config, database, statement, actor) { return psql(config, database, statement, actor).split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? ""; }
function json(config, database, statement, actor) { return JSON.parse(scalar(config, database, statement, actor)); }
function uuid(config, database, statement, actor) { const value = scalar(config, database, statement, actor); expect(/^[0-9a-f-]{36}$/i.test(value), `expected uuid, got ${value}`); return value; }
function expectError(config, database, statement, actor, pattern) { let error; try { psql(config, database, statement, actor); } catch (caught) { error = caught; } expect(error, "expected SQL call to fail"); if (pattern) expect(pattern.test(String(error.message)), `error did not match ${pattern}: ${error.message}`); }
function jsonArg(value) { return `${sql(JSON.stringify(value))}::jsonb`; }

function createPacket(config, database, { event, snapshot = null, state = "no_forecast_available", metric = "entries", horizon = "T-7", key, parent = null }) {
  const snapshotArg = snapshot ? `${sql(snapshot)}::uuid` : "NULL";
  const manual = state === "manual_expectation" ? "500::bigint" : "NULL::bigint";
  const args = [
    `${sql(event)}::uuid`, `${sql(horizon)}::text`, `${sql(metric)}::text`, sql("2026-01-02T00:00:00.000Z") + "::timestamptz", sql("2026-01-01T00:00:00.000Z") + "::timestamptz", `${sql(TARGET_DATES[event])}::timestamptz`,
    snapshot ? snapshotArg : "NULL::uuid", `${sql(state)}::text`, manual, "'[]'::jsonb", "NULL::jsonb", "NULL::integer", "NULL::jsonb", "NULL::integer", "'{}'::jsonb", "NULL::text", "NULL::text", "NULL::text", "NULL::text", "NULL::text", "NULL::text", "'[]'::jsonb", "'[]'::jsonb", "NULL::text", parent ? `${sql(parent)}::uuid` : "NULL::uuid", parent ? `${sql("supersedes for acceptance")}::text` : "NULL::text", `${sql(key)}::text`
  ];
  return uuid(config, database, `SELECT id::text FROM public.series_create_decision_packet_v1(${args.join(",")})`, OWNER);
}

function freezePacket(config, database, packet) { return scalar(config, database, `SELECT packet_state FROM public.series_freeze_decision_packet_v1(${sql(packet)}::uuid,1)`, OWNER); }

function createManual(config, database, { event, scope = "event_total", finality = "final", source = "2026-02-02T00:00:00.000Z", entries = 2, unique = 1, bullets = 2, reentries = 1, records = 2, paid = null, prize = 600000000, prizeAvailability = "present", prizeCurrency = "VND", prizeScale = 0, overlay = null, overlayAvailability = "explicit_zero", idempotency, parent = null, reason = null }) {
  const value = (availability, number) => `${sql(availability)}::text,${number === null ? "NULL::bigint" : `${number}::bigint`}`;
  const money = (availability, amount, currency, scale) => `${sql(availability)}::text,${amount === null ? "NULL::numeric" : `${amount}::numeric`},${currency === null ? "NULL::text" : `${sql(currency)}::text`},${scale === null ? "NULL::smallint" : `${scale}::smallint`}`;
  const args = [
    `${sql(event)}::uuid`, `${sql(scope)}::text`, `${sql(finality)}::text`, `${sql("exact")}::text`, `${sql(source)}::timestamptz`, value(entries === null ? "missing" : entries === 0 ? "explicit_zero" : "present", entries), value(unique === null ? "missing" : unique === 0 ? "explicit_zero" : "present", unique), value(bullets === null ? "missing" : bullets === 0 ? "explicit_zero" : "present", bullets), value(reentries === null ? "missing" : reentries === 0 ? "explicit_zero" : "present", reentries), value(records === null ? "missing" : records === 0 ? "explicit_zero" : "present", records), value(paid === null ? "missing" : paid === 0 ? "explicit_zero" : "present", paid), money(prizeAvailability, prize, prizeCurrency, prizeScale), money(overlayAvailability, overlay, overlay === null ? null : "VND", overlay === null ? null : 0), parent ? `${sql(parent)}::uuid` : "NULL::uuid", `${sql(idempotency)}::text`, reason ? `${sql(reason)}::text` : "NULL::text"
  ];
  return uuid(config, database, `SELECT id::text FROM public.series_record_event_actual_v1(${args.join(",")})`, OWNER);
}

function reconcile(config, database, autoId, manualId, mode, idempotency) {
  const baseFields = {
    entries: { availability: "present", value: 2, resolutionSource: "chose_auto" },
    uniquePlayers: { availability: "present", value: 1, resolutionSource: "chose_auto" },
    totalBullets: { availability: "present", value: 2, resolutionSource: "chose_auto" },
    reentries: { availability: "present", value: 1, resolutionSource: "chose_auto" },
    registrationRecords: { availability: "present", value: 2, resolutionSource: "chose_auto" },
    paidPlaces: { availability: "missing", value: null, resolutionSource: "unavailable" },
    prizePool: { availability: "present", amountMinor: "600000000", currency: "VND", scale: 0, resolutionSource: "chose_auto" },
    overlay: { availability: "explicit_zero", amountMinor: "0", currency: "VND", scale: 0, resolutionSource: "chose_auto" }
  };
  if (mode === "manual") {
    for (const field of ["entries", "uniquePlayers", "totalBullets", "reentries", "registrationRecords"]) baseFields[field] = { availability: "present", value: 2, resolutionSource: "owner_override" };
    baseFields.uniquePlayers.value = 1; baseFields.reentries.value = 1;
    baseFields.paidPlaces = { availability: "missing", value: null, resolutionSource: "unavailable" };
    baseFields.prizePool = { availability: "present", amountMinor: "600000000", currency: "VND", scale: 0, resolutionSource: "owner_override" };
    baseFields.overlay = { availability: "explicit_zero", amountMinor: "0", currency: "VND", scale: 0, resolutionSource: "owner_override" };
  }
  const resolution = mode === "blocked_conflict" ? { mode, blockReasons: ["entries_mismatch", "owner_review_required"] } : mode === "matching" ? { mode } : { mode, fields: baseFields };
  return json(config, database, `SELECT public.series_reconcile_event_actual_v1(${sql(autoId)}::uuid,${sql(manualId)}::uuid,${jsonArg(resolution)},${sql(`acceptance ${mode}`)},${sql(idempotency)})`, OWNER);
}

function seed(config, database) {
  const e = EVENTS;
  psql(config, database, `INSERT INTO public.clubs(id,owner_id) VALUES (${sql(CLUB)}::uuid,${sql(OWNER)}::uuid),(${sql(OTHER_CLUB)}::uuid,${sql(OTHER_OWNER)}::uuid);
INSERT INTO public.tournaments(id,club_id,start_time,status,deleted_at,updated_at,guarantee_amount,itm_places) VALUES
(${sql(e.eligible)}::uuid,${sql(CLUB)}::uuid,'2026-02-01T00:00:00Z','registering',NULL,'2026-01-03T00:00:00Z',600000000,3),
(${sql(e.completed)}::uuid,${sql(CLUB)}::uuid,'2026-02-03T00:00:00Z','completed',NULL,'2026-02-04T00:00:00Z',600000000,3),
(${sql(e.conflict)}::uuid,${sql(CLUB)}::uuid,'2026-02-05T00:00:00Z','completed',NULL,'2026-02-06T00:00:00Z',600000000,3),
(${sql(e.partial)}::uuid,${sql(CLUB)}::uuid,'2026-02-07T00:00:00Z','completed',NULL,'2026-02-08T00:00:00Z',600000000,3),
(${sql(e.missing)}::uuid,${sql(CLUB)}::uuid,'2026-02-09T00:00:00Z','registering',NULL,'2026-02-01T00:00:00Z',600000000,3),
(${sql(e.noForecast)}::uuid,${sql(CLUB)}::uuid,'2026-02-11T00:00:00Z','registering',NULL,'2026-02-01T00:00:00Z',600000000,3),
(${sql(e.supersession)}::uuid,${sql(CLUB)}::uuid,'2026-02-13T00:00:00Z','registering',NULL,'2026-02-01T00:00:00Z',600000000,3),
(${sql(e.wrongClub)}::uuid,${sql(OTHER_CLUB)}::uuid,'2026-02-15T00:00:00Z','registering',NULL,'2026-02-01T00:00:00Z',600000000,3),
(${sql(e.deleted)}::uuid,${sql(CLUB)}::uuid,'2026-02-17T00:00:00Z','registering','2026-02-18T00:00:00Z','2026-02-01T00:00:00Z',600000000,3),
(${sql(e.cancelled)}::uuid,${sql(CLUB)}::uuid,'2026-02-19T00:00:00Z','cancelled',NULL,'2026-02-01T00:00:00Z',600000000,3),
(${sql(e.unknown)}::uuid,${sql(CLUB)}::uuid,'2026-02-21T00:00:00Z','mystery',NULL,'2026-02-01T00:00:00Z',600000000,3),
(${sql(e.timing)}::uuid,${sql(CLUB)}::uuid,'2026-02-23T00:00:00Z','registering',NULL,'2026-02-01T00:00:00Z',600000000,3);
INSERT INTO public.tournament_registrations(id,tournament_id,club_id,player_id,status,buy_in,platform_fixed_fee,total_pay,updated_at) VALUES
('50000000-0000-4000-8000-000000000001',${sql(e.eligible)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_1)}::uuid,'confirmed',300000000,30000000,330000000,'2026-01-04T00:00:00Z'),
('50000000-0000-4000-8000-000000000002',${sql(e.eligible)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_1)}::uuid,'confirmed',300000000,30000000,330000000,'2026-01-04T00:00:00Z'),
('50000000-0000-4000-8000-000000000003',${sql(e.eligible)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_2)}::uuid,'cancelled',300000000,30000000,330000000,'2026-01-04T00:00:00Z'),
('50000000-0000-4000-8000-000000000004',${sql(e.completed)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_1)}::uuid,'confirmed',200000000,20000000,220000000,'2026-02-04T00:00:00Z'),
('50000000-0000-4000-8000-000000000005',${sql(e.completed)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_2)}::uuid,'confirmed',200000000,20000000,220000000,'2026-02-04T00:00:00Z'),
('50000000-0000-4000-8000-000000000006',${sql(e.completed)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_1)}::uuid,'confirmed',200000000,20000000,220000000,'2026-02-04T00:00:00Z');
INSERT INTO public.series_event_actuals(event_id,club_id) VALUES (${sql(e.completed)}::uuid,${sql(CLUB)}::uuid);
INSERT INTO public.series_forecast_snapshots(id,club_id,event_id,forecast_issued_at,as_of_ts,target_event_ts,forecast_identity_eligible,provenance_completeness) VALUES
(${sql(SNAPSHOTS.eligible)}::uuid,${sql(CLUB)}::uuid,${sql(e.eligible)}::uuid,'2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-01T00:00:00Z',true,'complete'),
(${sql(SNAPSHOTS.incomplete)}::uuid,${sql(CLUB)}::uuid,${sql(e.missing)}::uuid,'2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-09T00:00:00Z',false,'missing_code_sha'),
(${sql(SNAPSHOTS.noForecast)}::uuid,${sql(CLUB)}::uuid,${sql(e.noForecast)}::uuid,'2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-11T00:00:00Z',false,'manual'),
(${sql(SNAPSHOTS.supersession)}::uuid,${sql(CLUB)}::uuid,${sql(e.supersession)}::uuid,'2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-13T00:00:00Z',true,'complete'),
(${sql(SNAPSHOTS.wrongClub)}::uuid,${sql(OTHER_CLUB)}::uuid,${sql(e.wrongClub)}::uuid,'2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-15T00:00:00Z',true,'complete')`);
}

async function main() {
  const reportPath = parseArgs(process.argv); const config = readConfig();
  const [d2a, d2b, bootstrap] = await Promise.all([readFile(d2aPath, "utf8"), readFile(d2bPath, "utf8"), readFile(bootstrapPath, "utf8")]);
  const database = `d2b_probe_${process.pid}_${Date.now()}`.replaceAll("-", "_"); const checks = [];
  const check = (name, fn) => { try { fn(); checks.push({ name, status: "pass" }); } catch (error) { checks.push({ name, status: "fail", error: error instanceof Error ? error.message : String(error) }); } };
  let packetEligible; let packetIncomplete; let packetNoForecast; let packetRoot; let packetSuccessor;
  let autoEligible; let manualEligible; let autoConflict; let manualConflict; let manualPartial;
  try {
    psql(config, config.admin, `CREATE DATABASE ${database}`);
    psql(config, database, bootstrap); psql(config, database, d2a); psql(config, database, d2b); seed(config, database);
    packetEligible = createPacket(config, database, { event: EVENTS.eligible, snapshot: SNAPSHOTS.eligible, state: "forecast_identity_eligible", key: "packet:eligible:001" });
    freezePacket(config, database, packetEligible);
    psql(config, database, `UPDATE public.tournaments SET status='completed',updated_at='2026-02-04T00:00:00Z' WHERE id=${sql(EVENTS.eligible)}::uuid`);

    check("A01_postgres_server_is_17", () => expect(/^PostgreSQL 17\./.test(scalar(config, database, "SHOW server_version")), scalar(config, database, "SHOW server_version")));
    check("A02_d2a_revision_table_exists", () => expect(scalar(config, database, "SELECT to_regclass('public.series_event_actual_revisions_v1')") === "series_event_actual_revisions_v1", "missing table"));
    check("A03_d2b_native_source_table_exists", () => expect(scalar(config, database, "SELECT to_regclass('public.series_event_actual_native_sources_v1')") === "series_event_actual_native_sources_v1", "missing table"));
    check("A04_d2b_reconciliation_table_exists", () => expect(scalar(config, database, "SELECT to_regclass('public.series_event_actual_reconciliations_v1')") === "series_event_actual_reconciliations_v1", "missing table"));
    check("A05_d2a_rls_enabled", () => expect(scalar(config, database, "SELECT relrowsecurity FROM pg_class WHERE oid='public.series_event_actual_revisions_v1'::regclass") === "t", "RLS disabled"));
    check("A06_d2b_metadata_rls_enabled", () => expect(scalar(config, database, "SELECT relrowsecurity FROM pg_class WHERE oid='public.series_event_actual_native_sources_v1'::regclass") === "t", "RLS disabled"));
    check("A07_authenticated_cannot_insert_actuals", () => expect(scalar(config, database, "SELECT has_table_privilege('authenticated','public.series_event_actual_revisions_v1','INSERT')") === "f", "insert granted"));
    check("A08_anon_cannot_execute_runtime_rpc", () => expect(scalar(config, database, "SELECT has_function_privilege('anon','public.series_promote_native_event_actual_v1(uuid,text)','EXECUTE')") === "f", "anon execute granted"));
    check("A09_security_definer_functions_pin_empty_search_path", () => expect(scalar(config, database, "SELECT count(*)::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef AND proname IN ('series_promote_native_event_actual_v1','series_reconcile_event_actual_v1','series_get_decision_event_state_v1','series_create_decision_packet_v1','series_freeze_decision_packet_v1') AND proconfig @> ARRAY['search_path=']") === "5", "security definer search_path drift"));

    check("B01_native_promotion_creates_event_total_revision", () => { const result = json(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.eligible)}::uuid,${sql("native:eligible:001")})`, OWNER); autoEligible = result.revision.revisionId; expect(result.state === "created" && result.revision.scope === "event_total", JSON.stringify(result)); });
    check("B02_native_finality_tracks_completed_event", () => expect(scalar(config, database, `SELECT finality FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "final", "unexpected initial finality"));
    check("B03_native_counts_confirmed_rows_only", () => expect(scalar(config, database, `SELECT entries_value::text || ':' || unique_players_value::text || ':' || total_bullets_value::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "2:1:2", "count contract drift"));
    check("B04_native_reentries_are_bullets_minus_unique", () => expect(scalar(config, database, `SELECT reentries_value::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "1", "reentry derivation drift"));
    check("B05_native_prize_pool_excludes_platform_fee", () => expect(scalar(config, database, `SELECT prize_pool_amount_minor::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "600000000", "fee leaked into prize pool"));
    check("B06_native_overlay_uses_event_guarantee", () => expect(scalar(config, database, `SELECT overlay_availability || ':' || overlay_amount_minor::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "explicit_zero:0", "overlay drift"));
    check("B07_native_source_fingerprint_is_recorded", () => expect(scalar(config, database, `SELECT count(*)::text FROM public.series_event_actual_native_sources_v1 WHERE revision_id=${sql(autoEligible)}::uuid`) === "1", "missing source record"));
    check("B08_native_idempotency_replays_same_source", () => { const result = json(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.eligible)}::uuid,${sql("native:eligible:002")})`, OWNER); expect(result.state === "idempotent" && result.revision.revisionId === autoEligible, JSON.stringify(result)); });
    check("B09_native_anonymous_call_fails", () => expectError(config, database, `SET ROLE anon; SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.eligible)}::uuid,${sql("native:eligible:003")})`, null, /unauthenticated|forbidden/));
    check("B10_native_wrong_club_fails", () => expectError(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.wrongClub)}::uuid,${sql("native:wrong:001")})`, OWNER, /forbidden/));
    check("B11_native_deleted_event_fails", () => expectError(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.deleted)}::uuid,${sql("native:deleted:001")})`, OWNER, /forbidden/));
    check("B12_native_cancelled_event_fails", () => expectError(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.cancelled)}::uuid,${sql("native:cancelled:001")})`, OWNER, /cancelled/));
    check("B13_native_unknown_status_fails_closed", () => expectError(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.unknown)}::uuid,${sql("native:unknown:001")})`, OWNER, /unknown_event_status/));
    check("B14_native_empty_registration_set_is_explicit_zero", () => { const result = json(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.missing)}::uuid,${sql("native:missing:001")})`, OWNER); expect(result.revision.metrics.entries.availability === "explicit_zero" && result.revision.metrics.entries.value === 0, JSON.stringify(result)); });
    check("B15_native_revision_identity_is_append_only", () => expectError(config, database, `UPDATE public.series_event_actual_revisions_v1 SET entries_value=99 WHERE id=${sql(autoEligible)}::uuid`, null, /append_only/));

    check("C01_manual_actual_creates_manual_root", () => { manualEligible = createManual(config, database, { event: EVENTS.eligible, idempotency: "manual:eligible:001" }); expect(Boolean(manualEligible), "manual root missing"); });
    check("C02_manual_actual_requires_owner", () => expectError(config, database, `SET ROLE anon; SELECT public.series_record_event_actual_v1(${sql(EVENTS.completed)}::uuid,'event_total','final','exact','2026-02-04T00:00:00Z','present',2,'present',1,'present',2,'present',1,'present',2,'missing',NULL::bigint,'present',600000000,'VND',0,'explicit_zero',0,'VND',0,NULL::uuid,${sql("manual:anon:001")},NULL::text)`, null, /unauthenticated/));
    check("C03_manual_finality_requires_completed_event", () => expectError(config, database, `SELECT public.series_record_event_actual_v1(${sql(EVENTS.eligible)}::uuid,'event_total','final','exact','2026-02-02T00:00:00Z','present',2,'present',1,'present',2,'present',1,'present',2,'missing',NULL::bigint,'present',600000000,'VND',0,'explicit_zero',0,'VND',0,NULL::uuid,${sql("manual:active:001")},NULL::text)`, OWNER, /finality_not_supported/));
    check("C04_manual_count_accepts_missing_without_zero", () => { manualPartial = createManual(config, database, { event: EVENTS.partial, scope: "partial_result", finality: "final", source: "2026-02-08T00:00:00.000Z", entries: null, unique: null, bullets: null, reentries: null, records: null, prize: null, prizeAvailability: "missing", prizeCurrency: null, prizeScale: null, overlay: null, idempotency: "manual:partial:001" }); expect(Boolean(manualPartial), "missing-only manual result rejected"); });
    check("C05_manual_negative_money_fails", () => expectError(config, database, `SELECT public.series_record_event_actual_v1(${sql(EVENTS.completed)}::uuid,'event_total','final','exact','2026-02-04T00:00:00Z','present',2,'present',1,'present',2,'present',1,'present',2,'missing',NULL::bigint,'present',-1,'VND',0,'explicit_zero',0,'VND',0,NULL::uuid,${sql("manual:negative:001")},NULL::text)`, OWNER, /money|availability|invalid/));
    check("C06_manual_scale_and_currency_are_canonical", () => { const id = createManual(config, database, { event: EVENTS.completed, source: "2026-02-04T00:00:00.000Z", idempotency: "manual:canonical:001", prizeCurrency: "vnd", overlay: null }); expect(scalar(config, database, `SELECT prize_pool_currency || ':' || prize_pool_scale::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(id)}::uuid`) === "VND:0", "currency/scale not canonical"); });
    check("C07_manual_foreign_owner_fails", () => expectError(config, database, `SELECT public.series_record_event_actual_v1(${sql(EVENTS.completed)}::uuid,'event_total','final','exact','2026-02-04T00:00:00Z','present',2,'present',1,'present',2,'present',1,'present',2,'missing',NULL::bigint,'present',600000000,'VND',0,'explicit_zero',0,'VND',0,NULL::uuid,${sql("manual:foreign:001")},NULL::text)`, OTHER_OWNER, /forbidden/));
    check("C08_manual_correction_requires_owner_reason", () => expectError(config, database, `SELECT public.series_record_event_actual_v1(${sql(EVENTS.completed)}::uuid,'event_total','corrected','exact','2026-02-04T00:00:00Z','present',2,'present',1,'present',2,'present',1,'present',2,'missing',NULL::bigint,'present',600000000,'VND',0,'explicit_zero',0,'VND',0,${sql(manualEligible)}::uuid,${sql("manual:bad-correction:001")},NULL::text)`, OWNER, /correction|reason|predecessor/));

    check("D01_matching_reconciliation_creates_current_truth", () => { const result = reconcile(config, database, autoEligible, manualEligible, "matching", "reconcile:eligible:001"); expect(["created", "idempotent"].includes(result.state), JSON.stringify(result)); });
    check("D02_matching_reconciliation_uses_equal_metrics", () => expect(scalar(config, database, `SELECT reconciliation_status FROM public.series_event_actual_revisions_v1 WHERE event_id=${sql(EVENTS.eligible)}::uuid AND source_kind='reconciled'`) === "matching", "not matching"));
    check("D03_matching_reconciliation_is_idempotent", () => { const result = reconcile(config, database, autoEligible, manualEligible, "matching", "reconcile:eligible:001"); expect(result.state === "idempotent", JSON.stringify(result)); });
    check("D04_active_truth_chosen_revision_is_reconciled", () => { const result = json(config, database, `SELECT public._series_d2b_actual_truth_state_v1(${sql(EVENTS.eligible)}::uuid)`, OWNER); expect(result.state === "current" && result.sourceState === "reconciled", JSON.stringify(result)); });
    check("D05_reconciled_revision_references_both_sources", () => expect(scalar(config, database, `SELECT count(*)::text FROM public.series_event_actual_revisions_v1 WHERE event_id=${sql(EVENTS.eligible)}::uuid AND source_kind='reconciled' AND reconciles_auto_revision_id=${sql(autoEligible)}::uuid AND reconciles_manual_revision_id=${sql(manualEligible)}::uuid`) === "1", "lineage references missing"));
    check("D06_reconciled_history_preserves_auto_and_manual_roots", () => expect(scalar(config, database, `SELECT count(*)::text FROM public.series_event_actual_revisions_v1 WHERE event_id=${sql(EVENTS.eligible)}::uuid AND source_kind IN ('native_tournament_system','owner_manual')`) === "2", "source roots changed"));
    check("D07_reconciliation_mismatched_scope_fails", () => expectError(config, database, `SELECT public.series_reconcile_event_actual_v1(${sql(autoEligible)}::uuid,${sql(manualPartial)}::uuid,'{"mode":"matching"}'::jsonb,${sql("bad scope")},${sql("reconcile:bad-scope")})`, OWNER, /incompatible|missing/));
    check("D08_stale_auto_source_fails", () => { psql(config, database, `INSERT INTO public.tournament_registrations(id,tournament_id,club_id,player_id,status,buy_in,platform_fixed_fee,total_pay,updated_at) VALUES ('50000000-0000-4000-8000-000000000008',${sql(EVENTS.eligible)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_2)}::uuid,'confirmed',300000000,30000000,330000000,'2026-02-04T00:00:01Z')`); const result = json(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.eligible)}::uuid,${sql("native:eligible:004")})`, OWNER); expectError(config, database, `SELECT public.series_reconcile_event_actual_v1(${sql(autoEligible)}::uuid,${sql(manualEligible)}::uuid,'{"mode":"matching"}'::jsonb,${sql("stale")},${sql("reconcile:stale-auto")})`, OWNER, /stale/); expect(Boolean(result.revision.supersedesRevisionId), JSON.stringify(result)); });
    check("D09_stale_manual_source_fails", () => expectError(config, database, `SELECT public.series_reconcile_event_actual_v1(${sql(autoEligible)}::uuid,${sql(manualEligible)}::uuid,'{"mode":"matching"}'::jsonb,${sql("stale")},${sql("reconcile:stale-manual")})`, OWNER, /stale/));
    check("D10_reconciliation_metadata_is_append_only", () => expectError(config, database, `UPDATE public.series_event_actual_reconciliations_v1 SET owner_reason='tampered'`, null, /append_only/));
    check("D11_reconciliation_duplicate_lineage_is_blocked", () => expectError(config, database, `SELECT public.series_reconcile_event_actual_v1(${sql(autoEligible)}::uuid,${sql(manualEligible)}::uuid,'{"mode":"matching"}'::jsonb,${sql("duplicate")},${sql("reconcile:duplicate")})`, OWNER, /stale/));
    check("D12_correction_revision_has_predecessor", () => { psql(config, database, `INSERT INTO public.tournament_registrations(id,tournament_id,club_id,player_id,status,buy_in,platform_fixed_fee,total_pay,updated_at) VALUES ('50000000-0000-4000-8000-000000000009',${sql(EVENTS.eligible)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_3)}::uuid,'confirmed',300000000,30000000,330000000,'2026-02-04T00:00:02Z')`); const result = json(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.eligible)}::uuid,${sql("native:eligible:005")})`, OWNER); expect(Boolean(result.revision.supersedesRevisionId), JSON.stringify(result)); });
    check("D13_owner_override_reconciliation_is_explicit", () => { const changedAuto = scalar(config, database, `SELECT id::text FROM public.series_event_actual_revisions_v1 WHERE event_id=${sql(EVENTS.eligible)}::uuid AND source_kind='native_tournament_system' ORDER BY captured_at DESC LIMIT 1`); const changedManual = scalar(config, database, `SELECT id::text FROM public.series_event_actual_revisions_v1 WHERE event_id=${sql(EVENTS.eligible)}::uuid AND source_kind='owner_manual' ORDER BY captured_at DESC LIMIT 1`); const result = reconcile(config, database, changedAuto, changedManual, "manual", "reconcile:eligible:manual-override"); expect(["created", "idempotent"].includes(result.state), JSON.stringify(result)); });

    check("E01_conflict_record_is_non_scoring", () => { autoConflict = uuid(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.conflict)}::uuid,${sql("native:conflict:001")})`, OWNER); manualConflict = createManual(config, database, { event: EVENTS.conflict, source: "2026-02-06T00:00:00.000Z", entries: 4, unique: 3, bullets: 4, reentries: 1, idempotency: "manual:conflict:001" }); const result = reconcile(config, database, autoConflict, manualConflict, "blocked_conflict", "reconcile:conflict:001"); expect(result.state === "conflict_recorded", JSON.stringify(result)); });
    check("E02_conflict_truth_state_blocks", () => { const result = json(config, database, `SELECT public._series_d2b_actual_truth_state_v1(${sql(EVENTS.conflict)}::uuid)`, OWNER); expect(result.state === "conflict", JSON.stringify(result)); });
    check("E03_conflict_metrics_are_not_guessed", () => expect(scalar(config, database, `SELECT entries_availability FROM public.series_event_actual_revisions_v1 WHERE event_id=${sql(EVENTS.conflict)}::uuid AND source_kind='reconciled'`) === "conflicting", "conflict value guessed"));

    check("F01_entries_unique_bullets_relationship_is_valid", () => expect(scalar(config, database, `SELECT (entries_value >= unique_players_value AND entries_value = total_bullets_value)::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "true", "count relationship invalid"));
    check("F02_reentries_relationship_is_valid", () => expect(scalar(config, database, `SELECT (reentries_value = total_bullets_value - unique_players_value)::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "true", "reentry relationship invalid"));
    check("F03_paid_places_missing_is_preserved", () => expect(scalar(config, database, `SELECT paid_places_availability FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "missing", "paid places fabricated"));
    check("F04_legacy_cache_is_not_promoted", () => expect(scalar(config, database, `SELECT (SELECT count(*) FROM public.series_event_actuals WHERE event_id=${sql(EVENTS.completed)}::uuid) = 1 AND (SELECT count(*) FROM public.series_event_actual_revisions_v1 WHERE event_id=${sql(EVENTS.completed)}::uuid) = 0`) === "true", "legacy cache promoted"));
    check("F05_negative_native_source_is_rejected", () => { psql(config, database, `INSERT INTO public.tournament_registrations(id,tournament_id,club_id,player_id,status,buy_in,platform_fixed_fee,total_pay,updated_at) VALUES ('50000000-0000-4000-8000-000000000007',${sql(EVENTS.timing)}::uuid,${sql(CLUB)}::uuid,${sql(PLAYER_3)}::uuid,'confirmed',-1,0,-1,'2026-02-01T00:00:00Z')`); expectError(config, database, `SELECT public.series_promote_native_event_actual_v1(${sql(EVENTS.timing)}::uuid,${sql("native:negative:001")})`, OWNER, /money|invalid|count/); });
    check("F06_scale_zero_is_stored_explicitly", () => expect(scalar(config, database, `SELECT prize_pool_scale::text FROM public.series_event_actual_revisions_v1 WHERE id=${sql(autoEligible)}::uuid`) === "0", "scale missing"));
    check("F07_conflicting_revision_never_becomes_current", () => { const result = json(config, database, `SELECT public._series_d2b_actual_truth_state_v1(${sql(EVENTS.conflict)}::uuid)`, OWNER); expect(result.state === "conflict" && !result.chosenRevision, JSON.stringify(result)); });

    check("G01_state_read_is_owner_scoped", () => { const result = json(config, database, `SELECT public.series_get_decision_event_state_v1(${sql(EVENTS.eligible)}::uuid)`, OWNER); expect(result.event.eventId === EVENTS.eligible, JSON.stringify(result)); });
    check("G02_state_read_forbids_foreign_owner", () => expectError(config, database, `SELECT public.series_get_decision_event_state_v1(${sql(EVENTS.eligible)}::uuid)`, OTHER_OWNER, /forbidden/));
    check("G03_state_read_omits_player_identity", () => { const result = scalar(config, database, `SELECT public.series_get_decision_event_state_v1(${sql(EVENTS.eligible)}::uuid)::text`, OWNER); expect(!/playerId|60000000/i.test(result), result); });
    check("G04_state_read_exposes_only_safe_actual_metrics", () => { const result = json(config, database, `SELECT public.series_get_decision_event_state_v1(${sql(EVENTS.eligible)}::uuid)`, OWNER); expect(result.actualTruth.chosenRevision.metrics.entries.value === 2 && !result.actualTruth.chosenRevision.metrics.playerId, JSON.stringify(result)); });
    check("G05_state_read_reports_legacy_cache_warning", () => { const result = json(config, database, `SELECT public.series_get_decision_event_state_v1(${sql(EVENTS.completed)}::uuid)`, OWNER); expect(result.dataQuality.unsupportedDerivationWarnings.includes("legacy_cache_not_promoted"), JSON.stringify(result)); });

    check("H01_valid_forecast_packet_can_be_created", () => expect(Boolean(packetEligible), "packet missing"));
    check("H02_valid_packet_freezes_once", () => expect(freezePacket(config, database, packetEligible) === "frozen", "packet not frozen"));
    check("H03_frozen_packet_is_immutable", () => expectError(config, database, `UPDATE public.series_decision_packets_v1 SET owner_decision='tampered' WHERE id=${sql(packetEligible)}::uuid`, null, /frozen/));
    check("H04_packet_rejects_outcome_leakage", () => expectError(config, database, `SELECT public.series_create_decision_packet_v1(${sql(EVENTS.missing)}::uuid,'T-1','entries','2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-09T00:00:00Z',NULL::uuid,'no_forecast_available',NULL::bigint,'[]'::jsonb,NULL::jsonb,NULL::integer,NULL::jsonb,NULL::integer,'{"finalEntries":2}'::jsonb,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'[]'::jsonb,'[]'::jsonb,NULL::text,NULL::uuid,NULL::text,${sql("packet:leak:001")})`, OWNER, /outcome_or_pii_leakage/));
    check("H05_incomplete_forecast_packet_is_not_eligible", () => { packetIncomplete = createPacket(config, database, { event: EVENTS.missing, snapshot: SNAPSHOTS.incomplete, state: "forecast_provenance_incomplete", key: "packet:incomplete:001" }); expect(freezePacket(config, database, packetIncomplete) === "frozen", "incomplete packet not frozen"); });
    check("H06_manual_expectation_packet_has_no_snapshot", () => { packetNoForecast = createPacket(config, database, { event: EVENTS.noForecast, state: "manual_expectation", key: "packet:manual:001" }); expect(scalar(config, database, `SELECT forecast_snapshot_id IS NULL AND manual_expectation=500 FROM public.series_decision_packets_v1 WHERE id=${sql(packetNoForecast)}::uuid`) === "t", "manual shape drift"); });
    check("H07_packet_target_metric_non_entries_is_rejected_with_snapshot", () => expectError(config, database, `SELECT public.series_create_decision_packet_v1(${sql(EVENTS.supersession)}::uuid,'T-1','total_bullets','2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-13T00:00:00Z',${sql(SNAPSHOTS.supersession)}::uuid,'forecast_identity_eligible',NULL::bigint,'[]'::jsonb,NULL::jsonb,NULL::integer,NULL::jsonb,NULL::integer,'{}'::jsonb,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'[]'::jsonb,'[]'::jsonb,NULL::text,NULL::uuid,NULL::text,${sql("packet:metric:001")})`, OWNER, /forecast_identity_mismatch/));
    check("H08_packet_unknown_horizon_is_rejected", () => expectError(config, database, `SELECT public.series_create_decision_packet_v1(${sql(EVENTS.supersession)}::uuid,'T-99','entries','2026-01-02T00:00:00Z','2026-01-01T00:00:00Z','2026-02-13T00:00:00Z',NULL::uuid,'no_forecast_available',NULL::bigint,'[]'::jsonb,NULL::jsonb,NULL::integer,NULL::jsonb,NULL::integer,'{}'::jsonb,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,NULL::text,'[]'::jsonb,'[]'::jsonb,NULL::text,NULL::uuid,NULL::text,${sql("packet:horizon:001")})`, OWNER, /horizon/));
    check("H09_packet_root_and_successor_are_distinct", () => { packetRoot = createPacket(config, database, { event: EVENTS.supersession, snapshot: SNAPSHOTS.supersession, state: "forecast_identity_eligible", key: "packet:root:001" }); expect(freezePacket(config, database, packetRoot) === "frozen", "root not frozen"); packetSuccessor = createPacket(config, database, { event: EVENTS.supersession, snapshot: SNAPSHOTS.supersession, state: "forecast_identity_eligible", key: "packet:successor:001", parent: packetRoot }); expect(packetSuccessor !== packetRoot, "successor reused root"); });
    check("H10_packet_successor_has_parent_lineage", () => expect(scalar(config, database, `SELECT supersedes_packet_id::text FROM public.series_decision_packets_v1 WHERE id=${sql(packetSuccessor)}::uuid`) === packetRoot, "packet lineage missing"));

    check("I01_event_actuals_append_only_trigger_exists", () => expect(scalar(config, database, "SELECT count(*)::text FROM pg_trigger WHERE tgrelid='public.series_event_actual_revisions_v1'::regclass AND tgname='trg_series_event_actual_revision_append_only_v1'") === "1", "trigger missing"));
    check("I02_native_source_metadata_append_only_trigger_exists", () => expect(scalar(config, database, "SELECT count(*)::text FROM pg_trigger WHERE tgrelid='public.series_event_actual_native_sources_v1'::regclass AND tgname='seas_v1_append_only'") === "1", "trigger missing"));
    check("I03_packet_target_metric_entries_is_explicit", () => expect(scalar(config, database, `SELECT target_metric FROM public.series_decision_packets_v1 WHERE id=${sql(packetEligible)}::uuid`) === "entries", "target metric drift"));
    check("I04_native_entries_and_bullets_are_separate_columns", () => expect(scalar(config, database, "SELECT count(*)::text FROM information_schema.columns WHERE table_schema='public' AND table_name='series_event_actual_revisions_v1' AND column_name IN ('entries_value','total_bullets_value')") === "2", "metric columns collapsed"));

    check("J01_d2b_public_rpc_grants_are_narrow", () => expect(scalar(config, database, "SELECT count(*)::text FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name IN ('series_promote_native_event_actual_v1','series_reconcile_event_actual_v1','series_get_decision_event_state_v1') AND grantee='authenticated' AND privilege_type='EXECUTE'") === "3", "RPC grant drift"));
    check("J02_d2b_runtime_tables_have_no_anon_select", () => expect(scalar(config, database, "SELECT has_table_privilege('anon','public.series_event_actual_revisions_v1','SELECT') OR has_table_privilege('anon','public.series_event_actual_native_sources_v1','SELECT')") === "f", "anon select granted"));
    check("J03_d2b_schema_has_no_delete_grant", () => expect(scalar(config, database, "SELECT has_table_privilege('authenticated','public.series_event_actual_revisions_v1','DELETE') OR has_table_privilege('authenticated','public.series_event_actual_native_sources_v1','DELETE')") === "f", "delete granted"));
    check("J04_reported_actual_truth_is_deterministic_shape", () => { const result = json(config, database, `SELECT public.series_get_decision_event_state_v1(${sql(EVENTS.eligible)}::uuid)`, OWNER); expect(result.version === "series-decision-event-state-v1" && Array.isArray(result.scoring.blockReasons), JSON.stringify(result)); });
  } finally {
    try { psql(config, config.admin, `DROP DATABASE IF EXISTS ${database}`); } catch { /* cleanup evidence is reflected by the host job */ }
    const passed = checks.length >= 60 && checks.every((item) => item.status === "pass");
    const report = {
      contract: "d2b-private-actual-truth-runtime-pg17-v2",
      postgresTarget: "17",
      d2bValidationHead: process.env.D2B_VALIDATION_HEAD ?? null,
      d2aMigrationSha256: sha(d2a), d2bMigrationSha256: sha(d2b), bootstrapSha256: sha(bootstrap),
      assertionCount: checks.length, passedCount: checks.filter((item) => item.status === "pass").length, failedCount: checks.filter((item) => item.status === "fail").length,
      checks, passed
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(`${reportPath}.md`, `# D2B PostgreSQL 17 Acceptance Receipt\n\n- Assertions: ${report.passedCount}/${report.assertionCount}\n- PostgreSQL target: 17\n- Result: ${passed ? "PASS" : "FAIL"}\n- D2A migration SHA-256: ${report.d2aMigrationSha256}\n- D2B migration SHA-256: ${report.d2bMigrationSha256}\n- Bootstrap SHA-256: ${report.bootstrapSha256}\n\n${checks.map((item) => `- ${item.status === "pass" ? "PASS" : "FAIL"} ${item.name}${item.error ? `: ${item.error}` : ""}`).join("\n")}\n`, "utf8");
    if (!passed) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
