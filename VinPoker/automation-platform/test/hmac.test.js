import test from "node:test";
import assert from "node:assert/strict";
import { createHmacVerifier, HMAC_HEADERS, signRequest } from "../src/security/hmac.js";
import { createHarness } from "./helpers.js";

test("HMAC current and next keys pass, replay and cross-environment fail", () => {
  const harness = createHarness();
  try {
    const verify = createHmacVerifier({
      config: harness.config,
      nonceStore: harness.store,
      rateLimiter: harness.store,
      now: harness.clock.now,
    });
    const current = signedInput({
      config: harness.config,
      keyId: harness.config.currentKeyId,
      key: harness.config.currentKey,
      nonce: "nonce-current-0001",
      nowMs: harness.clock.now(),
    });
    assert.equal(verify(current).keyId, harness.config.currentKeyId);
    assert.throws(
      () => verify(current),
      (error) => error.code === "HMAC_REPLAY_DETECTED",
    );

    const next = signedInput({
      config: harness.config,
      keyId: harness.config.nextKeyId,
      key: harness.config.nextKey,
      nonce: "nonce-next-key-0001",
      nowMs: harness.clock.now(),
    });
    assert.equal(verify(next).keyId, harness.config.nextKeyId);

    const crossEnvironment = signedInput({
      config: harness.config,
      keyId: harness.config.currentKeyId,
      key: harness.config.currentKey,
      nonce: "nonce-cross-env-0001",
      nowMs: harness.clock.now(),
      environment: "TEST",
    });
    assert.throws(
      () => verify(crossEnvironment),
      (error) => error.code === "CROSS_ENVIRONMENT_DENIED",
    );
  } finally {
    harness.close();
  }
});

test("expired timestamp and invalid signature are rejected", () => {
  const harness = createHarness();
  try {
    const verify = createHmacVerifier({
      config: harness.config,
      nonceStore: harness.store,
      rateLimiter: harness.store,
      now: harness.clock.now,
    });
    const expired = signedInput({
      config: harness.config,
      keyId: harness.config.currentKeyId,
      key: harness.config.currentKey,
      nonce: "nonce-expired-0001",
      nowMs: harness.clock.now() - 301_000,
    });
    assert.throws(
      () => verify(expired),
      (error) => error.code === "HMAC_TIMESTAMP_EXPIRED",
    );

    const invalid = signedInput({
      config: harness.config,
      keyId: harness.config.currentKeyId,
      key: "wrong-local-test-secret",
      nonce: "nonce-invalid-signature",
      nowMs: harness.clock.now(),
    });
    assert.throws(
      () => verify(invalid),
      (error) => error.code === "HMAC_SIGNATURE_INVALID",
    );
  } finally {
    harness.close();
  }
});

test("rate limit is enforced per worker and workflow", () => {
  const harness = createHarness({ rateLimitPerMinute: 2 });
  try {
    const verify = createHmacVerifier({
      config: harness.config,
      nonceStore: harness.store,
      rateLimiter: harness.store,
      now: harness.clock.now,
    });
    for (const nonce of ["rate-limit-nonce-01", "rate-limit-nonce-02"]) {
      assert.doesNotThrow(() =>
        verify(signedInput({
          config: harness.config,
          keyId: harness.config.currentKeyId,
          key: harness.config.currentKey,
          nonce,
          nowMs: harness.clock.now(),
        })),
      );
    }
    assert.throws(
      () =>
        verify(signedInput({
          config: harness.config,
          keyId: harness.config.currentKeyId,
          key: harness.config.currentKey,
          nonce: "rate-limit-nonce-03",
          nowMs: harness.clock.now(),
        })),
      (error) => error.code === "RATE_LIMITED",
    );
  } finally {
    harness.close();
  }
});

test("worker and workflow headers reject unsafe rate-limit contexts", () => {
  const harness = createHarness();
  try {
    const verify = createHmacVerifier({
      config: harness.config,
      nonceStore: harness.store,
      rateLimiter: harness.store,
      now: harness.clock.now,
    });
    const unsafe = signedInput({
      config: harness.config,
      keyId: harness.config.currentKeyId,
      key: harness.config.currentKey,
      nonce: "nonce-unsafe-context-01",
      nowMs: harness.clock.now(),
      workerId: "invalid worker id",
    });
    assert.throws(
      () => verify(unsafe),
      (error) => error.code === "HMAC_CONTEXT_INVALID",
    );
  } finally {
    harness.close();
  }
});

function signedInput({
  config,
  keyId,
  key,
  nonce,
  nowMs,
  environment = config.environment,
  workerId = "hmac-test-worker",
  workflowKey = "owner.daily_digest.v1",
}) {
  const method = "POST";
  const path = "/automation-gateway/claim";
  const rawBody = JSON.stringify({
    workflow_key: workflowKey,
    worker_id: workerId,
  });
  const timestamp = new Date(nowMs).toISOString();
  const signature = signRequest({
    key,
    method,
    path,
    keyId,
    environment,
    workerId,
    workflowKey,
    timestamp,
    nonce,
    rawBody,
  });
  return {
    method,
    path,
    rawBody,
    headers: {
      [HMAC_HEADERS.keyId]: keyId,
      [HMAC_HEADERS.environment]: environment,
      [HMAC_HEADERS.timestamp]: timestamp,
      [HMAC_HEADERS.nonce]: nonce,
      [HMAC_HEADERS.signature]: signature,
      [HMAC_HEADERS.workerId]: workerId,
      [HMAC_HEADERS.workflowKey]: workflowKey,
    },
  };
}

test("HMAC signature binds key, environment, worker and workflow headers", () => {
  const harness = createHarness();
  try {
    const verify = createHmacVerifier({
      config: harness.config,
      nonceStore: harness.store,
      rateLimiter: harness.store,
      now: harness.clock.now,
    });
    const input = signedInput({
      config: harness.config,
      keyId: harness.config.currentKeyId,
      key: harness.config.currentKey,
      nonce: "nonce-bound-context-001",
      nowMs: harness.clock.now(),
    });
    input.headers[HMAC_HEADERS.workerId] = "other-worker";
    assert.throws(
      () => verify(input),
      (error) => error.code === "HMAC_SIGNATURE_INVALID",
    );
  } finally {
    harness.close();
  }
});
