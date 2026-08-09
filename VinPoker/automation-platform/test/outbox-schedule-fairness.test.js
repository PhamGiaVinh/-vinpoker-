import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  cloneScheduledEvent,
  createHarness,
  START_MS,
} from "./helpers.js";

test("canonical state and outbox commit or rollback together", () => {
  const harness = createHarness();
  try {
    const base = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    const committedEvent = cloneScheduledEvent(base);
    harness.store.simulateCanonicalWrite({
      entityId: "fixture:committed",
      state: { status: "UPDATED" },
      event: committedEvent,
    });
    assert.deepEqual(harness.store.getCanonicalFixtureState("fixture:committed"), {
      status: "UPDATED",
    });
    assert.ok(harness.store.getEvent(committedEvent.event_id));

    const failedEvent = cloneScheduledEvent(base);
    assert.throws(
      () =>
        harness.store.simulateCanonicalWrite({
          entityId: "fixture:rolled-back",
          state: { status: "SHOULD_NOT_EXIST" },
          event: failedEvent,
          failOutbox: true,
        }),
      (error) => error.code === "SIMULATED_OUTBOX_FAILURE",
    );
    assert.equal(harness.store.getCanonicalFixtureState("fixture:rolled-back"), null);
    assert.equal(harness.store.getEvent(failedEvent.event_id), null);
  } finally {
    harness.close();
  }
});

test("producer retries are idempotent and conflicting reuse is rejected", () => {
  const harness = createHarness();
  try {
    const event = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    const second = harness.store.insertScheduledEvent(event);
    assert.equal(second.inserted, false);
    assert.equal(second.eventId, event.event_id);
    assert.throws(
      () =>
        harness.store.insertScheduledEvent({
          ...structuredClone(event),
          event_id: randomUUID(),
          priority: event.priority + 1,
        }),
      (error) => error.code === "PRODUCER_IDEMPOTENCY_CONFLICT",
    );
  } finally {
    harness.close();
  }
});

test("24-hour n8n outage skips expired events but reclaims valid RECOMPUTE event", () => {
  const harness = createHarness();
  try {
    const base = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    const longLived = cloneScheduledEvent(base, {
      expiresAt: new Date(START_MS + 30 * 60 * 60 * 1000).toISOString(),
    });
    harness.store.insertScheduledEvent(longLived);

    harness.clock.advance(24 * 60 * 60 * 1000);
    const claim = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "worker-after-24h",
      batch_size: 20,
    });
    assert.equal(claim.events.length, 1);
    assert.equal(claim.events[0].event.event_id, longLived.event_id);
    assert.equal(claim.events[0].event.catch_up_policy, "RECOMPUTE");
    assert.equal(harness.gateway.status().counts.SKIPPED, 2);
  } finally {
    harness.close();
  }
});

test("fair claim gives each club a slot before a second slot", () => {
  const harness = createHarness();
  try {
    const alpha = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    for (let index = 0; index < 8; index += 1) {
      harness.store.insertScheduledEvent(cloneScheduledEvent(alpha));
    }
    const claim = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "fairness-worker",
      batch_size: 2,
    });
    assert.equal(claim.events.length, 2);
    assert.equal(new Set(claim.events.map((item) => item.event.scope.club_id)).size, 2);
  } finally {
    harness.close();
  }
});

test("LATEST_ONLY skips superseded event versions before a worker receives them", () => {
  const harness = createHarness();
  try {
    const base = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    const older = cloneScheduledEvent(base, {
      availableAt: new Date(START_MS + 1_000).toISOString(),
    });
    older.subject = {
      entity_type: "digest",
      entity_id: "digest:alpha:current",
      entity_version: 1,
    };
    const newer = cloneScheduledEvent(base, {
      availableAt: new Date(START_MS + 2_000).toISOString(),
    });
    newer.subject = {
      entity_type: "digest",
      entity_id: "digest:alpha:current",
      entity_version: 2,
    };
    harness.store.insertScheduledEvent(older);
    harness.store.insertScheduledEvent(newer);
    harness.clock.advance(3_000);

    const claim = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "latest-only-worker",
      batch_size: 20,
    });
    assert.equal(
      claim.events.some((item) => item.event.event_id === older.event_id),
      false,
    );
    assert.equal(
      claim.events.some((item) => item.event.event_id === newer.event_id),
      true,
    );
    assert.equal(harness.store.getEvent(older.event_id).status, "SKIPPED");
    assert.equal(
      harness.store.getEvent(older.event_id).last_error_code,
      "SUPERSEDED_LATEST_ONLY",
    );
  } finally {
    harness.close();
  }
});

test("poison event is dead-lettered without blocking valid event in same batch", () => {
  const harness = createHarness();
  try {
    const base = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    const poison = cloneScheduledEvent(base);
    poison.payload.unexpected = "schema violation";
    harness.store.insertScheduledEvent(poison);

    const claim = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "poison-worker",
      batch_size: 4,
    });
    assert.ok(claim.events.length >= 1);
    assert.equal(
      claim.events.some((item) => item.event.event_id === poison.event_id),
      false,
    );
    const poisonRow = harness.store.getEvent(poison.event_id);
    assert.equal(poisonRow.status, "DEAD_LETTER");
    assert.equal(poisonRow.last_error_code, "SCHEMA_VALIDATION_FAILED");
  } finally {
    harness.close();
  }
});

test("P0 event cannot enter n8n orchestration", () => {
  const harness = createHarness();
  try {
    const now = new Date(START_MS).toISOString();
    const p0 = {
      schema_version: 1,
      event_id: randomUUID(),
      event_type: "system.health.worker.heartbeat_missed",
      trigger_kind: "HEALTH",
      scope: {
        kind: "CLUB",
        club_id: "11111111-1111-4111-8111-111111111111",
      },
      automation_policy: "SENSITIVE_NOTIFY",
      severity: "P0",
      producer: {
        service: "HEALTH_MONITOR",
        module: "worker_heartbeat",
        version: "1.0.0",
        environment: "DEV",
      },
      subject: {
        entity_type: "system_component",
        entity_id: "component:N8N_WORKER",
      },
      dedupe_key: `health.n8n_worker.${randomUUID()}`,
      correlation_id: randomUUID(),
      causation_id: null,
      parent_event_id: null,
      occurred_at: now,
      emitted_at: now,
      available_at: now,
      catch_up_policy: "SEND_LATE",
      priority: 100,
      hop_count: 0,
      payload_schema_key: "system.health.v1",
      payload: {
        incident_id: randomUUID(),
        component: "N8N_WORKER",
        error_code: "HEARTBEAT_MISSED",
        affected_club_count: 1,
        automation_depth: 0,
      },
    };
    harness.store.insertScheduledEvent(p0);
    harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "p0-worker",
      batch_size: 4,
    });
    const row = harness.store.getEvent(p0.event_id);
    assert.equal(row.status, "DEAD_LETTER");
    assert.equal(row.last_error_code, "P0_NATIVE_ONLY");
  } finally {
    harness.close();
  }
});

test("Gateway dead-letters event from a different environment before orchestration", () => {
  const harness = createHarness();
  try {
    const base = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    const foreignEnvironment = cloneScheduledEvent(base);
    foreignEnvironment.producer.environment = "TEST";
    harness.store.insertScheduledEvent(foreignEnvironment);
    harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "environment-guard-worker",
      batch_size: 20,
    });
    const row = harness.store.getEvent(foreignEnvironment.event_id);
    assert.equal(row.status, "DEAD_LETTER");
    assert.equal(row.last_error_code, "EVENT_ENVIRONMENT_MISMATCH");
  } finally {
    harness.close();
  }
});
