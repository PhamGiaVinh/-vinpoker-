import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./config.js";

export function loadFixtureDefinition(
  fixturePath = path.join(projectRoot, "fixtures", "two-clubs.json"),
) {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

export function seedTwoClubFixtures({ store, validator, now = () => Date.now(), reset = true }) {
  const fixture = loadFixtureDefinition();
  if (reset) store.resetFixtures();

  for (const club of fixture.clubs) store.upsertClubFixture(club);

  const clubsById = new Map(fixture.clubs.map((club) => [club.club_id, club]));
  const results = [];
  for (const scheduled of fixture.scheduled_events) {
    const club = clubsById.get(scheduled.club_id);
    if (!club) throw new Error(`Fixture event references unknown club ${scheduled.club_id}`);
    const event = materializeDigestDueEvent({ club, scheduled, nowMs: now() });
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

export function materializeDigestDueEvent({ club, scheduled, nowMs }) {
  const availableMs = nowMs + scheduled.available_offset_seconds * 1000;
  const expiresMs = nowMs + scheduled.expires_offset_seconds * 1000;
  const businessDate = dateInTimeZone(nowMs, club.timezone);
  const windowEnd = new Date(nowMs).toISOString();
  const windowStart = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const availableAt = new Date(availableMs).toISOString();

  return {
    schema_version: 1,
    event_id: scheduled.event_id,
    event_type: "owner.daily_digest.due",
    trigger_kind: "SCHEDULE",
    scope: {
      kind: "CLUB",
      club_id: club.club_id,
    },
    automation_policy: "NOTIFY_ONLY",
    severity: "P2",
    producer: {
      service: "VINPOKER_DB",
      module: "owner_daily_digest_fixture",
      version: "1.0.0",
      environment: "DEV",
    },
    subject: {
      entity_type: "digest",
      entity_id: `digest:${club.club_id}:${businessDate}`,
    },
    dedupe_key: `digest.${club.club_id}.${businessDate}.v1`,
    correlation_id: scheduled.correlation_id,
    causation_id: null,
    parent_event_id: null,
    occurred_at: availableAt,
    emitted_at: new Date(nowMs).toISOString(),
    available_at: availableAt,
    scheduled_for: availableAt,
    expires_at: new Date(expiresMs).toISOString(),
    catch_up_policy: "RECOMPUTE",
    priority: scheduled.priority,
    hop_count: 0,
    payload_schema_key: "owner.daily_digest.due.v1",
    payload: {
      business_date: businessDate,
      window_start: windowStart,
      window_end: windowEnd,
      timezone: club.timezone,
      config_version: 1,
      schedule_key: `owner_daily_digest:${club.club_id}:${businessDate}`,
    },
  };
}

function dateInTimeZone(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
