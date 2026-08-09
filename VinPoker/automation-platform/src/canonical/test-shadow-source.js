import { createHash } from "node:crypto";
import pg from "pg";
import { materializeDigestDueEvent } from "../fixtures.js";

const { Client } = pg;
const SOURCE_ID = "vinpoker-test-canonical-v1";
const READER_ROLE = "vinpoker_digest_shadow_reader";
const CLUB_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
];

const DIGEST_METRICS_SQL = `
  SELECT *
  FROM vinpoker_test.owner_digest_shadow_source
  WHERE club_id = ANY($1::uuid[])
  ORDER BY club_id
`;

export function loadTestShadowSourceConfig(env = process.env) {
  const config = {
    sourceId: env.VINPOKER_TEST_SOURCE_ID ?? "",
    host: env.VINPOKER_TEST_DB_HOST ?? "",
    port: Number.parseInt(env.VINPOKER_TEST_DB_PORT ?? "5432", 10),
    database: env.VINPOKER_TEST_DB_NAME ?? "postgres",
    user: env.VINPOKER_TEST_DB_USER ?? "",
    credential: env.VINPOKER_TEST_DB_PASSWORD ?? "",
  };
  if (config.sourceId !== SOURCE_ID) {
    throw new Error("TEST shadow source identity must be vinpoker-test-canonical-v1");
  }
  if (!new Set(["127.0.0.1", "localhost", "supabase_db_vinpoker-test-canonical-v1"]).has(config.host)) {
    throw new Error("TEST shadow database host is not allowlisted");
  }
  if (config.database !== "postgres" || config.user !== READER_ROLE) {
    throw new Error("TEST shadow must use the dedicated read-only role and local database");
  }
  if (!config.credential || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("TEST shadow database credential or port is missing");
  }
  return config;
}

export async function readCanonicalDigestClubs({ config, clientFactory } = {}) {
  const sourceConfig = config ?? loadTestShadowSourceConfig();
  const client = clientFactory
    ? clientFactory(sourceConfig)
    : new Client({
        host: sourceConfig.host,
        port: sourceConfig.port,
        database: sourceConfig.database,
        user: sourceConfig.user,
        ["password"]: sourceConfig.credential,
        ssl: false,
        application_name: "vbacker_owner_digest_test_shadow",
        statement_timeout: 10_000,
        query_timeout: 12_000,
      });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await client.query(DIGEST_METRICS_SQL, [CLUB_IDS]);
    await client.query("COMMIT");
    return mapCanonicalRows(result.rows);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function mapCanonicalRows(rows) {
  if (!Array.isArray(rows) || rows.length !== CLUB_IDS.length) {
    throw new Error("TEST canonical source must return exactly the two allowlisted clubs");
  }
  const byId = new Map(rows.map((row) => [row.club_id, row]));
  return CLUB_IDS.map((clubId) => {
    const row = byId.get(clubId);
    if (!row || !row.owner_id || !/^TEST_CLUB_[AB]$/.test(row.display_code)) {
      throw new Error("TEST canonical club identity mismatch");
    }
    const snapshot = {
      freshness_state: "FRESH",
      money_state: Number(row.payroll_provisional_vnd) > 0 ? "PROVISIONAL" : "CLOSED",
      registrations: safeInteger(row.registrations, "registrations"),
      attendance: safeInteger(row.attendance, "attendance"),
      entries: safeInteger(row.entries, "entries"),
      staff: safeInteger(row.staff, "staff"),
      rake_retained_vnd: safeInteger(row.rake_retained_vnd, "rake_retained_vnd"),
      fnb_net_revenue_vnd: safeInteger(row.fnb_net_revenue_vnd, "fnb_net_revenue_vnd"),
      pending_liabilities_vnd: safeInteger(row.pending_liabilities_vnd, "pending_liabilities_vnd"),
      payroll_provisional_vnd: safeInteger(row.payroll_provisional_vnd, "payroll_provisional_vnd"),
    };
    return {
      club_id: clubId,
      display_code: row.display_code,
      timezone: "Asia/Bangkok",
      operating_day_cutoff: "06:00",
      digest_send_time: "09:00",
      mock_owner_endpoint_id: row.owner_id,
      snapshot,
    };
  });
}

export function seedCanonicalTestShadow({ store, validator, clubs, now = () => Date.now() }) {
  store.resetFixtures();
  const nowMs = now();
  const results = [];
  for (const club of clubs) {
    store.upsertClubFixture(club);
    const event = materializeDigestDueEvent({
      club,
      scheduled: {
        club_id: club.club_id,
        event_id: deterministicUuid(`event:${club.club_id}:${nowMs}`),
        correlation_id: deterministicUuid(`trace:${club.club_id}:${nowMs}`),
        available_offset_seconds: -1,
        expires_offset_seconds: 8 * 60 * 60,
        priority: 40,
      },
      nowMs,
    });
    event.producer.module = "owner_daily_digest_test_shadow";
    validator.validateEvent(event);
    validator.validateEventSemantics(event);
    results.push(store.insertScheduledEvent(event, "owner.daily_digest.v1"));
  }
  return { source_id: SOURCE_ID, clubs: clubs.length, scheduled_events: results.length, results };
}

function safeInteger(value, label) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`Canonical ${label} must be a non-negative safe integer`);
  }
  return numeric;
}

function deterministicUuid(input) {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
