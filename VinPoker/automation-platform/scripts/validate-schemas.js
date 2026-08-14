import { loadConfig } from "../src/config.js";
import {
  createContractValidator,
  validateDeliverySemantics,
  validateEventSemantics,
  validateNotificationSemantics,
} from "../src/contracts/validator.js";
import {
  AutomationGateway,
  createDigestNotificationRequest,
} from "../src/gateway.js";
import { SqliteAutomationStore } from "../src/store/sqlite-store.js";

const nowMs = Date.parse("2026-07-31T03:00:00.000Z");
const config = loadConfig({
  environment: "DEV",
  dbPath: ":memory:",
  currentKeyId: "schema-check",
  currentKey: "schema-check-local-only",
});
const validator = createContractValidator();
const store = new SqliteAutomationStore({ dbPath: ":memory:", now: () => nowMs });
const gateway = new AutomationGateway({
  store,
  config,
  validator,
  now: () => nowMs,
});

try {
  gateway.seedFixtures();
  const claim = gateway.claim({
    workflow_key: "owner.daily_digest.v1",
    worker_id: "schema-check-worker",
    batch_size: 1,
  });
  const envelope = claim.events[0];
  if (!envelope) throw new Error("Schema fixture was not claimable");

  validator.validateEvent(envelope.event);
  validateEventSemantics(envelope.event);

  const artifactSummary = gateway.buildDigestArtifact({
    event_id: envelope.event.event_id,
    lease_token: envelope.lease_token,
  });
  const artifact = store.getArtifact(artifactSummary.artifact_id);
  validator.validateDigestArtifact(artifact);

  const request = createDigestNotificationRequest({
    event: envelope.event,
    artifact,
    nowMs,
  });
  validator.validateNotificationRequest(request);
  validateNotificationSemantics(request, envelope.event, artifact);

  const enqueue = gateway.enqueue({
    event_id: envelope.event.event_id,
    lease_token: envelope.lease_token,
    request,
  });
  const delivery = store.getDeliveryForNotification(enqueue.notification_id);
  validator.validateDelivery(delivery);
  validateDeliverySemantics(delivery);

  process.stdout.write(
    "PASS: V1 event/delivery contracts and the canonical V2 Digest artifact compile and validate.\n",
  );
} finally {
  store.close();
}
