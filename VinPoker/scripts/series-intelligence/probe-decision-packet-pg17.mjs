#!/usr/bin/env node
// Disposable PostgreSQL 17 execution probe for D2A. It refuses non-local hosts
// and creates then drops its own database. It never contacts Supabase.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");
const MIGRATION_PATH = join(APP_ROOT, "supabase", "migrations", "20270107000001_series_decision_packet_v1.sql");
const BOOTSTRAP_PATH = join(HERE, "disposable-decision-packet-pg17-bootstrap.sql");
const VECTOR_PATH = join(APP_ROOT, "src", "lib", "series-intelligence", "fixtures", "decisionPacketCanonicalV1.vectors.json");
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const NON_OWNER_ID = "99999999-9999-4999-8999-999999999999";
const CLUB_ID = "abcdefab-cdef-4abc-8abc-abcdefabcdef";
const OTHER_CLUB_ID = "fedcbafe-dcba-4fed-8fed-fedcbafedcba";
const EVENT_ID = "bcdefabc-defa-4bcd-8bcd-bcdefabcdef1";
const REORDER_EVENT_ID = "cdefabcd-efab-4cde-8cde-cdefabcdef12";
const OTHER_EVENT_ID = "defabcde-fabc-4def-8def-defabcdef123";
const SNAPSHOT_ID = "efabcdef-abcd-4efa-8efa-efabcdef1234";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

class ProbeError extends Error {
  constructor(message, sqlState = null) {
    super(message);
    this.name = "ProbeError";
    this.sqlState = sqlState;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireDisposableEnvironment() {
  if (process.env.D2A_PG17_ALLOW_DISPOSABLE !== "1") {
    throw new Error("D2A_PG17_ALLOW_DISPOSABLE=1 is required");
  }
  const host = process.env.PGHOST ?? "127.0.0.1";
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("D2A probe refuses a non-local PostgreSQL host");
  }
  return {
    host,
    port: process.env.PGPORT ?? "5432",
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    adminDatabase: process.env.D2A_PG17_ADMIN_DATABASE ?? "postgres",
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length !== 2 || args[0] !== "--report") {
    throw new Error("usage: probe-decision-packet-pg17.mjs --report <path>");
  }
  return { reportPath: resolve(args[1]) };
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function jsonLiteral(value) {
  return `${sqlString(JSON.stringify(value))}::jsonb`;
}

function uuidLiteral(value) {
  return `${sqlString(value)}::uuid`;
}

function timestampLiteral(value) {
  return `${sqlString(value)}::timestamptz`;
}

function toBase64(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function toUtf8Hex(value) {
  return Buffer.from(value, "utf8").toString("hex");
}

function psql(config, database, sql, { actor = undefined, role = undefined } = {}) {
  const prelude = [
    actor === undefined
      ? "RESET request.jwt.claim.sub;"
      : `SET request.jwt.claim.sub TO ${sqlString(actor)};`,
    role ? `SET ROLE ${role};` : "",
  ].filter(Boolean).join("\n");
  const epilogue = role ? "\nRESET ROLE;" : "";
  const result = spawnSync("psql", [
    "--no-psqlrc",
    "--set", "ON_ERROR_STOP=1",
    "--set", "VERBOSITY=verbose",
    "--tuples-only",
    "--no-align",
    "--quiet",
    "--pset", "pager=off",
    "--pset", "columns=100000",
    "--host", config.host,
    "--port", config.port,
    "--username", config.user,
    "--dbname", database,
  ], {
    encoding: "utf8",
    input: `${prelude}\n${sql}${epilogue}\n`,
    env: {
      ...process.env,
      COLUMNS: "100000",
      PAGER: "cat",
      PGHOST: config.host,
      PGPORT: config.port,
      PGUSER: config.user,
      PGPASSWORD: config.password,
    },
  });
  if (result.error) throw new ProbeError(`psql execution failed: ${result.error.message}`);
  if (result.status !== 0) {
    const combined = `${result.stdout}\n${result.stderr}`;
    const match = combined.match(/ERROR:\s+([0-9A-Z]{5}):/);
    throw new ProbeError(combined.trim(), match?.[1] ?? null);
  }
  return result.stdout.trim();
}

function queryScalar(config, database, sql, session = {}) {
  const output = psql(config, database, sql, session);
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) {
    throw new ProbeError(`expected one scalar row, received ${lines.length}: ${output}`);
  }
  return lines[0];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function packetCall({
  eventId = EVENT_ID,
  idempotencyKey,
  evidence = [],
  knownInformation = {},
  alternatives = [],
  assumptions = [],
  recommendedAction = null,
  recommendationSourceKind = null,
  recommendationSourceRef = null,
  sourceCutoff = "2020-01-01T01:00:00.000Z",
  asOfTs = "2020-01-01T02:00:00.000Z",
  targetEventTs = "2020-01-03T10:00:00.000Z",
  forecastSnapshotId = null,
  forecastState = "no_forecast_available",
  manualExpectation = null,
  registrationSlice = null,
  registrationObservationCount = null,
  campaignSlice = null,
  campaignObservationCount = null,
  supersedesPacketId = null,
  correctionReason = null,
} = {}) {
  return `public.series_create_decision_packet_v1(
    ${uuidLiteral(eventId)}, 'T-7', 'entries', ${timestampLiteral(asOfTs)},
    ${timestampLiteral(sourceCutoff)}, ${timestampLiteral(targetEventTs)},
    ${forecastSnapshotId ? uuidLiteral(forecastSnapshotId) : "NULL"}, ${sqlString(forecastState)},
    ${manualExpectation === null ? "NULL" : String(manualExpectation)}, ${jsonLiteral(evidence)},
    ${registrationSlice === null ? "NULL" : jsonLiteral(registrationSlice)},
    ${registrationObservationCount === null ? "NULL" : String(registrationObservationCount)},
    ${campaignSlice === null ? "NULL" : jsonLiteral(campaignSlice)},
    ${campaignObservationCount === null ? "NULL" : String(campaignObservationCount)},
    ${jsonLiteral(knownInformation)}, ${recommendedAction === null ? "NULL" : sqlString(recommendedAction)},
    ${recommendationSourceKind === null ? "NULL" : sqlString(recommendationSourceKind)},
    ${recommendationSourceRef === null ? "NULL" : sqlString(recommendationSourceRef)},
    NULL, NULL, NULL, ${jsonLiteral(alternatives)}, ${jsonLiteral(assumptions)}, NULL,
    ${supersedesPacketId === null ? "NULL" : uuidLiteral(supersedesPacketId)},
    ${correctionReason === null ? "NULL" : sqlString(correctionReason)}, ${sqlString(idempotencyKey)}
  )`;
}

function actualCall({
  eventId = EVENT_ID,
  idempotencyKey,
  finality = "final",
  sourceTimestamp = "2020-01-04T10:00:00.000Z",
  entriesAvailability = "present",
  entriesValue = 100,
  prizePoolAvailability = "present",
  prizePoolAmount = "600000000",
  prizePoolCurrency = "vnd",
  overlayAvailability = "explicit_zero",
  overlayAmount = "0",
  overlayCurrency = "vnd",
  supersedesRevisionId = null,
  correctionReason = null,
} = {}) {
  const bigint = (value) => value === null ? "NULL::bigint" : `${value}::bigint`;
  const numeric = (value) => value === null ? "NULL::numeric" : `${value}::numeric`;
  return `public.series_record_event_actual_v1(
    ${uuidLiteral(eventId)}, 'event_total', ${sqlString(finality)}, 'exact', ${timestampLiteral(sourceTimestamp)},
    ${sqlString(entriesAvailability)}, ${bigint(entriesValue)},
    'present', 70::bigint, 'present', 100::bigint, 'present', 30::bigint, 'present', 100::bigint, 'present', 15::bigint,
    ${sqlString(prizePoolAvailability)}, ${numeric(prizePoolAmount)},
    ${prizePoolCurrency === null ? "NULL::text" : sqlString(prizePoolCurrency)}, 0::smallint,
    ${sqlString(overlayAvailability)}, ${numeric(overlayAmount)},
    ${overlayCurrency === null ? "NULL::text" : sqlString(overlayCurrency)}, 0::smallint,
    ${supersedesRevisionId === null ? "NULL::uuid" : uuidLiteral(supersedesRevisionId)},
    ${sqlString(idempotencyKey)}, ${correctionReason === null ? "NULL::text" : sqlString(correctionReason)}
  )`;
}

async function main() {
  const { reportPath } = parseArgs(process.argv);
  const config = requireDisposableEnvironment();
  const [migration, bootstrap, vectorText] = await Promise.all([
    readFile(MIGRATION_PATH),
    readFile(BOOTSTRAP_PATH),
    readFile(VECTOR_PATH, "utf8"),
  ]);
  const vectors = JSON.parse(vectorText);
  const migrationSha256 = sha256(migration);
  const vectorSha256 = sha256(vectorText);
  if (process.env.D2A_EXPECTED_MIGRATION_SHA && process.env.D2A_EXPECTED_MIGRATION_SHA !== migrationSha256) {
    throw new Error("migration SHA-256 differs from the reviewed probe input");
  }
  if (process.env.D2A_EXPECTED_VECTOR_SHA && process.env.D2A_EXPECTED_VECTOR_SHA !== vectorSha256) {
    throw new Error("vector SHA-256 differs from the reviewed probe input");
  }

  const database = `d2a_probe_${process.pid}_${Date.now()}`;
  const checks = [];
  let databaseDropped = false;
  const check = async (name, callback) => {
    try {
      await callback();
      checks.push({ name, status: "pass" });
    } catch (error) {
      checks.push({ name, status: "fail", error: error instanceof Error ? error.message : String(error) });
    }
  };
  const expectSqlState = async (name, sql, expectedState, session = {}) => {
    await check(name, () => {
      try {
        psql(config, database, sql, session);
      } catch (error) {
        if (error instanceof ProbeError && error.sqlState === expectedState) return;
        throw error;
      }
      throw new Error(`expected SQLSTATE ${expectedState}`);
    });
  };

  try {
    psql(config, config.adminDatabase, `CREATE DATABASE ${database};`);
    psql(config, database, bootstrap.toString("utf8"));
    psql(config, database, migration.toString("utf8"));

    const version = queryScalar(config, database, "SHOW server_version_num;");
    await check("postgresql-major-version-is-17", () => assert(version.startsWith("17"), `expected PostgreSQL 17, got ${version}`));
    await check("migration-hash-bound", async () => assert(sha256(await readFile(MIGRATION_PATH)) === migrationSha256, "migration changed during probe"));
    await check("vector-hash-bound", async () => assert(sha256(await readFile(VECTOR_PATH, "utf8")) === vectorSha256, "vectors changed during probe"));

    psql(config, database, `
      INSERT INTO public.clubs (id, owner_id) VALUES
        (${uuidLiteral(CLUB_ID)}, ${uuidLiteral(OWNER_ID)}),
        (${uuidLiteral(OTHER_CLUB_ID)}, ${uuidLiteral(NON_OWNER_ID)});
      INSERT INTO public.tournaments (id, club_id, start_time, status) VALUES
        (${uuidLiteral(EVENT_ID)}, ${uuidLiteral(CLUB_ID)}, '2020-01-03T10:00:00.000Z', 'scheduled'),
        (${uuidLiteral(REORDER_EVENT_ID)}, ${uuidLiteral(CLUB_ID)}, '2020-01-03T10:00:00.000Z', 'scheduled'),
        (${uuidLiteral(OTHER_EVENT_ID)}, ${uuidLiteral(OTHER_CLUB_ID)}, '2020-01-03T10:00:00.000Z', 'scheduled');
      INSERT INTO public.series_forecast_snapshots (
        id, club_id, event_id, forecast_issued_at, as_of_ts, target_event_ts,
        forecast_identity_eligible, provenance_completeness
      ) VALUES (
        ${uuidLiteral(SNAPSHOT_ID)}, ${uuidLiteral(CLUB_ID)}, ${uuidLiteral(EVENT_ID)},
        '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '2020-01-04T10:00:00.000Z',
        true, 'complete'
      );
    `);

    for (const vector of vectors.vectors) {
      const input = toBase64(JSON.stringify(vector.payload));
      const sql = `
        WITH payload AS (
          SELECT convert_from(decode(${sqlString(input)}, 'base64'), 'UTF8')::jsonb AS value
        )
        SELECT encode(convert_to(public._series_canonical_json_v1(value), 'UTF8'), 'hex')
          || '|' || public._series_sha256_jsonb_v1(value)
        FROM payload;
      `;
      await check(`vector-canonical-text:${vector.id}`, () => {
        const [actualText] = queryScalar(config, database, sql).split("|");
        assert(actualText === toUtf8Hex(vector.canonicalText), "canonical UTF-8 bytes differ");
      });
      await check(`vector-sha256:${vector.id}`, () => {
        const [, actualHash] = queryScalar(config, database, sql).split("|");
        assert(actualHash === vector.sha256, "SHA-256 digest differs");
      });
    }

    await check("nfc-equivalent-vectors-share-hash", () => {
      const first = vectors.vectors.find((vector) => vector.id === "generic-nfc-object");
      const second = vectors.vectors.find((vector) => vector.id === "generic-key-order-reversed");
      assert(first?.sha256 === second?.sha256, "NFC equivalent values drifted");
    });
    await check("set-order-normalized-vectors-share-hash", () => {
      const first = vectors.vectors.find((vector) => vector.id === "normalized-set-forward");
      const second = vectors.vectors.find((vector) => vector.id === "normalized-set-reversed");
      assert(first?.sha256 === second?.sha256, "set normalization drifted");
    });
    await check("semantic-array-order-changes-hash", () => {
      const first = vectors.vectors.find((vector) => vector.id === "semantic-array-forward");
      const second = vectors.vectors.find((vector) => vector.id === "semantic-array-reversed");
      assert(first?.sha256 !== second?.sha256, "semantic array order was erased");
    });
    await expectSqlState(
      "unsafe-canonical-number-fails-closed",
      "SELECT public._series_canonical_json_v1('{\"count\":9007199254740992}'::jsonb);",
      "22023",
    );
    await expectSqlState(
      "fractional-canonical-number-fails-closed",
      "SELECT public._series_canonical_json_v1('{\"count\":1.5}'::jsonb);",
      "22023",
    );

    const packetRoot = queryScalar(
      config,
      database,
      `SELECT (${packetCall({ idempotencyKey: "packet:probe-root-1" })}).id::text;`,
      { actor: OWNER_ID, role: "authenticated" },
    );
    checks.push({ name: "packet-create-root", status: "pass" });
    await check("packet-identical-idempotent-replay", () => {
      const replay = queryScalar(config, database, `SELECT (${packetCall({ idempotencyKey: "packet:probe-root-1" })}).id::text;`, { actor: OWNER_ID, role: "authenticated" });
      assert(replay === packetRoot, "idempotent packet replay returned another row");
    });
    const reorderEvidence = [
      { kind: "public_research_artifact", referenceId: "artifact:b", contentHash: "b".repeat(64), sourceCutoff: "2020-01-01T00:00:00.000Z" },
      { kind: "campaign_slice", referenceId: "campaign:a", contentHash: "a".repeat(64), sourceCutoff: "2020-01-01T00:00:00.000Z" },
    ];
    const reorderRoot = queryScalar(
      config,
      database,
      `SELECT (${packetCall({
        eventId: REORDER_EVENT_ID,
        idempotencyKey: "packet:probe-reorder-1",
        evidence: reorderEvidence,
        knownInformation: { note: "Cafe\u0301" },
        alternatives: ["Beta", "Alpha"],
        assumptions: ["Second", "First"],
      })}).id::text;`,
      { actor: OWNER_ID, role: "authenticated" },
    );
    await check("packet-reordered-semantics-replay", () => {
      const replay = queryScalar(config, database, `SELECT (${packetCall({
        eventId: REORDER_EVENT_ID,
        idempotencyKey: "packet:probe-reorder-1",
        evidence: [...reorderEvidence].reverse(),
        knownInformation: { note: "Caf\u00e9" },
        alternatives: ["Alpha", "Beta"],
        assumptions: ["First", "Second"],
      })}).id::text;`, { actor: OWNER_ID, role: "authenticated" });
      assert(replay === reorderRoot, "reordered semantic request did not replay");
    });
    await expectSqlState(
      "packet-idempotency-conflict-on-content-change",
      `SELECT (${packetCall({ idempotencyKey: "packet:probe-root-1", knownInformation: { changed: 1 } })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await check("packet-server-hash-is-not-client-parameter", () => {
      const argumentsText = queryScalar(config, database, `
        SELECT pg_get_function_arguments(p.oid)
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'series_create_decision_packet_v1';
      `);
      assert(!argumentsText.includes("content_hash") && !argumentsText.includes("request_hash"), "client can provide packet hashes");
    });
    await check("packet-freeze", () => {
      const frozen = queryScalar(config, database, `SELECT (public.series_freeze_decision_packet_v1(${uuidLiteral(packetRoot)}, 1)).id::text;`, { actor: OWNER_ID, role: "authenticated" });
      assert(frozen === packetRoot, "freeze returned another packet");
    });
    await check("packet-freeze-replay", () => {
      const frozen = queryScalar(config, database, `SELECT (public.series_freeze_decision_packet_v1(${uuidLiteral(packetRoot)}, 1)).id::text;`, { actor: OWNER_ID, role: "authenticated" });
      assert(frozen === packetRoot, "freeze replay returned another packet");
    });
    await expectSqlState("packet-content-mutation-after-freeze-fails", `UPDATE public.series_decision_packets_v1 SET owner_decision = 'changed' WHERE id = ${uuidLiteral(packetRoot)};`, "55000");
    await expectSqlState("packet-delete-after-freeze-fails", `DELETE FROM public.series_decision_packets_v1 WHERE id = ${uuidLiteral(packetRoot)};`, "55000");
    const packetCorrection = queryScalar(
      config,
      database,
      `SELECT (${packetCall({ idempotencyKey: "packet:probe-correction-1", supersedesPacketId: packetRoot, correctionReason: "Corrected rationale" })}).id::text;`,
      { actor: OWNER_ID, role: "authenticated" },
    );
    checks.push({ name: "packet-correction-succeeds", status: packetCorrection ? "pass" : "fail" });
    await expectSqlState(
      "packet-divergent-correction-fails",
      `SELECT (${packetCall({ idempotencyKey: "packet:probe-divergent-1", supersedesPacketId: packetRoot, correctionReason: "Divergent rationale" })}).id;`,
      "40001",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "packet-forbidden-outcome-or-pii-fails",
      `SELECT (${packetCall({ idempotencyKey: "packet:probe-forbidden-1", knownInformation: { actualEntries: 100 } })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "packet-unattached-recommendation-fails",
      `SELECT (${packetCall({
        idempotencyKey: "packet:probe-unattached-1",
        recommendedAction: "Raise a question.",
        recommendationSourceKind: "research_artifact",
        recommendationSourceRef: "artifact:missing",
      })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "packet-late-evidence-fails",
      `SELECT (${packetCall({
        idempotencyKey: "packet:probe-late-evidence-1",
        evidence: [{ kind: "public_research_artifact", referenceId: "artifact:late", contentHash: "c".repeat(64), sourceCutoff: "2020-01-01T03:00:00.000Z" }],
      })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "packet-late-slice-fails",
      `SELECT (${packetCall({
        idempotencyKey: "packet:probe-late-slice-1",
        registrationSlice: { manifestId: "registration:late", contentHash: "d".repeat(64), observationCount: 1, sourceCutoff: "2020-01-01T03:00:00.000Z" },
        registrationObservationCount: 1,
      })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "packet-forged-forecast-identity-fails",
      `SELECT (${packetCall({
        idempotencyKey: "packet:probe-forecast-forged-1",
        forecastSnapshotId: SNAPSHOT_ID,
        forecastState: "forecast_identity_eligible",
      })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );

    psql(config, database, `UPDATE public.tournaments SET status = 'completed' WHERE id = ${uuidLiteral(EVENT_ID)};`);
    const actualRoot = queryScalar(
      config,
      database,
      `SELECT (${actualCall({ idempotencyKey: "actual:probe-root-1" })}).id::text;`,
      { actor: OWNER_ID, role: "authenticated" },
    );
    checks.push({ name: "actual-create-manual-root", status: "pass" });
    await check("actual-identical-idempotent-replay", () => {
      const replay = queryScalar(config, database, `SELECT (${actualCall({ idempotencyKey: "actual:probe-root-1" })}).id::text;`, { actor: OWNER_ID, role: "authenticated" });
      assert(replay === actualRoot, "actual replay returned another row");
    });
    await check("actual-normalized-currency-replay", () => {
      const replay = queryScalar(config, database, `SELECT (${actualCall({ idempotencyKey: "actual:probe-root-1", prizePoolCurrency: "VND", overlayCurrency: "VND" })}).id::text;`, { actor: OWNER_ID, role: "authenticated" });
      assert(replay === actualRoot, "normalized actual request did not replay");
    });
    await expectSqlState(
      "actual-idempotency-conflict-on-content-change",
      `SELECT (${actualCall({ idempotencyKey: "actual:probe-root-1", entriesValue: 101 })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await check("actual-content-hash-recomputes-from-stored-row", () => {
      const hashes = queryScalar(config, database, `
        SELECT content_hash || '|' || public._series_sha256_jsonb_v1(public._series_event_actual_content_payload_v1(a))
        FROM public.series_event_actual_revisions_v1 AS a
        WHERE id = ${uuidLiteral(actualRoot)};
      `).split("|");
      assert(hashes.length === 2 && hashes[0] === hashes[1], "stored actual hash is not recomputable");
    });
    const actualCorrection = queryScalar(
      config,
      database,
      `SELECT (${actualCall({
        idempotencyKey: "actual:probe-correction-1",
        finality: "corrected",
        sourceTimestamp: "2020-01-05T10:00:00.000Z",
        supersedesRevisionId: actualRoot,
        correctionReason: "Corrected final count",
      })}).id::text;`,
      { actor: OWNER_ID, role: "authenticated" },
    );
    checks.push({ name: "actual-correction-succeeds", status: actualCorrection ? "pass" : "fail" });
    await expectSqlState(
      "actual-divergent-correction-fails",
      `SELECT (${actualCall({
        idempotencyKey: "actual:probe-divergent-1",
        finality: "corrected",
        sourceTimestamp: "2020-01-05T10:01:00.000Z",
        supersedesRevisionId: actualRoot,
        correctionReason: "Divergent correction",
      })}).id;`,
      "40001",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "actual-duplicate-source-family-root-fails",
      `SELECT (${actualCall({ idempotencyKey: "actual:probe-second-root-1" })}).id;`,
      "23505",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "actual-missing-zero-shape-fails",
      `SELECT (${actualCall({ idempotencyKey: "actual:probe-invalid-zero-1", entriesAvailability: "present", entriesValue: 0 })}).id;`,
      "23514",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "actual-money-shape-fails",
      `SELECT (${actualCall({ idempotencyKey: "actual:probe-invalid-money-1", prizePoolAmount: null })}).id;`,
      "23514",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "actual-unsafe-count-fails",
      `SELECT (${actualCall({ idempotencyKey: "actual:probe-unsafe-count-1", entriesValue: 9007199254740992 })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "actual-source-before-event-fails",
      `SELECT (${actualCall({ idempotencyKey: "actual:probe-source-before-1", sourceTimestamp: "2019-12-31T10:00:00.000Z" })}).id;`,
      "22023",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState("actual-append-only-update-fails", `UPDATE public.series_event_actual_revisions_v1 SET entries_value = 101 WHERE id = ${uuidLiteral(actualCorrection)};`, "55000");
    await expectSqlState("actual-append-only-delete-fails", `DELETE FROM public.series_event_actual_revisions_v1 WHERE id = ${uuidLiteral(actualCorrection)};`, "55000");
    await expectSqlState(
      "actual-finality-requires-completed-event",
      `SELECT (${actualCall({ eventId: REORDER_EVENT_ID, idempotencyKey: "actual:probe-open-event-1" })}).id;`,
      "55000",
      { actor: OWNER_ID, role: "authenticated" },
    );

    await check("owner-select-succeeds", () => {
      const count = queryScalar(config, database, `SELECT count(*) FROM public.series_decision_packets_v1 WHERE id = ${uuidLiteral(packetRoot)};`, { actor: OWNER_ID, role: "authenticated" });
      assert(count === "1", "owner cannot read packet");
    });
    await expectSqlState(
      "non-owner-rpc-fails",
      `SELECT (${packetCall({ idempotencyKey: "packet:probe-non-owner-1" })}).id;`,
      "42501",
      { actor: NON_OWNER_ID, role: "authenticated" },
    );
    await check("non-owner-select-is-empty", () => {
      const count = queryScalar(config, database, `SELECT count(*) FROM public.series_decision_packets_v1;`, { actor: NON_OWNER_ID, role: "authenticated" });
      assert(count === "0", "non-owner saw owner rows");
    });
    await expectSqlState(
      "cross-club-rpc-fails",
      `SELECT (${packetCall({ eventId: OTHER_EVENT_ID, idempotencyKey: "packet:probe-cross-club-1" })}).id;`,
      "42501",
      { actor: OWNER_ID, role: "authenticated" },
    );
    await expectSqlState(
      "anon-rpc-fails",
      `SELECT (${packetCall({ idempotencyKey: "packet:probe-anon-1" })}).id;`,
      "42501",
      { actor: undefined, role: "anon" },
    );
    await expectSqlState("anon-table-access-fails", "SELECT count(*) FROM public.series_decision_packets_v1;", "42501", { actor: undefined, role: "anon" });
    await expectSqlState("authenticated-direct-insert-fails", "INSERT INTO public.series_decision_packets_v1 DEFAULT VALUES;", "42501", { actor: OWNER_ID, role: "authenticated" });
    await expectSqlState("authenticated-direct-update-fails", "UPDATE public.series_decision_packets_v1 SET owner_decision = 'x';", "42501", { actor: OWNER_ID, role: "authenticated" });
    await expectSqlState("authenticated-direct-delete-fails", "DELETE FROM public.series_decision_packets_v1;", "42501", { actor: OWNER_ID, role: "authenticated" });
    await check("service-role-has-no-rpc-execute", () => {
      const value = queryScalar(config, database, `
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM pg_proc AS p
          JOIN pg_namespace AS n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('series_create_decision_packet_v1', 'series_freeze_decision_packet_v1', 'series_record_event_actual_v1')
            AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        ) THEN 'unexpected' ELSE 'absent' END;
      `);
      assert(value === "absent", "service role received an unexpected D2A RPC grant");
    });
  } catch (error) {
    checks.push({ name: "probe-setup-or-unhandled", status: "fail", error: error instanceof Error ? error.message : String(error) });
  } finally {
    try {
      psql(config, config.adminDatabase, `DROP DATABASE IF EXISTS ${database} WITH (FORCE);`);
      databaseDropped = true;
    } catch (error) {
      checks.push({ name: "disposable-database-teardown", status: "fail", error: error instanceof Error ? error.message : String(error) });
    }
  }

  const failed = checks.filter((checkResult) => checkResult.status !== "pass");
  const report = {
    schemaVersion: "d2a-pg17-probe-v1",
    reviewedSourceSha: process.env.D2A_REVIEWED_SOURCE_SHA ?? null,
    workflowHeadSha: process.env.GITHUB_SHA ?? null,
    postgresqlVersion: queryScalar(config, config.adminDatabase, "SHOW server_version;"),
    migrationSha256,
    vectorSha256,
    vectorCount: vectors.vectors.length,
    checkCount: checks.length,
    passedCount: checks.length - failed.length,
    failedCount: failed.length,
    disposableDatabaseDropped: databaseDropped,
    checks,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (failed.length > 0 || !databaseDropped) {
    throw new Error(`D2A PostgreSQL 17 probe failed: ${failed.map((item) => item.name).join(", ")}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
