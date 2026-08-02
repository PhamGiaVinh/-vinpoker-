import test from "node:test";
import assert from "node:assert/strict";
import { createHarness, processClaimedDigest, START_MS } from "./helpers.js";

test("local mock dispatcher owns retry, unknown reconciliation and one replacement", () => {
  const harness = createHarness();
  try {
    const [event] = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "mock-dispatch-worker",
      batch_size: 1,
    }).events;
    const { enqueue } = processClaimedDigest({
      gateway: harness.gateway,
      store: harness.store,
      envelope: event,
      nowMs: START_MS,
    });

    const firstLease = harness.gateway.claimMockDelivery();
    assert.equal(firstLease.status, "LEASED");
    const retryWait = harness.gateway.dispatchMockDelivery({
      delivery_id: firstLease.delivery_id,
      provider_lease_token: firstLease.provider_lease_token,
      outcome: "RETRYABLE_FAILURE",
    });
    assert.equal(retryWait.status, "RETRY_WAIT");
    assert.equal(retryWait.error.code, "MOCK_TRANSIENT");
    assert.equal(harness.gateway.claimMockDelivery(), null);

    harness.clock.set(Date.parse(retryWait.next_attempt_at) + 1);
    const secondLease = harness.gateway.claimMockDelivery();
    const unknown = harness.gateway.dispatchMockDelivery({
      delivery_id: secondLease.delivery_id,
      provider_lease_token: secondLease.provider_lease_token,
      outcome: "UNKNOWN",
    });
    assert.equal(unknown.status, "UNKNOWN");
    assert.equal(unknown.reconciliation.state, "PENDING");
    assert.equal(harness.gateway.claimMockDelivery(), null);

    const reconciled = harness.gateway.reconcileMockDelivery({
      delivery_id: unknown.delivery_id,
      outcome: "CONFIRMED_NOT_SENT",
    });
    assert.equal(reconciled.status, "RECONCILED");
    assert.equal(reconciled.reconciliation.outcome, "CONFIRMED_NOT_SENT");
    const replacement = harness.gateway.queueMockReplacement({
      delivery_id: reconciled.delivery_id,
    });
    assert.equal(replacement.status, "QUEUED");
    assert.equal(replacement.replaces_delivery_id, reconciled.delivery_id);
    assert.throws(
      () => harness.gateway.queueMockReplacement({ delivery_id: reconciled.delivery_id }),
      (error) => error.code === "REPLACEMENT_NOT_ALLOWED",
    );

    const finalLease = harness.gateway.claimMockDelivery();
    const sent = harness.gateway.dispatchMockDelivery({
      delivery_id: finalLease.delivery_id,
      provider_lease_token: finalLease.provider_lease_token,
      outcome: "SENT",
    });
    assert.equal(sent.status, "SENT");
    assert.match(sent.provider_reference, /^mock:/);
    assert.equal(
      harness.store.getNotification(enqueue.notification_id).event_id,
      event.event.event_id,
    );
  } finally {
    harness.close();
  }
});
