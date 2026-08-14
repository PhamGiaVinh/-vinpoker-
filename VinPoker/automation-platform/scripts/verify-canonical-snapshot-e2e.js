import { loadConfig } from "../src/config.js";
import { readCanonicalDigestClubs, seedCanonicalTestShadow } from "../src/canonical/test-shadow-source.js";
import { verifyShadowEvidence } from "../src/canonical/verify-test-shadow.js";
import { AutomationGateway, createDigestNotificationRequest } from "../src/gateway.js";
import { SqliteAutomationStore } from "../src/store/sqlite-store.js";

const now = () => Date.now();
const config = loadConfig({
  environment: "DEV",
  dbPath: ":memory:",
  currentKeyId: "canonical-snapshot-e2e",
  currentKey: "canonical-snapshot-e2e-hmac-secret-minimum-32-bytes",
});
const store = new SqliteAutomationStore({ dbPath: ":memory:", now });
const gateway = new AutomationGateway({ store, config, now });

try {
  const clubs = await readCanonicalDigestClubs();
  seedCanonicalTestShadow({ store, validator: gateway.contractApi(), clubs, now });
  const claimed = gateway.claim({
    workflow_key: "owner.daily_digest.v1",
    worker_id: "canonical-snapshot-e2e-worker",
    batch_size: 20,
  }).events;

  for (const envelope of claimed) {
    const summary = gateway.buildDigestArtifact({
      event_id: envelope.event.event_id,
      lease_token: envelope.lease_token,
    });
    const artifact = store.getArtifact(summary.artifact_id);
    const request = createDigestNotificationRequest({ event: envelope.event, artifact, nowMs: now() });
    const enqueue = gateway.enqueue({
      event_id: envelope.event.event_id,
      lease_token: envelope.lease_token,
      request,
    });
    gateway.complete({
      event_id: envelope.event.event_id,
      lease_token: envelope.lease_token,
      notification_id: enqueue.notification_id,
    });
  }

  while (true) {
    const delivery = gateway.claimMockDelivery();
    if (!delivery) break;
    gateway.dispatchMockDelivery({
      delivery_id: delivery.delivery_id,
      provider_lease_token: delivery.provider_lease_token,
      outcome: "SENT",
    });
  }

  const result = verifyShadowEvidence({
    clubs,
    evidence: store.shadowEvidence(),
    status: gateway.status(),
  });
  if (!result.pass) throw new Error(`CANONICAL_SNAPSHOT_E2E_FAILED:${result.failures.join(",")}`);
  console.log(JSON.stringify({
    pass: true,
    clubs: clubs.length,
    event_types: [...new Set(claimed.map((item) => item.event.event_type))],
    canonical_outbox_events: clubs.map((club) => club.canonical_event.event_id),
    artifacts: result.comparisons.length,
    artifact_versions: result.comparisons.map((item) => item.artifact_version),
    metric_count: Object.keys(clubs[0].canonical_snapshot.content_payload.metrics).length,
    duplicates: result.duplicates,
    tenant_isolation: result.tenant_isolation,
    external_send_enabled: result.external_send_enabled,
  }));
} finally {
  store.close();
}
