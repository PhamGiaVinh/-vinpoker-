import test from "node:test";
import assert from "node:assert/strict";
import {
  createHarness,
  processClaimedDigest,
  START_MS,
} from "./helpers.js";

test("Owner Daily Digest completes only after durable enqueue", () => {
  const harness = createHarness();
  try {
    const claim = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "digest-worker",
      batch_size: 20,
    });
    assert.equal(claim.events.length, 2);
    for (const envelope of claim.events) {
      assert.throws(
        () =>
          harness.gateway.complete({
            event_id: envelope.event.event_id,
            lease_token: envelope.lease_token,
            notification_id: "99999999-9999-4999-8999-999999999999",
          }),
        (error) => error.code === "DURABLE_ENQUEUE_REQUIRED",
      );
      const { enqueue } = processClaimedDigest({
        gateway: harness.gateway,
        store: harness.store,
        envelope,
        nowMs: START_MS,
      });
      assert.equal(enqueue.durable, true);
      assert.deepEqual(
        harness.gateway.complete({
          event_id: envelope.event.event_id,
          lease_token: envelope.lease_token,
          notification_id: enqueue.notification_id,
        }),
        { event_id: envelope.event.event_id, status: "COMPLETED" },
      );
    }
    const status = harness.gateway.status();
    assert.equal(status.counts.COMPLETED, 2);
    assert.equal(status.notification_count, 2);
    assert.equal(status.external_send_enabled, false);
    assert.equal(status.p0_owner, "SERVER_NATIVE");
  } finally {
    harness.close();
  }
});

test("crash after enqueue returns same notification_id after lease takeover", () => {
  const harness = createHarness();
  try {
    const [firstLease] = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "worker-before-crash",
      batch_size: 1,
    }).events;
    const first = processClaimedDigest({
      gateway: harness.gateway,
      store: harness.store,
      envelope: firstLease,
      nowMs: START_MS,
    });
    assert.equal(first.enqueue.already_existed, false);

    harness.clock.advance(91_000);
    const beforeBackoff = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "worker-after-crash",
      batch_size: 2,
    }).events;
    assert.equal(
      beforeBackoff.some((item) => item.event.event_id === firstLease.event.event_id),
      false,
    );
    harness.clock.advance(61_000);
    const reclaimed = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "worker-after-crash",
      batch_size: 2,
    }).events.find((item) => item.event.event_id === firstLease.event.event_id);
    assert.ok(reclaimed);
    assert.notEqual(reclaimed.lease_token, firstLease.lease_token);
    assert.throws(
      () =>
        harness.gateway.complete({
          event_id: firstLease.event.event_id,
          lease_token: firstLease.lease_token,
          notification_id: first.enqueue.notification_id,
        }),
      (error) => error.code === "CLAIM_LOST",
    );

    const second = processClaimedDigest({
      gateway: harness.gateway,
      store: harness.store,
      envelope: reclaimed,
      nowMs: harness.clock.now(),
    });
    assert.equal(second.enqueue.notification_id, first.enqueue.notification_id);
    assert.equal(second.enqueue.already_existed, true);
    harness.gateway.complete({
      event_id: reclaimed.event.event_id,
      lease_token: reclaimed.lease_token,
      notification_id: second.enqueue.notification_id,
    });
    assert.equal(harness.store.count("notification_requests"), 1);
    assert.equal(harness.store.count("notification_deliveries"), 1);
  } finally {
    harness.close();
  }
});

test("AI outage uses deterministic artifact without blocking digest", () => {
  const harness = createHarness();
  try {
    const [envelope] = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "ai-fallback-worker",
      batch_size: 1,
    }).events;
    const summary = harness.gateway.buildDigestArtifact({
      event_id: envelope.event.event_id,
      lease_token: envelope.lease_token,
      simulate_ai_outage: true,
    });
    const artifact = harness.store.getArtifact(summary.artifact_id);
    assert.equal(summary.fallback_used, true);
    assert.equal(artifact.generation_mode, "DETERMINISTIC");
    assert.equal(artifact.approval_status, "NOT_REQUIRED");
    assert.equal(artifact.privacy_class, "NO_PII");
  } finally {
    harness.close();
  }
});

test("revoked mock membership is rechecked at enqueue time", () => {
  const harness = createHarness();
  try {
    const [envelope] = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "membership-worker",
      batch_size: 1,
    }).events;
    harness.gateway.buildDigestArtifact({
      event_id: envelope.event.event_id,
      lease_token: envelope.lease_token,
    });
    const artifact = harness.store.getArtifactForEvent(envelope.event.event_id);
    harness.store.revokeMockOwnerEndpoint(envelope.event.scope.club_id);
    const request = {
      schema_version: 1,
      request_id: envelope.event.event_id,
      event_id: envelope.event.event_id,
      scope: envelope.event.scope,
      notification_key: "owner.daily_digest",
      stage: "initial",
      template_key: "owner.daily_digest.v1",
      template_version: 1,
      routing_policy_key: "club_owners_daily_digest_v1",
      routing_policy_version: 1,
      severity: "P2",
      content_artifact_id: artifact.artifact_id,
      action: {
        action_key: "OPEN_DAILY_DIGEST",
        entity_id: artifact.artifact_id,
      },
      requested_at: new Date(START_MS).toISOString(),
      not_before: new Date(START_MS).toISOString(),
      expires_at: artifact.expires_at,
      unknown_policy: "MANUAL_RECONCILE_NO_RETRY",
    };
    assert.throws(
      () =>
        harness.gateway.enqueue({
          event_id: envelope.event.event_id,
          lease_token: envelope.lease_token,
          request,
        }),
      (error) => error.code === "RECIPIENT_POLICY_EMPTY",
    );
  } finally {
    harness.close();
  }
});

test("Gateway kill switch blocks claim even when workflow remains enabled", () => {
  const harness = createHarness();
  try {
    harness.gateway.setKillSwitch({
      scope: "GLOBAL",
      scope_key: "*",
      enabled: true,
      reason_code: "UNIT_TEST",
    });
    assert.throws(
      () =>
        harness.gateway.claim({
          workflow_key: "owner.daily_digest.v1",
          worker_id: "blocked-worker",
          batch_size: 1,
        }),
      (error) => error.code === "GLOBAL_KILL_SWITCH",
    );
  } finally {
    harness.close();
  }
});

test("lease token is fenced to the HMAC-bound worker and workflow", () => {
  const harness = createHarness();
  try {
    const [envelope] = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "fenced-worker-a",
      batch_size: 1,
    }).events;
    assert.throws(
      () =>
        harness.gateway.buildDigestArtifact({
          event_id: envelope.event.event_id,
          lease_token: envelope.lease_token,
          worker_id: "fenced-worker-b",
          workflow_key: "owner.daily_digest.v1",
        }),
      (error) => error.code === "CLAIM_LOST",
    );
    assert.doesNotThrow(() =>
      harness.gateway.buildDigestArtifact({
        event_id: envelope.event.event_id,
        lease_token: envelope.lease_token,
        worker_id: "fenced-worker-a",
        workflow_key: "owner.daily_digest.v1",
      }),
    );
  } finally {
    harness.close();
  }
});
