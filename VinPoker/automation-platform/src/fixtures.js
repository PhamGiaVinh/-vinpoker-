import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./config.js";
import { digestCanonicalSnapshotContentV2 } from "./lib/digest-snapshot-hash.js";

export function loadFixtureDefinition(
  fixturePath = path.join(projectRoot, "fixtures", "two-clubs.json"),
) {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

export function seedTwoClubFixtures({ store, validator, now = () => Date.now(), reset = true }) {
  const fixture = loadFixtureDefinition();
  if (reset) store.resetFixtures();

  const clubsById = new Map(fixture.clubs.map((club) => [club.club_id, club]));
  const results = [];
  for (const scheduled of fixture.scheduled_events) {
    const club = clubsById.get(scheduled.club_id);
    if (!club) throw new Error(`Fixture event references unknown club ${scheduled.club_id}`);
    const nowMs = now();
    const snapshot = materializeCanonicalSnapshotFixture({ club, scheduled, nowMs });
    const event = materializeSnapshotCreatedEvent({ club, scheduled, snapshot });
    store.upsertClubFixture({
      ...club,
      canonical_snapshot: snapshot,
    });
    validator.validateEvent(event);
    validator.validateEventSemantics(event);
    results.push(store.insertScheduledEvent(event, "owner.daily_digest.v1"));
  }

  return {
    clubs: fixture.clubs.length,
    scheduled_events: results.length,
    results,
  };
}

export function materializeSnapshotCreatedEvent({ club, scheduled, snapshot }) {
  const payload = snapshot.content_payload;
  const eventTimestamp = snapshot.generated_at;

  return {
    schema_version: 1,
    event_id: scheduled.event_id,
    event_type: "owner.daily_digest.snapshot_created",
    trigger_kind: "DOMAIN",
    scope: {
      kind: "CLUB",
      club_id: club.club_id,
    },
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
      entity_id: snapshot.snapshot_id,
      entity_version: snapshot.snapshot_version,
    },
    dedupe_key: `owner-digest:${club.club_id}:${payload.business_date}:${snapshot.content_hash}`,
    correlation_id: scheduled.correlation_id,
    causation_id: null,
    parent_event_id: null,
    occurred_at: eventTimestamp,
    emitted_at: eventTimestamp,
    available_at: eventTimestamp,
    expires_at: snapshot.notification_expires_at,
    catch_up_policy: "SKIP_IF_LATE",
    priority: scheduled.priority,
    hop_count: 0,
    content_artifact_id: snapshot.snapshot_id,
    payload_schema_key: "owner.daily_digest.snapshot_created.v2",
    payload: {
      snapshot_id: snapshot.snapshot_id,
      club_id: club.club_id,
      business_date: payload.business_date,
      snapshot_version: snapshot.snapshot_version,
      calculation_version: snapshot.calculation_version,
      content_hash: snapshot.content_hash,
      schema_version: 2,
    },
  };
}

export function materializeCanonicalSnapshotFixture({ club, scheduled, nowMs }) {
  const expiresMs = nowMs + scheduled.expires_offset_seconds * 1000;
  const window = previousEndedBusinessWindow({
    nowMs,
    timeZone: club.timezone,
    cutoff: club.operating_day_cutoff ?? "06:00",
  });
  const template = club.canonical_snapshot_template;
  if (!template) throw new Error(`Fixture Club ${club.club_id} has no canonical snapshot template`);
  const contentPayload = {
    business_date: window.businessDate,
    calculation_version: template.calculation_version,
    effective_timezone: club.timezone,
    window_start_utc: window.windowStart,
    window_end_utc: window.windowEnd,
    freshness_state: template.freshness_state,
    money_state: "PROVISIONAL",
    metrics: template.metrics,
    warning_codes: template.warning_codes,
    action_codes: template.action_codes,
  };
  const contentHash = digestCanonicalSnapshotContentV2(contentPayload);
  const generatedAt = new Date(nowMs).toISOString();
  return {
    snapshot_id: template.snapshot_id,
    club_id: club.club_id,
    snapshot_version: template.snapshot_version,
    calculation_version: template.calculation_version,
    source_as_of: generatedAt,
    generated_at: generatedAt,
    notification_expires_at: new Date(expiresMs).toISOString(),
    source_hash: contentHash,
    content_hash: contentHash,
    content_payload: contentPayload,
  };
}

function previousEndedBusinessWindow({ nowMs, timeZone, cutoff }) {
  const [cutoffHour, cutoffMinute] = cutoff.split(":").map(Number);
  const local = localDateTimeParts(nowMs, timeZone);
  const afterCutoff = local.hour > cutoffHour
    || (local.hour === cutoffHour && local.minute >= cutoffMinute);
  const endLocalDate = addDays(local.date, afterCutoff ? 0 : -1);
  const businessDate = addDays(endLocalDate, -1);
  return {
    businessDate,
    windowStart: zonedLocalToUtc(businessDate, cutoff, timeZone),
    windowEnd: zonedLocalToUtc(endLocalDate, cutoff, timeZone),
  };
}

function localDateTimeParts(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function zonedLocalToUtc(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const local = localDateTimeParts(guess, timeZone);
    const localAsUtc = Date.UTC(
      ...local.date.split("-").map(Number).map((value, index) => index === 1 ? value - 1 : value),
      local.hour,
      local.minute,
      0,
    );
    guess -= localAsUtc - Date.UTC(year, month - 1, day, hour, minute, 0);
  }
  return new Date(guess).toISOString();
}
