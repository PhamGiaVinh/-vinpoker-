import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoSensitiveData,
  createContractValidator,
  validateDeliverySemantics,
  validateEventSemantics,
} from "../src/contracts/validator.js";
import { createHarness, processClaimedDigest, START_MS } from "./helpers.js";

test("all contracts compile and fixture event validates", () => {
  const harness = createHarness();
  try {
    const validator = createContractValidator();
    const event = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    assert.equal(validator.validateEvent(event), event);
    assert.equal(validateEventSemantics(event), event);
  } finally {
    harness.close();
  }
});

test("unsupported schema and event-specific payload are rejected", () => {
  const harness = createHarness();
  try {
    const validator = createContractValidator();
    const base = harness.store.getEvent(
      "31111111-1111-4111-8111-111111111111",
    ).event;
    assert.throws(
      () => validator.validateEvent({ ...base, schema_version: 2 }),
      (error) => error.code === "SCHEMA_VALIDATION_FAILED",
    );
    const payload = { ...base.payload, arbitrary_field: "blocked" };
    assert.throws(
      () => validator.validateEvent({ ...base, payload }),
      (error) => error.code === "SCHEMA_VALIDATION_FAILED",
    );
  } finally {
    harness.close();
  }
});

test("PII markers and arbitrary URLs are blocked before orchestration", () => {
  assert.throws(
    () => assertNoSensitiveData({ owner_email: "owner@example.invalid" }),
    (error) => error.code === "FORBIDDEN_FIELD",
  );
  assert.throws(
    () => assertNoSensitiveData({ note: `call ${"09123"}${"45678"}` }),
    (error) => error.code === "PII_MARKER_DETECTED",
  );
  assert.throws(
    () => assertNoSensitiveData({ target: "https://outside.example/path" }),
    (error) => error.code === "ARBITRARY_URL_DETECTED",
  );
  assert.doesNotThrow(() =>
    assertNoSensitiveData({
      recipient_endpoint_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
  );
});

test("delivery provider must match channel and UNKNOWN requires reconciliation", () => {
  const harness = createHarness();
  try {
    const validator = createContractValidator();
    const [envelope] = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "contracts-worker",
      batch_size: 1,
    }).events;
    const { enqueue } = processClaimedDigest({
      gateway: harness.gateway,
      store: harness.store,
      envelope,
      nowMs: START_MS,
    });
    const delivery = harness.store.getDeliveryForNotification(
      enqueue.notification_id,
    );

    assert.throws(
      () => validator.validateDelivery({ ...delivery, provider: "TELEGRAM" }),
      (error) => error.code === "SCHEMA_VALIDATION_FAILED",
    );
    assert.throws(
      () => validator.validateDelivery({ ...delivery, status: "UNKNOWN" }),
      (error) => error.code === "SCHEMA_VALIDATION_FAILED",
    );

    const unknown = {
      ...delivery,
      status: "UNKNOWN",
      unknown_since: delivery.updated_at,
      reconciliation: {
        state: "PENDING",
        reason: "TIMEOUT_AFTER_SUBMIT",
      },
    };
    assert.equal(validator.validateDelivery(unknown), unknown);
    assert.equal(validateDeliverySemantics(unknown), unknown);
    assert.throws(
      () => validator.validateDelivery({ ...unknown, next_attempt_at: unknown.updated_at }),
      (error) => error.code === "SCHEMA_VALIDATION_FAILED",
    );
    assert.throws(
      () => validator.validateDelivery({ ...delivery, sent_at: delivery.updated_at }),
      (error) => error.code === "SCHEMA_VALIDATION_FAILED",
    );
  } finally {
    harness.close();
  }
});

test("notification contract accepts only action_key plus authorized entity_id", () => {
  const harness = createHarness();
  try {
    const validator = createContractValidator();
    const [envelope] = harness.gateway.claim({
      workflow_key: "owner.daily_digest.v1",
      worker_id: "action-worker",
      batch_size: 1,
    }).events;
    const { request } = processClaimedDigest({
      gateway: harness.gateway,
      store: harness.store,
      envelope,
      nowMs: START_MS,
    });
    assert.throws(
      () =>
        validator.validateNotificationRequest({
          ...request,
          action: {
            ...request.action,
            url: "https://outside.example",
          },
        }),
      (error) => error.code === "SCHEMA_VALIDATION_FAILED",
    );
    const artifact = harness.store.getArtifactForEvent(envelope.event.event_id);
    assert.throws(
      () =>
        harness.gateway.enqueue({
          event_id: envelope.event.event_id,
          lease_token: envelope.lease_token,
          request: {
            ...request,
            action: {
              action_key: "OPEN_DAILY_DIGEST",
              entity_id: "99999999-9999-4999-8999-999999999999",
            },
          },
        }),
      (error) => error.code === "ACTION_ENTITY_MISMATCH",
    );
    assert.throws(
      () =>
        validator.validateDigestArtifact({
          ...artifact,
          output_hash: "a".repeat(64),
        }),
      (error) => error.code === "ARTIFACT_CHECKSUM_MISMATCH",
    );
  } finally {
    harness.close();
  }
});
