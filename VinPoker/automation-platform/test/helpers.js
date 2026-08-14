import { randomUUID } from "node:crypto";
import { loadConfig } from "../src/config.js";
import {
  AutomationGateway,
  createDigestNotificationRequest,
} from "../src/gateway.js";
import { SqliteAutomationStore } from "../src/store/sqlite-store.js";

export const START_MS = Date.parse("2026-07-31T03:00:00.000Z");
let cloneSequence = 0;

export function createHarness({ nowMs = START_MS, rateLimitPerMinute = 120 } = {}) {
  let currentTime = nowMs;
  const clock = {
    now: () => currentTime,
    advance: (milliseconds) => {
      currentTime += milliseconds;
      return currentTime;
    },
    set: (milliseconds) => {
      currentTime = milliseconds;
    },
  };
  const config = loadConfig({
    environment: "DEV",
    dbPath: ":memory:",
    currentKeyId: "dev-current",
    currentKey: "unit-test-current-hmac-secret-32-bytes-minimum",
    nextKeyId: "dev-next",
    nextKey: "unit-test-next-hmac-secret-32-bytes-minimum",
    replayWindowSeconds: 300,
    nonceTtlSeconds: 600,
    rateLimitPerMinute,
  });
  const store = new SqliteAutomationStore({ dbPath: ":memory:", now: clock.now });
  const gateway = new AutomationGateway({ store, config, now: clock.now });
  gateway.seedFixtures();
  return {
    clock,
    config,
    store,
    gateway,
    close: () => store.close(),
  };
}

export function processClaimedDigest({ gateway, store, envelope, nowMs }) {
  const summary = gateway.buildDigestArtifact({
    event_id: envelope.event.event_id,
    lease_token: envelope.lease_token,
  });
  const artifact = store.getArtifact(summary.artifact_id);
  const request = createDigestNotificationRequest({
    event: envelope.event,
    artifact,
    nowMs,
  });
  const enqueue = gateway.enqueue({
    event_id: envelope.event.event_id,
    lease_token: envelope.lease_token,
    request,
  });
  return { summary, artifact, request, enqueue };
}

export function cloneDigestEvent(baseEvent, {
  clubId = baseEvent.scope.club_id,
  eventId = randomUUID(),
  correlationId = randomUUID(),
  dedupeSuffix = randomUUID(),
  availableAt = baseEvent.available_at,
  expiresAt = baseEvent.expires_at,
  priority = baseEvent.priority,
} = {}) {
  cloneSequence = (cloneSequence % 28) + 1;
  const businessDate = `2099-01-${String(cloneSequence).padStart(2, "0")}`;
  const event = structuredClone(baseEvent);
  event.event_id = eventId;
  event.correlation_id = correlationId;
  event.scope.club_id = clubId;
  event.subject.entity_id = eventId;
  event.content_artifact_id = eventId;
  event.dedupe_key = `owner-digest:${clubId}:${dedupeSuffix}`;
  event.available_at = availableAt;
  event.expires_at = expiresAt;
  event.priority = priority;
  event.payload.business_date = businessDate;
  event.payload.snapshot_id = eventId;
  event.payload.club_id = clubId;
  return event;
}
