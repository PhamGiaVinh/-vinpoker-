import pg from "pg";
import { digestCanonicalSnapshotContentV2 } from "../lib/digest-snapshot-hash.js";

const { Client } = pg;
const SOURCE_ID = "vinpoker-test-canonical-v1";
const READER_ROLE = "vinpoker_digest_shadow_reader";
const CLUB_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
];

const DIGEST_SNAPSHOT_SQL = `
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
    const result = await client.query(DIGEST_SNAPSHOT_SQL, [CLUB_IDS]);
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
    const contentPayload = normalizeJson(row.content_payload);
    const contentHash = digestCanonicalSnapshotContentV2(contentPayload);
    if (row.source_hash !== contentHash || row.content_hash !== contentHash) {
      throw new Error("TEST canonical snapshot checksum mismatch");
    }
    const canonicalSnapshot = {
      snapshot_id: row.snapshot_id,
      club_id: clubId,
      snapshot_version: safeInteger(row.snapshot_version, "snapshot_version", { minimum: 1 }),
      calculation_version: row.calculation_version,
      source_as_of: isoTimestamp(row.source_as_of, "source_as_of"),
      generated_at: isoTimestamp(row.generated_at, "generated_at"),
      notification_expires_at: isoTimestamp(row.notification_expires_at, "notification_expires_at"),
      source_hash: row.source_hash,
      content_hash: row.content_hash,
      content_payload: contentPayload,
    };
    const outboxPayload = normalizeJson(row.outbox_payload);
    if (
      row.event_type !== "owner.daily_digest.snapshot_created" ||
      outboxPayload.snapshot_id !== canonicalSnapshot.snapshot_id ||
      outboxPayload.club_id !== clubId ||
      outboxPayload.business_date !== contentPayload.business_date ||
      safeInteger(outboxPayload.snapshot_version, "outbox.snapshot_version", { minimum: 1 })
        !== canonicalSnapshot.snapshot_version ||
      outboxPayload.calculation_version !== canonicalSnapshot.calculation_version ||
      outboxPayload.content_hash !== canonicalSnapshot.content_hash ||
      safeInteger(outboxPayload.schema_version, "outbox.schema_version", { minimum: 2 }) !== 2
    ) {
      throw new Error("TEST canonical outbox event does not match its immutable snapshot");
    }
    const eventId = uuid(row.event_id, "event_id");
    const occurredAt = isoTimestamp(row.event_occurred_at, "event_occurred_at");
    const availableAt = isoTimestamp(row.event_available_at, "event_available_at");
    const expiresAt = isoTimestamp(row.event_expires_at, "event_expires_at");
    const canonicalEvent = {
      schema_version: 1,
      event_id: eventId,
      event_type: row.event_type,
      trigger_kind: "DOMAIN",
      scope: { kind: "CLUB", club_id: clubId },
      automation_policy: "NOTIFY_ONLY",
      severity: "P2",
      producer: {
        service: "VINPOKER_DB",
        module: "owner_daily_digest_snapshot_engine",
        version: "1.0.0",
        environment: "DEV",
      },
      subject: {
        entity_type: "digest",
        entity_id: canonicalSnapshot.snapshot_id,
        entity_version: canonicalSnapshot.snapshot_version,
      },
      dedupe_key: row.dedupe_key,
      correlation_id: eventId,
      causation_id: null,
      parent_event_id: null,
      occurred_at: occurredAt,
      emitted_at: occurredAt,
      available_at: availableAt,
      expires_at: expiresAt,
      catch_up_policy: "SKIP_IF_LATE",
      priority: 40,
      hop_count: 0,
      content_artifact_id: canonicalSnapshot.snapshot_id,
      payload_schema_key: "owner.daily_digest.snapshot_created.v2",
      payload: outboxPayload,
    };
    return {
      club_id: clubId,
      display_code: row.display_code,
      timezone: contentPayload.effective_timezone,
      operating_day_cutoff: "06:00",
      digest_send_time: "09:00",
      mock_owner_endpoint_id: row.owner_id,
      canonical_snapshot: canonicalSnapshot,
      canonical_event: canonicalEvent,
    };
  });
}

export function seedCanonicalTestShadow({ store, validator, clubs }) {
  store.resetFixtures();
  const results = [];
  for (const club of clubs) {
    store.upsertClubFixture(club);
    const event = structuredClone(club.canonical_event);
    validator.validateEvent(event);
    validator.validateEventSemantics(event);
    results.push(store.insertScheduledEvent(event, "owner.daily_digest.v1"));
  }
  return { source_id: SOURCE_ID, clubs: clubs.length, scheduled_events: results.length, results };
}

function safeInteger(value, label, { minimum = 0 } = {}) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new Error(`Canonical ${label} must be a safe integer >= ${minimum}`);
  }
  return numeric;
}

function isoTimestamp(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Canonical ${label} is invalid`);
  return date.toISOString();
}

function normalizeJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function uuid(value, label) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) {
    throw new Error(`Canonical ${label} must be a UUID`);
  }
  return value;
}
