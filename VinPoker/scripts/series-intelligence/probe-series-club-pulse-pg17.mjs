#!/usr/bin/env node
// Disposable PostgreSQL 17 execution probe for Series Club Pulse V1. The probe
// refuses non-local hosts, creates its own database, and always drops it.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");
const MIGRATION_PATH = join(APP_ROOT, "supabase", "migrations", "20270110000003_series_club_live_pulse_v1.sql");
const BOOTSTRAP_PATH = join(HERE, "disposable-series-club-pulse-pg17-bootstrap.sql");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const OWNER = "11111111-1111-4111-8111-111111111111";
const NON_OWNER = "99999999-9999-4999-8999-999999999999";
const CLUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_CLUB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

class ProbeError extends Error {
  constructor(message, sqlState = null) {
    super(message);
    this.sqlState = sqlState;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function args(argv) {
  if (argv.length !== 4 || argv[2] !== "--report") throw new Error("usage: probe-series-club-pulse-pg17.mjs --report <path>");
  return { reportPath: resolve(argv[3]) };
}

function config() {
  if (process.env.SERIES_PULSE_PG17_ALLOW_DISPOSABLE !== "1") throw new Error("SERIES_PULSE_PG17_ALLOW_DISPOSABLE=1 is required");
  const host = process.env.PGHOST ?? "127.0.0.1";
  if (!LOCAL_HOSTS.has(host)) throw new Error("Series Club Pulse probe refuses a non-local PostgreSQL host");
  return {
    host,
    port: process.env.PGPORT ?? "5432",
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    adminDatabase: process.env.SERIES_PULSE_PG17_ADMIN_DATABASE ?? "postgres",
    dockerContainer: process.env.SERIES_PULSE_PG17_DOCKER_CONTAINER ?? null,
  };
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(connection, database, sql, { actor, role } = {}) {
  const prelude = [
    actor === undefined ? "RESET request.jwt.claim.sub;" : `SET request.jwt.claim.sub TO ${quote(actor)};`,
    role ? `SET ROLE ${role};` : "",
  ].filter(Boolean).join("\n");
  const psqlArgs = [
    "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--set", "VERBOSITY=verbose",
    "--tuples-only", "--no-align", "--quiet", "--pset", "pager=off",
    "--host", connection.dockerContainer ? "127.0.0.1" : connection.host,
    "--port", connection.dockerContainer ? "5432" : connection.port,
    "--username", connection.user, "--dbname", database,
  ];
  const command = connection.dockerContainer ? "docker" : "psql";
  const commandArgs = connection.dockerContainer
    ? ["exec", "-i", "-e", `PGPASSWORD=${connection.password}`, connection.dockerContainer, "psql", ...psqlArgs]
    : psqlArgs;
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    input: `${prelude}\n${sql}\n${role ? "RESET ROLE;" : ""}\n`,
    env: { ...process.env, PGPASSWORD: connection.password, PAGER: "cat" },
  });
  if (result.error) throw new ProbeError(result.error.message);
  if (result.status !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const match = output.match(/ERROR:\s+([0-9A-Z]{5}):/);
    throw new ProbeError(output, match?.[1] ?? null);
  }
  return result.stdout.trim();
}

function scalar(connection, database, sql, session = {}) {
  const output = psql(connection, database, sql, session);
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new ProbeError(`expected one row, received ${lines.length}: ${output}`);
  return lines[0];
}

function pulse(connection, database, club = CLUB, actor = OWNER) {
  return JSON.parse(scalar(connection, database, `SELECT public.get_series_club_live_pulse_v1(${quote(club)}::uuid)::text;`, { actor, role: "authenticated" }));
}

function normalized(value) {
  const clone = structuredClone(value);
  clone.asOf = "<server-time>";
  for (const key of ["clubMemberProfiles", "uniquePlayersToday", "entriesToday", "playersPlayingNow", "runningEvents", "openTables", "dealersOnDuty"]) {
    clone[key].asOf = "<server-time>";
  }
  return JSON.stringify(clone);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const { reportPath } = args(process.argv);
  const connection = config();
  const [migration, bootstrap] = await Promise.all([readFile(MIGRATION_PATH), readFile(BOOTSTRAP_PATH)]);
  const migrationSha256 = sha256(migration);
  const database = `series_pulse_probe_${process.pid}_${Date.now()}`;
  const checks = [];
  let dropped = false;
  const check = async (name, run) => {
    try {
      await run();
      checks.push({ name, status: "pass" });
    } catch (error) {
      checks.push({ name, status: "fail", error: error instanceof Error ? error.message : String(error) });
    }
  };
  const deny = async (name, club, actor, role = "authenticated") => check(name, () => {
    try {
      psql(connection, database, `SELECT public.get_series_club_live_pulse_v1(${quote(club)}::uuid);`, { actor, role });
    } catch (error) {
      if (error instanceof ProbeError && error.sqlState === "42501") return;
      throw error;
    }
    throw new Error("expected SQLSTATE 42501");
  });

  try {
    psql(connection, connection.adminDatabase, `CREATE DATABASE ${database};`);
    psql(connection, database, bootstrap.toString("utf8"));
    psql(connection, database, migration.toString("utf8"));

    psql(connection, database, `
      INSERT INTO public.clubs (id, owner_id) VALUES
        (${quote(CLUB)}, ${quote(OWNER)}), (${quote(OTHER_CLUB)}, ${quote(NON_OWNER)});
      INSERT INTO public.club_settings (club_id, timezone) VALUES (${quote(CLUB)}, 'Asia/Ho_Chi_Minh');
      INSERT INTO public.club_members (id, club_id)
      SELECT ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, ${quote(CLUB)}::uuid
      FROM generate_series(1, 6) AS i;
      INSERT INTO public.club_members (id, club_id) VALUES ('20000000-0000-4000-8000-000000000001', ${quote(OTHER_CLUB)});

      WITH bounds AS (
        SELECT ((pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start_at
      )
      INSERT INTO public.tournaments (id, club_id, status, start_time, deleted_at)
      SELECT * FROM (VALUES
        ('30000000-0000-4000-8000-000000000001'::uuid, ${quote(CLUB)}::uuid, 'live', (SELECT start_at + interval '8 hours' FROM bounds), NULL::timestamptz),
        ('30000000-0000-4000-8000-000000000002', ${quote(CLUB)}, 'break', (SELECT start_at + interval '9 hours' FROM bounds), NULL),
        ('30000000-0000-4000-8000-000000000003', ${quote(CLUB)}, 'final_table', (SELECT start_at + interval '10 hours' FROM bounds), NULL),
        ('30000000-0000-4000-8000-000000000004', ${quote(CLUB)}, 'registering', (SELECT start_at + interval '1 day 8 hours' FROM bounds), NULL),
        ('30000000-0000-4000-8000-000000000005', ${quote(CLUB)}, 'live', (SELECT start_at + interval '11 hours' FROM bounds), pg_catalog.clock_timestamp()),
        ('30000000-0000-4000-8000-000000000006', ${quote(OTHER_CLUB)}, 'live', (SELECT start_at + interval '8 hours' FROM bounds), NULL),
        ('30000000-0000-4000-8000-000000000007', ${quote(CLUB)}, 'upcoming', (SELECT start_at - interval '16 hours' FROM bounds), NULL),
        ('30000000-0000-4000-8000-000000000008', ${quote(CLUB)}, 'cancelled', (SELECT start_at + interval '12 hours' FROM bounds), NULL),
        ('30000000-0000-4000-8000-000000000009', ${quote(CLUB)}, 'upcoming', (SELECT start_at + interval '30 minutes' FROM bounds), NULL)
      ) AS rows(id, club_id, status, start_time, deleted_at);

      WITH bounds AS (
        SELECT ((pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') AS start_at
      )
      INSERT INTO public.tournament_registrations (id, tournament_id, player_id, status, confirmed_at)
      SELECT * FROM (VALUES
        ('40000000-0000-4000-8000-000000000001'::uuid, '30000000-0000-4000-8000-000000000001'::uuid, '50000000-0000-4000-8000-000000000001'::uuid, 'confirmed', (SELECT start_at - interval '1 hour' FROM bounds)),
        ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'confirmed', (SELECT start_at + interval '2 hours' FROM bounds)),
        ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', 'confirmed', (SELECT start_at + interval '3 hours' FROM bounds)),
        ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', 'pending', (SELECT start_at + interval '4 hours' FROM bounds)),
        ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000004', 'confirmed', (SELECT start_at + interval '4 hours' FROM bounds)),
        ('40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000005', 'confirmed', (SELECT start_at + interval '1 hour' FROM bounds)),
        ('40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000006', 'confirmed', (SELECT start_at + interval '5 hours' FROM bounds)),
        ('40000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000007', 'confirmed', (SELECT start_at + interval '5 hours' FROM bounds)),
        ('40000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000008', 'confirmed', (SELECT start_at + interval '5 hours' FROM bounds)),
        ('40000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000009', 'confirmed', (SELECT start_at - interval '30 minutes' FROM bounds))
      ) AS rows(id, tournament_id, player_id, status, confirmed_at);

      INSERT INTO public.tournament_entries (id, tournament_id, registration_id, player_id, member_id) VALUES
        ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
        ('60000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
        ('60000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', NULL),
        ('60000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', NULL, '50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');

      INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_id, is_active, status) VALUES
        ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', true, 'active'),
        ('70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000003', true, 'active'),
        ('70000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000004', true, 'active'),
        ('70000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', NULL, false, 'busted');

      INSERT INTO public.tournament_tables (id, tournament_id, status) VALUES
        ('80000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'active'),
        ('80000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000004', 'active'),
        ('80000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'closed'),
        ('80000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000006', 'active');

      INSERT INTO public.dealers (id, club_id, deleted_at) VALUES
        ('90000000-0000-4000-8000-000000000001', ${quote(CLUB)}, NULL),
        ('90000000-0000-4000-8000-000000000002', ${quote(CLUB)}, NULL),
        ('90000000-0000-4000-8000-000000000003', ${quote(CLUB)}, NULL),
        ('90000000-0000-4000-8000-000000000004', ${quote(OTHER_CLUB)}, NULL);
      INSERT INTO public.dealer_attendance (id, dealer_id, status, check_out_time) VALUES
        ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'checked_in', NULL),
        ('91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', 'checked_in', NULL),
        ('91000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000003', 'checked_in', pg_catalog.clock_timestamp()),
        ('91000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000004', 'checked_in', NULL);
    `);

    const first = pulse(connection, database);
    const second = pulse(connection, database);
    const privilege = (role) => scalar(connection, database, `SELECT has_function_privilege(${quote(role)}, 'public.get_series_club_live_pulse_v1(uuid)', 'EXECUTE');`);

    await check("postgresql-major-version-is-17", () => assert(scalar(connection, database, "SHOW server_version_num;").startsWith("17"), "expected PostgreSQL 17"));
    await check("migration-hash-stable", async () => assert(sha256(await readFile(MIGRATION_PATH)) === migrationSha256, "migration changed during probe"));
    await check("function-exists", () => assert(scalar(connection, database, "SELECT to_regprocedure('public.get_series_club_live_pulse_v1(uuid)') IS NOT NULL;") === "t", "function missing"));
    await check("security-definer", () => assert(scalar(connection, database, "SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_series_club_live_pulse_v1(uuid)'::regprocedure;") === "t", "not SECURITY DEFINER"));
    await check("empty-search-path", () => assert(scalar(connection, database, "SELECT COALESCE('search_path=\"\"' = ANY(proconfig), false) FROM pg_proc WHERE oid = 'public.get_series_club_live_pulse_v1(uuid)'::regprocedure;") === "t", "search_path not empty"));
    await check("public-execute-revoked", () => assert(privilege("public") === "f", "PUBLIC can execute"));
    await check("anon-execute-revoked", () => assert(privilege("anon") === "f", "anon can execute"));
    await check("service-role-execute-revoked", () => assert(privilege("service_role") === "f", "service_role can execute"));
    await check("authenticated-execute-granted", () => assert(privilege("authenticated") === "t", "authenticated cannot execute"));
    await deny("anonymous-owner-claim-denied", CLUB, undefined);
    await deny("non-owner-denied", CLUB, NON_OWNER);
    await deny("cross-club-denied", OTHER_CLUB, OWNER);
    await deny("unknown-club-denied", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", OWNER);
    await check("version", () => assert(first.version === "series-club-live-pulse-v1", "version mismatch"));
    await check("club-id", () => assert(first.clubId === CLUB, "club mismatch"));
    await check("server-as-of-milliseconds", () => assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(first.asOf), "asOf not normalized"));
    await check("canonical-timezone", () => assert(first.timezone === "Asia/Ho_Chi_Minh", "timezone mismatch"));
    await check("club-local-date", () => assert(/^\d{4}-\d{2}-\d{2}$/.test(first.clubLocalDate), "local date missing"));
    await check("member-profiles", () => assert(first.clubMemberProfiles.value === 6, "member count mismatch"));
    await check("entries-today", () => assert(first.entriesToday.value === 4, "event-day entry count mismatch"));
    await check("unique-players-today", () => assert(first.uniquePlayersToday.value === 3, "event-day unique count mismatch"));
    await check("unique-player-partial-linkage", () => assert(first.uniquePlayersToday.availability === "partial", "partial linkage not disclosed"));
    await check("players-playing-now", () => {
      const identities = scalar(connection, database, `
        SELECT string_agg(DISTINCT COALESCE(te.member_id::text, ts.player_id::text), ',' ORDER BY COALESCE(te.member_id::text, ts.player_id::text))
        FROM public.tournament_seats ts
        JOIN public.tournaments t ON t.id = ts.tournament_id
        LEFT JOIN public.tournament_entries te ON te.id = ts.entry_id AND te.tournament_id = ts.tournament_id
        WHERE t.club_id = ${quote(CLUB)}::uuid AND t.deleted_at IS NULL
          AND t.status IN ('live','break','final_table') AND ts.is_active IS TRUE AND ts.status = 'active';
      `);
      assert(first.playersPlayingNow.value === 2, `playing count mismatch: ${JSON.stringify(first.playersPlayingNow)} identities=${identities}`);
    });
    await check("playing-now-partial-linkage", () => assert(first.playersPlayingNow.availability === "partial", "playing linkage not disclosed"));
    await check("running-events", () => assert(first.runningEvents.value === 3, "running count mismatch"));
    await check("open-tables", () => assert(first.openTables.value === 2, "open table count mismatch"));
    await check("dealers-on-duty", () => assert(first.dealersOnDuty.value === 2, "dealer count mismatch"));
    await check("small-cohort-privacy", () => assert(first.uniquePlayersToday.privacyState === "small_cohort_suppressed", "small cohort not protected"));
    await check("large-cohort-safe", () => assert(first.clubMemberProfiles.privacyState === "safe", "large cohort not marked safe"));
    await check("data-quality-partial-set", () => assert(JSON.stringify(first.dataQuality.partialMetricIds) === JSON.stringify(["unique_players_today", "players_playing_now"]), "partial set mismatch"));
    await check("no-unavailable-metrics", () => assert(first.dataQuality.unavailableMetricIds.length === 0, "unexpected unavailable metric"));
    await check("normalized-repeat-is-byte-identical", () => assert(normalized(first) === normalized(second), "normalized output drifted"));
    await check("no-raw-member-id", () => assert(!JSON.stringify(first).includes("10000000-0000-4000-8000"), "member id leaked"));
    await check("no-raw-dealer-id", () => assert(!JSON.stringify(first).includes("90000000-0000-4000-8000"), "dealer id leaked"));

    const isolateRegistration = (registrationId) => {
      psql(connection, database, `
        UPDATE public.tournament_registrations SET status = 'pending';
        UPDATE public.tournament_registrations SET status = 'confirmed'
        WHERE id = ${quote(registrationId)}::uuid;
      `);
      return pulse(connection, database);
    };
    await check("event-today-registration-yesterday-counted", () => assert(isolateRegistration("40000000-0000-4000-8000-000000000001").entriesToday.value === 1, "prior-day registration was not counted for today's event"));
    await check("event-today-registration-today-counted", () => assert(isolateRegistration("40000000-0000-4000-8000-000000000003").entriesToday.value === 1, "same-day registration was not counted"));
    await check("event-tomorrow-registration-today-excluded", () => assert(isolateRegistration("40000000-0000-4000-8000-000000000005").entriesToday.value === 0, "tomorrow's event leaked into today"));
    await check("event-yesterday-registration-today-excluded", () => assert(isolateRegistration("40000000-0000-4000-8000-000000000007").entriesToday.value === 0, "yesterday's event leaked into today"));
    await check("deleted-event-excluded", () => assert(isolateRegistration("40000000-0000-4000-8000-000000000008").entriesToday.value === 0, "deleted event was counted"));
    await check("cancelled-event-excluded", () => assert(isolateRegistration("40000000-0000-4000-8000-000000000009").entriesToday.value === 0, "cancelled event was counted"));
    await check("local-day-crossing-counted", () => assert(isolateRegistration("40000000-0000-4000-8000-000000000010").entriesToday.value === 1, "local midnight event was not counted"));
    await check("dst-boundary-uses-zone-aware-instants", () => {
      const hours = Number(scalar(connection, database, `
        SELECT EXTRACT(epoch FROM (
          ('2026-03-09'::date::timestamp AT TIME ZONE 'America/New_York')
          - ('2026-03-08'::date::timestamp AT TIME ZONE 'America/New_York')
        )) / 3600;
      `));
      assert(hours === 23, `expected a 23-hour DST day, received ${hours}`);
    });
    psql(connection, database, `
      UPDATE public.tournament_registrations
      SET status = CASE WHEN id = '40000000-0000-4000-8000-000000000004'::uuid THEN 'pending' ELSE 'confirmed' END;
    `);

    psql(connection, database, `UPDATE public.club_settings SET timezone = NULL WHERE club_id = ${quote(CLUB)};`);
    const missingTimezone = pulse(connection, database);
    await check("missing-timezone-null-local-date", () => assert(missingTimezone.clubLocalDate === null && missingTimezone.timezone === null, "timezone did not fail closed"));
    await check("missing-timezone-entries-unavailable", () => assert(missingTimezone.entriesToday.value === null && missingTimezone.entriesToday.unavailableReason === "CLUB_TIMEZONE_UNAVAILABLE", `entries did not fail closed: ${JSON.stringify(missingTimezone.entriesToday)}`));
    await check("missing-timezone-unique-unavailable", () => assert(missingTimezone.uniquePlayersToday.value === null && missingTimezone.uniquePlayersToday.unavailableReason === "CLUB_TIMEZONE_UNAVAILABLE", `unique did not fail closed: ${JSON.stringify(missingTimezone.uniquePlayersToday)}`));
    await check("missing-timezone-does-not-zero", () => assert(!missingTimezone.dataQuality.unavailableMetricIds.includes("running_events") && missingTimezone.runningEvents.value === 3, "unrelated metric lost"));

    psql(connection, database, `UPDATE public.club_settings SET timezone = 'Invalid/Zone' WHERE club_id = ${quote(CLUB)};`);
    await check("invalid-timezone-fails-closed", () => assert(pulse(connection, database).entriesToday.unavailableReason === "CLUB_TIMEZONE_UNAVAILABLE", "invalid timezone accepted"));

    psql(connection, database, "DROP TABLE public.dealers;");
    const missingSource = pulse(connection, database);
    await check("missing-source-unavailable", () => assert(missingSource.dealersOnDuty.value === null && missingSource.dealersOnDuty.unavailableReason === "SOURCE_UNAVAILABLE", `missing source did not fail closed: ${JSON.stringify(missingSource.dealersOnDuty)}`));
    await check("missing-source-not-zero", () => assert(missingSource.dealersOnDuty.value !== 0, "missing source became zero"));
    await check("missing-source-is-not-exportable", () => assert(missingSource.dealersOnDuty.privacyState === "not_exportable", "missing source exportable"));
  } finally {
    try {
      psql(connection, connection.adminDatabase, `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);
      dropped = true;
    } catch (error) {
      checks.push({ name: "drop-disposable-database", status: "fail", error: error instanceof Error ? error.message : String(error) });
    }
  }

  checks.push({ name: "drop-disposable-database", status: dropped ? "pass" : "fail" });
  const report = {
    version: "series-club-pulse-pg17-probe-v1",
    migrationSha256,
    postgresMajor: 17,
    checkCount: checks.length,
    passed: checks.filter((item) => item.status === "pass").length,
    failed: checks.filter((item) => item.status === "fail").length,
    checks,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.failed > 0) throw new Error(`${report.failed} PostgreSQL probe checks failed; see ${reportPath}`);
  process.stdout.write(`${report.passed}/${report.checkCount} Club Pulse PostgreSQL 17 checks passed\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
