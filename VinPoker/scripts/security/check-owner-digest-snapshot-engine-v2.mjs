import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const migration = readFileSync(
  resolve(root, "supabase/migration-archive/historical-never-replay/20270110000011_owner_daily_digest_snapshot_engine_v2.sql"),
  "utf8",
);
const contract = readFileSync(
  resolve(root, "docs/ops/OWNER_DAILY_DIGEST_V2_CONTRACT.md"),
  "utf8",
);
const automationEventSchema = readFileSync(
  resolve(root, "automation-platform/contracts/automation-event-v1.schema.json"),
  "utf8",
);
const snapshotEventSchema = readFileSync(
  resolve(root, "automation-platform/contracts/payloads/owner-daily-digest-snapshot-created-v2.schema.json"),
  "utf8",
);
const shadowReader = readFileSync(
  resolve(root, "automation-platform/scripts/test-shadow-reader.sql"),
  "utf8",
);
const shadowSource = readFileSync(
  resolve(root, "automation-platform/src/canonical/test-shadow-source.js"),
  "utf8",
);

const checks = [
  [migration.includes("DEFAULT false"), "per-Club schedule defaults OFF"],
  [migration.includes("private.generate_owner_daily_digest_snapshot_v2"), "canonical generator exists"],
  [migration.includes("One SQL statement/statement snapshot computes all nine metrics consistently"), "consistent-read contract is explicit"],
  [migration.includes("pg_advisory_xact_lock"), "Club/date generation is serialized"],
  [migration.includes("UNIQUE (club_id, business_date, calculation_version, source_hash)"), "same source hash is idempotent"],
  [migration.includes("UNCHANGED_REUSED"), "unchanged source reuses a snapshot"],
  [migration.includes("owner.daily_digest.snapshot_created"), "snapshot creation emits the canonical outbox event"],
  [automationEventSchema.includes("owner.daily_digest.snapshot_created.v2"), "automation event contract accepts snapshot-created V2"],
  [snapshotEventSchema.includes('"snapshot_id"') && snapshotEventSchema.includes('"content_hash"'), "snapshot-created payload is schema validated"],
  [shadowReader.includes("owner_daily_digest_outbox_v2") && shadowReader.includes("outbox_payload"), "TEST reader exposes the canonical outbox row"],
  [shadowSource.includes("structuredClone(club.canonical_event)") && !shadowSource.includes("materializeDigestDueEvent"), "TEST E2E consumes the outbox event without synthesizing a due event"],
  [migration.includes("OWNER_DIGEST_IMMUTABLE_ROW"), "snapshot and outbox mutation is rejected"],
  [migration.includes("NEW.rake_paid_vnd := v_rake"), "rake split is captured by the server trigger"],
  [migration.includes("NEW.service_fee_paid_vnd := v_service"), "service split is captured by the server trigger"],
  [migration.includes("Ignore any client-provided split"), "client fee split is explicitly ignored"],
  [migration.includes("FREE_RAKE_SERVER_AUTHORITY_REQUIRED") && migration.includes("auth.role()"), "free-rake requires server authority"],
  [migration.includes("FREE_RAKE_SLOT_NOT_CONSUMED"), "free-rake requires a consumed canonical slot"],
  [migration.includes("REGISTRATION_FEE_SPLIT_IMMUTABLE"), "persisted registration money split cannot be rewritten"],
  [!migration.match(/UPDATE\s+public\.tournament_registrations\s+SET\s+(?:rake|service_fee)_paid_vnd/i), "migration never backfills legacy fee split"],
  [migration.includes("rake_paid_state IN ('AVAILABLE', 'UNAVAILABLE')"), "zero and unavailable are separate states"],
  [migration.includes("money_state text NOT NULL DEFAULT 'PROVISIONAL' CHECK (money_state = 'PROVISIONAL')"), "V2 cannot overclaim CLOSED"],
  [migration.includes("SELECT cron.unschedule") && migration.includes("cron.schedule("), "global Cron uses supported functions"],
  [migration.includes("'*/5 * * * *'"), "global due-runner cadence is five minutes"],
  [migration.includes("clock_timestamp() - interval '24 hours'"), "automatic catch-up is bounded to 24 hours"],
  [migration.includes("REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, anon, authenticated"), "private tables have no client grants"],
  [contract.includes("Web và Automation chỉ đọc snapshot bất biến"), "web and automation share one canonical snapshot"],
  [contract.includes("legacy row chưa có split → `UNAVAILABLE`"), "legacy fee split never becomes guessed zero"],
];

const failed = checks.filter(([pass]) => !pass);
for (const [pass, label] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${label}`);
}
if (failed.length > 0) process.exitCode = 1;
