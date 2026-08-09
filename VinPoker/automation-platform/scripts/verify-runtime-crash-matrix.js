import { createHash, createHmac, randomUUID } from "node:crypto";

const gatewayBaseUrl = process.env.AUTOMATION_RUNTIME_GATEWAY_URL ?? "http://127.0.0.1:8787";
const environment = process.env.AUTOMATION_ENVIRONMENT ?? "DEV";
const keyId = process.env.AUTOMATION_HMAC_CURRENT_KEY_ID;
const key = process.env.AUTOMATION_HMAC_CURRENT_KEY;
const workflowKey = "owner.daily_digest.v1";

if (!keyId || !key) throw new Error("Missing local Automation Worker HMAC credential");

const beforeWorker = "runtime-crash-before";
const afterWorker = "runtime-crash-after";

const firstClaim = await signedPost("/automation-gateway/claim", {
  workflow_key: workflowKey,
  worker_id: beforeWorker,
  batch_size: 1,
}, beforeWorker);
assert(firstClaim.events.length === 1, "Expected one fixture event for crash test");
const firstLease = firstClaim.events[0];

const artifact = await signedPost("/automation-gateway/artifacts/owner-daily-digest", {
  event_id: firstLease.event.event_id,
  lease_token: firstLease.lease_token,
}, beforeWorker);

const request = notificationRequest(firstLease.event, artifact);
const firstEnqueue = await signedPost("/automation-gateway/notifications/enqueue", {
  event_id: firstLease.event.event_id,
  lease_token: firstLease.lease_token,
  request,
}, beforeWorker);
assert(firstEnqueue.durable === true, "First enqueue was not durable");
assert(firstEnqueue.already_existed === false, "First enqueue unexpectedly existed");
process.stdout.write("PASS durable enqueue before simulated worker crash\n");

await wait(92_000);
await expectGatewayError("/automation-gateway/complete", {
  event_id: firstLease.event.event_id,
  lease_token: firstLease.lease_token,
  notification_id: firstEnqueue.notification_id,
}, beforeWorker, "CLAIM_LOST");
process.stdout.write("PASS expired worker cannot complete\n");

// This claim releases the expired lease and starts the deterministic retry backoff.
await signedPost("/automation-gateway/claim", {
  workflow_key: workflowKey,
  worker_id: afterWorker,
  batch_size: 1,
}, afterWorker);
await wait(40_000);

const reclaim = await signedPost("/automation-gateway/claim", {
  workflow_key: workflowKey,
  worker_id: afterWorker,
  batch_size: 2,
}, afterWorker);
const reclaimed = reclaim.events.find(
  (item) => item.event.event_id === firstLease.event.event_id,
);
assert(reclaimed, "Expired event was not reclaimed after retry backoff");
assert(reclaimed.lease_token !== firstLease.lease_token, "Lease token was not rotated");

const retryArtifact = await signedPost("/automation-gateway/artifacts/owner-daily-digest", {
  event_id: reclaimed.event.event_id,
  lease_token: reclaimed.lease_token,
}, afterWorker);
const retryRequest = notificationRequest(reclaimed.event, retryArtifact);
const secondEnqueue = await signedPost("/automation-gateway/notifications/enqueue", {
  event_id: reclaimed.event.event_id,
  lease_token: reclaimed.lease_token,
  request: retryRequest,
}, afterWorker);
assert(secondEnqueue.already_existed === true, "Retry did not reuse durable enqueue");
assert(
  secondEnqueue.notification_id === firstEnqueue.notification_id,
  "Retry returned a different notification_id",
);

await signedPost("/automation-gateway/complete", {
  event_id: reclaimed.event.event_id,
  lease_token: reclaimed.lease_token,
  notification_id: secondEnqueue.notification_id,
}, afterWorker);
process.stdout.write("PASS effectively-once enqueue after lease takeover\n");

async function signedPost(path, body, workerId) {
  const response = await rawSignedPost(path, body, workerId);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Gateway ${path} failed: ${payload.error?.code ?? response.status}`);
  }
  return payload;
}

async function expectGatewayError(path, body, workerId, expectedCode) {
  const response = await rawSignedPost(path, body, workerId);
  const payload = await response.json();
  assert(!response.ok, `${path} unexpectedly succeeded`);
  assert(payload.error?.code === expectedCode, `Expected ${expectedCode}, received ${payload.error?.code}`);
}

async function rawSignedPost(path, body, workerId) {
  const rawBody = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const canonical = [
    "POST",
    path,
    keyId,
    environment,
    workerId,
    workflowKey,
    timestamp,
    nonce,
    bodyHash,
  ].join("\n");
  const signature = createHmac("sha256", key).update(canonical).digest("hex");
  return fetch(`${gatewayBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vbacker-key-id": keyId,
      "x-vbacker-environment": environment,
      "x-vbacker-timestamp": timestamp,
      "x-vbacker-nonce": nonce,
      "x-vbacker-signature": signature,
      "x-vbacker-worker-id": workerId,
      "x-vbacker-workflow-key": workflowKey,
    },
    body: rawBody,
  });
}

function notificationRequest(event, artifact) {
  return {
    schema_version: 1,
    request_id: event.event_id,
    event_id: event.event_id,
    scope: event.scope,
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
    requested_at: artifact.generated_at,
    not_before: artifact.generated_at,
    expires_at: artifact.expires_at,
    unknown_policy: "MANUAL_RECONCILE_NO_RETRY",
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
