#!/usr/bin/env node
// Disposable PostgreSQL 17 probe for Series V candidate and rate-limit contracts.

import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");
const MIGRATIONS = [
  join(APP_ROOT, "supabase/migrations/20270110000004_series_v_candidate_and_rate_limit_v1.sql"),
  join(APP_ROOT, "supabase/migrations/20270111000000_series_v_candidate_authoring_v1.sql"),
  join(APP_ROOT, "supabase/migration-archive/historical-never-replay/20270112000001_series_v_candidate_authoring_source_state_compatibility.sql"),
  join(APP_ROOT, "supabase/migration-archive/historical-never-replay/20270112000002_series_v_candidate_authoring_live_registration_compatibility.sql"),
];
const BOOTSTRAP = join(HERE, "disposable-series-club-pulse-pg17-bootstrap.sql");
const CONTAINER = process.env.SERIES_V_PG17_DOCKER_CONTAINER ?? "supabase_db_vinpoker-test-canonical-v1";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CLUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function quote(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function args(database) {
  return ["exec", "-i", "-e", "PGPASSWORD=postgres", CONTAINER, "psql", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet", "--username", "postgres", "--dbname", database];
}
function run(database, sql, actor) {
  const prelude = actor ? `SET request.jwt.claim.sub TO ${quote(actor)}; SET ROLE authenticated;` : "";
  const result = spawnSync("docker", args(database), { input: `${prelude}\n${sql}\n${actor ? "RESET ROLE;" : ""}`, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`.trim());
  return result.stdout.trim();
}
function runAsync(database, sql, actor) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args(database), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value) => { stdout += value; });
    child.stderr.setEncoding("utf8").on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(`${stdout}\n${stderr}`.trim())));
    child.stdin.end(`SET request.jwt.claim.sub TO ${quote(actor)}; SET ROLE authenticated;\n${sql}\nRESET ROLE;\n`);
  });
}
function assert(value, message) { if (!value) throw new Error(message); }

async function main() {
  if (process.env.SERIES_V_PG17_ALLOW_DISPOSABLE !== "1") throw new Error("SERIES_V_PG17_ALLOW_DISPOSABLE=1 is required");
  const database = `series_v_probe_${process.pid}_${Date.now()}`;
  const [bootstrap, ...migrations] = await Promise.all([readFile(BOOTSTRAP, "utf8"), ...MIGRATIONS.map((migration) => readFile(migration, "utf8"))]);
  try {
    run("postgres", `CREATE DATABASE ${database};`);
    run(database, bootstrap);
    run(database, `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE OR REPLACE FUNCTION public._series_sha256_jsonb_v1(p_value jsonb)
      RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
        SELECT pg_catalog.encode(public.digest(pg_catalog.convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex')
      $$;
      REVOKE ALL ON FUNCTION public._series_sha256_jsonb_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;
    `);
    for (const migration of migrations) run(database, migration);
    run(database, `INSERT INTO public.clubs(id, owner_id) VALUES (${quote(CLUB)}::uuid, ${quote(OWNER)}::uuid);`);

    const evidence = JSON.stringify([{
      evidenceId: "owner_schedule_review", labelVi: "Owner schedule review",
      sourceId: "series_schedule_candidates_v1", asOf: "2026-08-09T00:00:00.000Z",
      quality: "owner_scoped_server_aggregate", privacyState: "safe", metricIds: [],
    }]).replaceAll("'", "''");
    const approveSql = (label = "Option A", buyIn = 2000000, manifest = evidence) => `SELECT public.series_approve_schedule_candidate_v1(
      ${quote(CLUB)}::uuid, 'option_a', 'owner_authored', ${quote(label)},
      ${buyIn}, 200000000, 2, NULL, 2000000, 'complete', 'unknown', 'unknown',
      '${manifest}'::jsonb
    )::text;`;
    const first = JSON.parse(run(database, approveSql(), OWNER));
    const retry = JSON.parse(run(database, approveSql(), OWNER));
    assert(first.candidateId === retry.candidateId && first.revision === 1, "candidate approval is not idempotent");
    const revised = JSON.parse(run(database, approveSql("Option A revised"), OWNER));
    assert(revised.candidateId !== first.candidateId && revised.revision === 2, "source change did not create an explicit revision");
    let negativeRejected = false;
    try { run(database, approveSql("Invalid negative", -1), OWNER); } catch { negativeRejected = true; }
    assert(negativeRejected, "negative money was accepted");
    const source = JSON.parse(run(database, `SELECT public.series_get_approved_schedule_candidates_v1(${quote(CLUB)}::uuid, ARRAY['option_a'])::text;`, OWNER));
    assert(source.candidateOptions.length === 1, "approved candidate missing");
    assert(source.candidateOptions[0].requiredField === 100, "required field was not derived");
    assert(source.candidateOptions[0].capacityState === "unknown" && source.candidateOptions[0].collisionState === "unknown", "missing evidence was invented");

    let crossClubDenied = false;
    try { run(database, `SELECT public.series_get_approved_schedule_candidates_v1(${quote(CLUB)}::uuid, NULL);`, OTHER); } catch (error) { crossClubDenied = String(error).includes("series_v_candidate_forbidden"); }
    assert(crossClubDenied, "cross-club candidate read was not denied");

    const eligibleTournament = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const preStartLiveTournament = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const playingTournament = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const clockStartedTournament = "abababab-abab-4bab-8bab-abababababab";
    const registrationClosedTournament = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
    run(database, `INSERT INTO public.tournaments(
      id, club_id, status, start_time, name, buy_in, guarantee_amount, rake_amount, service_fee_amount
    ) VALUES (
      ${quote(eligibleTournament)}::uuid, ${quote(CLUB)}::uuid, 'active',
      pg_catalog.clock_timestamp() + interval '7 days', 'Production candidate canary',
      3000000, 200000000, 300000, 0
    );`);
    run(database, `INSERT INTO public.tournaments(
      id, club_id, status, live_status, start_time, name, buy_in
    ) VALUES (
      ${quote(preStartLiveTournament)}::uuid, ${quote(CLUB)}::uuid, 'live', 'registering',
      pg_catalog.clock_timestamp() + interval '7 days', 'Pre-start registration is open',
      3000000
    );`);
    run(database, `INSERT INTO public.tournaments(
      id, club_id, status, live_status, start_time, name, buy_in, clock_started_at, registration_closed_at
    ) VALUES
      (${quote(playingTournament)}::uuid, ${quote(CLUB)}::uuid, 'live', 'playing', pg_catalog.clock_timestamp() + interval '7 days', 'Playing must remain excluded', 3000000, NULL, NULL),
      (${quote(clockStartedTournament)}::uuid, ${quote(CLUB)}::uuid, 'live', 'registering', pg_catalog.clock_timestamp() + interval '7 days', 'Started clock must remain excluded', 3000000, pg_catalog.clock_timestamp(), NULL),
      (${quote(registrationClosedTournament)}::uuid, ${quote(CLUB)}::uuid, 'live', 'registering', pg_catalog.clock_timestamp() + interval '7 days', 'Closed registration must remain excluded', 3000000, NULL, pg_catalog.clock_timestamp());`);
    const sourceList = JSON.parse(run(database, `SELECT public.series_list_schedule_candidate_sources_v1(${quote(CLUB)}::uuid)::text;`, OWNER));
    assert(sourceList.sources.length === 2, "authoring source list did not return the two eligible future tournaments");
    assert(sourceList.sources.some((source) => source.tournamentId === eligibleTournament), "authoring source list omitted the active future tournament");
    assert(sourceList.sources.some((source) => source.tournamentId === preStartLiveTournament), "authoring source list omitted the pre-start live/registering tournament");
    assert(!sourceList.sources.some((source) => source.tournamentId === playingTournament), "authoring source list included a playing tournament");
    assert(!sourceList.sources.some((source) => source.tournamentId === clockStartedTournament), "authoring source list included a tournament whose clock started");
    assert(!sourceList.sources.some((source) => source.tournamentId === registrationClosedTournament), "authoring source list included a tournament whose registration closed");
    const preview = JSON.parse(run(database, `SELECT public.series_preview_schedule_candidate_v1(${quote(CLUB)}::uuid, ${quote(eligibleTournament)}::uuid)::text;`, OWNER));
    assert(preview.state === "ready" && preview.optionId === `tournament:${eligibleTournament}`, "authoring preview was not ready for the exact eligible tournament");
    assert(preview.fields.buyInVnd.value === "3000000" && preview.fields.scheduleGtdVnd.value === "200000000", "authoring preview did not preserve schedule money facts");
    assert(preview.fields.prizeContributionPerEntryVnd.value === null, "authoring preview inferred prize contribution from buy-in");
    const preStartLivePreview = JSON.parse(run(database, `SELECT public.series_preview_schedule_candidate_v1(${quote(CLUB)}::uuid, ${quote(preStartLiveTournament)}::uuid)::text;`, OWNER));
    assert(preStartLivePreview.state === "ready", "authoring preview blocked a pre-start live/registering tournament");
    for (const blockedTournament of [playingTournament, clockStartedTournament, registrationClosedTournament]) {
      const blockedPreview = JSON.parse(run(database, `SELECT public.series_preview_schedule_candidate_v1(${quote(CLUB)}::uuid, ${quote(blockedTournament)}::uuid)::text;`, OWNER));
      assert(blockedPreview.state === "blocked" && blockedPreview.blockers.includes("scheduled_tournament_required"), `authoring preview accepted blocked tournament ${blockedTournament}`);
      let blockedApprovalRejected = false;
      try {
        run(database, `SELECT public.series_approve_schedule_candidate_from_tournament_v1(
          ${quote(CLUB)}::uuid, ${quote(blockedTournament)}::uuid, 200000000, 2000000, 1, NULL
        )::text;`, OWNER);
      } catch (error) {
        blockedApprovalRejected = String(error).includes("series_v_candidate_scheduled_future_tournament_required");
      }
      assert(blockedApprovalRejected, `authoring approval accepted blocked tournament ${blockedTournament}`);
    }

    const approveFromTournament = (gtd = 200000000, prizeContribution = 2000000) => `SELECT public.series_approve_schedule_candidate_from_tournament_v1(
      ${quote(CLUB)}::uuid, ${quote(eligibleTournament)}::uuid, ${gtd}, ${prizeContribution}, 1, NULL
    )::text;`;
    const authoredFirst = JSON.parse(run(database, approveFromTournament(), OWNER));
    const authoredRetry = JSON.parse(run(database, approveFromTournament(), OWNER));
    assert(authoredFirst.candidateId === authoredRetry.candidateId && authoredFirst.revision === 1, "authoring approval was not idempotent");
    const authoredOptionId = `tournament:${eligibleTournament}`;
    const authoredReadback = JSON.parse(run(database, `SELECT public.series_get_approved_schedule_candidates_v1(${quote(CLUB)}::uuid, ARRAY[${quote(authoredOptionId)}])::text;`, OWNER));
    assert(authoredReadback.candidateOptions.length === 1 && authoredReadback.candidateOptions[0].requiredField === 100, "authoring approval did not produce one verified readback candidate");
    const preStartLiveAuthored = JSON.parse(run(database, `SELECT public.series_approve_schedule_candidate_from_tournament_v1(
      ${quote(CLUB)}::uuid, ${quote(preStartLiveTournament)}::uuid, 200000000, 2000000, 1, NULL
    )::text;`, OWNER));
    assert(preStartLiveAuthored.optionId === `tournament:${preStartLiveTournament}`, "authoring approval did not preserve the pre-start live tournament identity");
    let gtdMismatchRejected = false;
    try { run(database, approveFromTournament(200000001), OWNER); } catch (error) { gtdMismatchRejected = String(error).includes("series_v_candidate_gtd_mismatch"); }
    assert(gtdMismatchRejected, "authoring approval accepted a GTD that mismatched the current schedule");
    let authoringCrossClubDenied = false;
    try { run(database, `SELECT public.series_preview_schedule_candidate_v1(${quote(CLUB)}::uuid, ${quote(eligibleTournament)}::uuid);`, OTHER); } catch (error) { authoringCrossClubDenied = String(error).includes("series_v_candidate_preview_forbidden"); }
    assert(authoringCrossClubDenied, "authoring preview allowed another club owner");

    const sameRequest = "30000000-0000-4000-8000-000000000001";
    const consume = (id) => `SELECT public.series_consume_copilot_rate_limit_v1(${quote(CLUB)}::uuid, ${quote(id)}::uuid)::text;`;
    const one = JSON.parse(run(database, consume(sameRequest), OWNER));
    const two = JSON.parse(run(database, consume(sameRequest), OWNER));
    assert(one.allowed && two.allowed, "idempotent accepted request changed result");
    assert(run(database, "SELECT count(*) FROM public.series_copilot_rate_limit_requests_v1;") === "1", "same request consumed quota twice");

    run(database, "TRUNCATE public.series_copilot_rate_limit_requests_v1;");
    const raced = await Promise.all(Array.from({ length: 10 }, (_, index) => runAsync(
      database,
      consume(`40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
      OWNER,
    )));
    const allowed = raced.map(JSON.parse).filter((item) => item.allowed).length;
    assert(allowed === 5, `expected exactly 5 concurrent requests, received ${allowed}`);
    assert(run(database, "SELECT count(*) FROM public.series_copilot_rate_limit_requests_v1;") === "5", "denied requests created unbounded rows");

    assert(run(database, "SHOW server_version_num;").startsWith("17"), "PostgreSQL major is not 17");
    process.stdout.write("Series V PostgreSQL 17 checks passed\n");
  } finally {
    run("postgres", `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
