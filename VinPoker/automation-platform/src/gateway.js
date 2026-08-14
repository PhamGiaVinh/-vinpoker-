import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { projectRoot } from "./config.js";
import {
  contractError,
  createContractValidator,
  validateDeliverySemantics,
  validateEventSemantics,
  validateNotificationSemantics,
} from "./contracts/validator.js";
import { buildDigestArtifactFromCanonicalSnapshot } from "./domain/digest.js";
import { seedTwoClubFixtures } from "./fixtures.js";
import { sha256 } from "./lib/stable-json.js";

export class AutomationGateway {
  constructor({
    store,
    config,
    validator = createContractValidator(),
    now = () => Date.now(),
    registry = loadWorkflowRegistry(),
    eventCatalog = loadEventCatalog(),
  }) {
    this.store = store;
    this.config = config;
    this.validator = validator;
    this.now = now;
    this.registry = registry;
    this.eventCatalog = eventCatalog;
    if (this.registry.environment !== this.config.environment) {
      throw contractError(
        "REGISTRY_ENVIRONMENT_MISMATCH",
        "Workflow registry environment does not match Gateway environment",
      );
    }
  }

  seedFixtures({ reset = true } = {}) {
    return seedTwoClubFixtures({
      store: this.store,
      validator: this.contractApi(),
      now: this.now,
      reset,
    });
  }

  claim({ workflow_key: workflowKey, worker_id: workerId, batch_size: batchSize = 20 }) {
    assertSafeIdentifier(workflowKey, "workflow_key");
    assertSafeIdentifier(workerId, "worker_id");
    const workflow = this.getWorkflow(workflowKey);
    if (!workflow.enabled) {
      throw contractError("WORKFLOW_DISABLED", "Workflow is disabled in registry");
    }
    if (this.store.isKillSwitchEnabled("GLOBAL", "*")) {
      throw contractError("GLOBAL_KILL_SWITCH", "Global automation kill switch is enabled");
    }
    if (this.store.isKillSwitchEnabled("WORKFLOW", workflowKey)) {
      throw contractError("WORKFLOW_KILL_SWITCH", "Workflow kill switch is enabled");
    }
    const claimedEvents = this.store.claim({
      workflowKey,
      workerId,
      batchSize: batchSize ?? 20,
      orderingPolicy: workflow.ordering_policy,
    });
    const events = [];
    for (const envelope of claimedEvents) {
      try {
        this.validator.validateEvent(envelope.event);
        validateEventSemantics(envelope.event);
        this.assertClaimableEvent(envelope.event, workflow);
        events.push(envelope);
      } catch (error) {
        this.store.fail({
          eventId: envelope.event.event_id,
          leaseToken: envelope.lease_token,
          workerId,
          workflowKey,
          errorCode: safeDeadLetterCode(error.code),
          retryable: false,
        });
      }
    }
    this.store.recordWorkerHeartbeat({
      workerId,
      workflowKey,
      environment: this.config.environment,
    });
    return { events };
  }

  preflight({
    event_id: eventId,
    lease_token: leaseToken,
    worker_id: workerId,
    workflow_key: workflowKey,
  }) {
    const envelope = this.store.preflight({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
    });
    const workflow = this.getWorkflow(
      this.store.getEvent(eventId)?.workflow_key ?? "owner.daily_digest.v1",
    );
    this.assertClaimableEvent(envelope.event, workflow);
    return {
      allowed: true,
      event: envelope.event,
      lease_until: envelope.lease_until,
      ordering_policy: workflow.ordering_policy,
    };
  }

  buildDigestArtifact({
    event_id: eventId,
    lease_token: leaseToken,
    worker_id: workerId,
    workflow_key: workflowKey,
    simulate_ai_outage: simulateAiOutage = false,
  }) {
    const envelope = this.store.preflight({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
    });
    const workflow = this.getWorkflow(this.store.getEvent(eventId)?.workflow_key);
    this.assertClaimableEvent(envelope.event, workflow);
    const existing = this.store.getArtifactForEvent(eventId);
    if (existing) {
      return summarizeArtifact(existing, false);
    }
    const club = this.store.getClubFixture(envelope.event.scope.club_id);
    const rawArtifact = buildDigestArtifactFromCanonicalSnapshot({
      event: envelope.event,
      club,
      simulateAiOutage,
    });
    const { fallback: _fallback, ...artifact } = rawArtifact;
    this.validator.validateDigestArtifact(artifact);
    const saved = this.store.saveArtifact({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
      artifact,
    });
    return {
      ...summarizeArtifact(saved.artifact, saved.created),
      fallback_used: Boolean(simulateAiOutage),
    };
  }

  enqueue({
    event_id: eventId,
    lease_token: leaseToken,
    worker_id: workerId,
    workflow_key: workflowKey,
    request,
  }) {
    const envelope = this.store.preflight({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
    });
    const workflow = this.getWorkflow(this.store.getEvent(eventId)?.workflow_key);
    this.assertClaimableEvent(envelope.event, workflow);
    this.validator.validateNotificationRequest(request);
    const artifact = request.content_artifact_id
      ? this.store.getArtifact(request.content_artifact_id)
      : null;
    if (artifact) this.validator.validateDigestArtifact(artifact);
    validateNotificationSemantics(request, envelope.event, artifact);
    if (request.severity === "P0") {
      throw contractError("P0_NATIVE_ONLY", "P0 notification remains server-native");
    }
    if (request.routing_policy_key !== "club_owners_daily_digest_v1") {
      throw contractError(
        "ROUTING_POLICY_NOT_ALLOWED",
        "Phase 1 only allows the Owner Daily Digest routing policy",
      );
    }

    const endpointId = this.store.resolveMockOwnerEndpoint(
      envelope.event.scope.club_id,
    );
    const notificationId = randomUUID();
    const deliveryId = randomUUID();
    const now = new Date(this.now()).toISOString();
    const logicalKey = [
      eventId,
      request.notification_key,
      request.stage,
      endpointId,
      "IN_APP",
      request.template_version,
    ].join(":");
    const delivery = {
      schema_version: 1,
      delivery_id: deliveryId,
      notification_id: notificationId,
      request_id: request.request_id,
      event_id: eventId,
      scope: request.scope,
      notification_key: request.notification_key,
      stage: request.stage,
      template_version: request.template_version,
      recipient_endpoint_id: endpointId,
      channel: "IN_APP",
      provider: "SUPABASE",
      provider_idempotency_key: sha256(logicalKey),
      status: "QUEUED",
      attempt_count: 0,
      max_attempts: 8,
      content_sha256: artifact.content_sha256,
      row_version: 0,
      created_at: now,
      updated_at: now,
    };
    this.validator.validateDelivery(delivery);
    validateDeliverySemantics(delivery);

    const result = this.store.enqueueNotification({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
      request,
      delivery,
      logicalKey,
    });
    return {
      notification_id: result.notificationId,
      durable: true,
      already_existed: !result.created,
    };
  }

  complete({
    event_id: eventId,
    lease_token: leaseToken,
    worker_id: workerId,
    workflow_key: workflowKey,
    notification_id: notificationId,
  }) {
    return this.store.complete({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
      notificationId,
    });
  }

  fail({
    event_id: eventId,
    lease_token: leaseToken,
    worker_id: workerId,
    workflow_key: workflowKey,
    error_code: errorCode,
  }) {
    if (!/^[A-Z0-9_]{2,96}$/.test(errorCode)) {
      throw contractError("INVALID_ERROR_CODE", "error_code is invalid");
    }
    return this.store.fail({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
      errorCode,
      retryable: retryPolicyFor(errorCode),
    });
  }

  heartbeat({
    event_id: eventId,
    lease_token: leaseToken,
    worker_id: workerId,
    workflow_key: workflowKey,
  }) {
    return this.store.heartbeat({
      eventId,
      leaseToken,
      workerId,
      workflowKey,
      environment: this.config.environment,
    });
  }

  claimMockDelivery() {
    return this.store.claimMockDelivery({
      validateDelivery: (delivery) => this.assertValidDelivery(delivery),
    });
  }

  dispatchMockDelivery({ delivery_id: deliveryId, provider_lease_token: providerLeaseToken, outcome }) {
    return this.store.dispatchMockDelivery({
      deliveryId,
      providerLeaseToken,
      outcome,
      validateDelivery: (delivery) => this.assertValidDelivery(delivery),
    });
  }

  reconcileMockDelivery({ delivery_id: deliveryId, outcome }) {
    return this.store.reconcileMockDelivery({
      deliveryId,
      outcome,
      validateDelivery: (delivery) => this.assertValidDelivery(delivery),
    });
  }

  queueMockReplacement({ delivery_id: deliveryId }) {
    return this.store.queueMockReplacement({
      deliveryId,
      validateDelivery: (delivery) => this.assertValidDelivery(delivery),
    });
  }

  status() {
    return {
      environment: this.config.environment,
      external_send_enabled: false,
      p0_owner: "SERVER_NATIVE",
      ...this.store.status(),
    };
  }

  trace(traceId) {
    if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(traceId)) {
      throw contractError("INVALID_TRACE_ID", "Trace id format is invalid");
    }
    return this.store.trace(traceId);
  }

  assertValidDelivery(delivery) {
    this.validator.validateDelivery(delivery);
    validateDeliverySemantics(delivery);
    return delivery;
  }

  setKillSwitch({ scope, scope_key: scopeKey = "*", enabled, reason_code: reasonCode }) {
    return this.store.setKillSwitch({
      scope,
      scopeKey,
      enabled: Boolean(enabled),
      reasonCode: reasonCode ?? "DEV_OPERATOR",
    });
  }

  getWorkflow(workflowKey) {
    const workflow = this.registry.workflows.find(
      (candidate) => candidate.workflow_key === workflowKey,
    );
    if (!workflow) throw contractError("WORKFLOW_NOT_REGISTERED", "Workflow is not registered");
    return workflow;
  }

  assertClaimableEvent(event, workflow) {
    if (event.severity === "P0") {
      throw contractError("P0_NATIVE_ONLY", "P0 remains on the server-native path");
    }
    if (event.producer.environment !== this.config.environment) {
      throw contractError(
        "EVENT_ENVIRONMENT_MISMATCH",
        "Event producer environment does not match Gateway environment",
      );
    }
    if (!workflow.event_schema_versions.includes(event.schema_version)) {
      throw contractError(
        "UNSUPPORTED_SCHEMA_VERSION",
        "Claimed event schema is not supported by workflow",
      );
    }
    if (!workflow.allowed_event_types.includes(event.event_type)) {
      throw contractError("EVENT_TYPE_NOT_ALLOWED", "Event type is not allowed for workflow");
    }
    if (!workflow.allowed_producer_environments.includes(event.producer.environment)) {
      throw contractError(
        "PRODUCER_ENVIRONMENT_NOT_ALLOWED",
        "Producer environment is not allowed for workflow",
      );
    }
    const catalogEntry = this.eventCatalog.events.find(
      (entry) => entry.event_type === event.event_type,
    );
    if (!catalogEntry) {
      throw contractError("EVENT_NOT_CATALOGED", "Event type is not in the event catalog");
    }
    if (catalogEntry.n8n_claimable === false) {
      throw contractError("EVENT_NATIVE_ONLY", "Catalog reserves this event for server-native owner");
    }
    if (catalogEntry.payload_schema_key !== event.payload_schema_key) {
      throw contractError("PAYLOAD_SCHEMA_CATALOG_MISMATCH", "Event payload schema mismatches catalog");
    }
    if (
      event.scope.kind !== "CLUB" ||
      !workflow.allowed_club_ids.includes(event.scope.club_id)
    ) {
      throw contractError("CLUB_NOT_ALLOWLISTED", "Club is not allowlisted");
    }
  }

  contractApi() {
    return {
      validateEvent: (event) => this.validator.validateEvent(event),
      validateEventSemantics,
    };
  }
}

export function createDigestNotificationRequest({ event, artifact, nowMs }) {
  const now = artifact.generated_at ?? new Date(nowMs).toISOString();
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
    requested_at: now,
    not_before: now,
    expires_at: artifact.expires_at,
    unknown_policy: "MANUAL_RECONCILE_NO_RETRY",
  };
}

function loadWorkflowRegistry() {
  const file = path.join(projectRoot, "registry", "workflows.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadEventCatalog() {
  const file = path.join(projectRoot, "registry", "event-catalog.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function retryPolicyFor(errorCode) {
  return new Set([
    "ARTIFACT_TRANSIENT",
    "GATEWAY_RATE_LIMIT",
    "GATEWAY_TRANSIENT",
  ]).has(errorCode);
}

function summarizeArtifact(artifact, created) {
  return {
    artifact_id: artifact.artifact_id,
    metric_count: Object.keys(artifact.content_payload.metrics).length,
    warning_count: artifact.content_payload.warning_codes.length,
    action_count: artifact.content_payload.action_codes.length,
    freshness_state: artifact.content_payload.freshness_state,
    money_state: artifact.content_payload.money_state,
    expires_at: artifact.expires_at,
    generated_at: artifact.generated_at,
    created,
  };
}

function assertSafeIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._:-]{2,128}$/.test(value)) {
    throw contractError("INVALID_IDENTIFIER", `${label} is invalid`);
  }
}

function safeDeadLetterCode(value) {
  const code = String(value ?? "CONTRACT_REJECTED").toUpperCase();
  return /^[A-Z0-9_]{2,96}$/.test(code) ? code : "CONTRACT_REJECTED";
}
