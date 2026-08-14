import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { projectRoot } from "../config.js";
import { sha256, stableStringify } from "../lib/stable-json.js";
import { digestCanonicalSnapshotContentV2 } from "../lib/digest-snapshot-hash.js";

const MAX_PAYLOAD_BYTES = 32 * 1024;
const forbiddenKeys = /(^|_)(email|phone|full_name|chat_id|telegram_user_id|bank_account|account_number|raw_html|raw_url|recipient_(?:email|phone|chat|address)|metadata)(_|$)/i;
const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const phonePattern = /(?<!\d)(?:\+?84\d{9}|0\d{9})(?!\d)/;
const arbitraryUrlPattern = /https?:\/\//i;

function listJsonFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listJsonFiles(entryPath) : [entryPath];
  });
}

export function createContractValidator(contractsDir = path.join(projectRoot, "contracts")) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: true,
  });
  addFormats(ajv);

  for (const file of listJsonFiles(contractsDir).filter((name) => name.endsWith(".json"))) {
    const schema = JSON.parse(fs.readFileSync(file, "utf8"));
    ajv.addSchema(schema);
  }

  const validators = {
    event: ajv.getSchema(
      "https://schemas.vbacker.internal/automation/automation-event-v1.schema.json",
    ),
    notificationRequest: ajv.getSchema(
      "https://schemas.vbacker.internal/automation/notification-request-v1.schema.json",
    ),
    delivery: ajv.getSchema(
      "https://schemas.vbacker.internal/automation/notification-delivery-v1.schema.json",
    ),
    digestArtifact: ajv.getSchema(
      "https://schemas.vbacker.internal/automation/artifacts/owner-daily-digest-artifact-v2.schema.json",
    ),
  };

  for (const [name, validator] of Object.entries(validators)) {
    if (!validator) throw new Error(`Missing compiled schema: ${name}`);
  }

  return {
    ajv,
    validateEvent: (value) => assertSchema(validators.event, value, "AutomationEventV1"),
    validateNotificationRequest: (value) =>
      assertSchema(validators.notificationRequest, value, "NotificationRequestV1"),
    validateDelivery: (value) =>
      assertSchema(validators.delivery, value, "NotificationDeliveryV1"),
    validateDigestArtifact: (value) => {
      const artifact = assertSchema(
        validators.digestArtifact,
        value,
        "OwnerDailyDigestArtifactV2",
      );
      return validateDigestArtifactSemantics(artifact);
    },
  };
}

function assertSchema(validator, value, label) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw contractError("PAYLOAD_TOO_LARGE", `${label} exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  if (!validator(value)) {
    throw contractError(
      "SCHEMA_VALIDATION_FAILED",
      `${label}: ${formatAjvErrors(validator.errors)}`,
    );
  }
  assertNoSensitiveData(value);
  return value;
}

export function validateEventSemantics(event) {
  const occurred = Date.parse(event.occurred_at);
  const emitted = Date.parse(event.emitted_at);
  const available = Date.parse(event.available_at);
  if (emitted < occurred || available < occurred) {
    throw contractError(
      "INVALID_EVENT_TIME_ORDER",
      "occurred_at must be <= emitted_at and available_at",
    );
  }
  if (event.scheduled_for && event.expires_at) {
    if (Date.parse(event.expires_at) <= Date.parse(event.scheduled_for)) {
      throw contractError("INVALID_EVENT_EXPIRY", "expires_at must be after scheduled_for");
    }
  }
  if (event.hop_count > 8) {
    throw contractError("HOP_LIMIT_EXCEEDED", "hop_count exceeds 8");
  }
  return event;
}

export function validateNotificationSemantics(request, event, artifact) {
  if (Date.parse(request.not_before) > Date.parse(request.expires_at)) {
    throw contractError(
      "INVALID_NOTIFICATION_WINDOW",
      "not_before must be <= expires_at",
    );
  }
  if (request.event_id !== event.event_id) {
    throw contractError("EVENT_MISMATCH", "request event_id does not match claimed event");
  }
  assertSameScope(request.scope, event.scope, "request/event");
  if (request.content_artifact_id) {
    if (!artifact || artifact.artifact_id !== request.content_artifact_id) {
      throw contractError("ARTIFACT_MISMATCH", "artifact does not match request");
    }
    assertSameScope(
      request.scope,
      { kind: "CLUB", club_id: artifact.club_id },
      "request/artifact",
    );
    if (Date.parse(artifact.expires_at) < Date.parse(request.expires_at)) {
      throw contractError(
        "ARTIFACT_EXPIRES_TOO_EARLY",
        "artifact must remain valid for the request lifetime",
      );
    }
    if (artifact.content_sha256 !== digestCanonicalSnapshotContentV2(artifact.content_payload)) {
      throw contractError("ARTIFACT_CHECKSUM_MISMATCH", "artifact checksum is invalid");
    }
    if (
      request.action.action_key === "OPEN_DAILY_DIGEST" &&
      request.action.entity_id !== artifact.artifact_id
    ) {
      throw contractError(
        "ACTION_ENTITY_MISMATCH",
        "Daily Digest action must target the validated artifact",
      );
    }
  }
  return request;
}

export function validateDigestArtifactSemantics(artifact) {
  const contentHash = digestCanonicalSnapshotContentV2(artifact.content_payload);
  if (artifact.content_sha256 !== contentHash || artifact.output_hash !== contentHash) {
    throw contractError(
      "ARTIFACT_CHECKSUM_MISMATCH",
      "Artifact output_hash and content_sha256 must equal content_payload hash",
    );
  }
  if (
    artifact.source_data_hash !== contentHash ||
    artifact.input_hash !== contentHash ||
    artifact.calculation_version !== artifact.content_payload.calculation_version
  ) {
    throw contractError(
      "ARTIFACT_SOURCE_HASH_MISMATCH",
      "Artifact source hashes and calculation version must match the canonical snapshot",
    );
  }
  if (Date.parse(artifact.expires_at) <= Date.parse(artifact.generated_at)) {
    throw contractError("ARTIFACT_EXPIRY_INVALID", "Artifact expiry must follow generation");
  }
  if (artifact.generation_mode === "DETERMINISTIC") {
    if (
      artifact.approval_status !== "NOT_REQUIRED" ||
      artifact.model_id !== undefined ||
      artifact.prompt_version !== undefined ||
      artifact.approved_by !== undefined ||
      artifact.approved_at !== undefined
    ) {
      throw contractError(
        "DETERMINISTIC_ARTIFACT_INVALID",
        "Deterministic artifact cannot carry AI provenance or approval fields",
      );
    }
  }
  if (artifact.generation_mode === "AI_ASSISTED") {
    if (
      typeof artifact.model_id !== "string" ||
      !Number.isInteger(artifact.prompt_version) ||
      artifact.approval_status !== "APPROVED" ||
      typeof artifact.approved_by !== "string" ||
      typeof artifact.approved_at !== "string"
    ) {
      throw contractError(
        "AI_ARTIFACT_PROVENANCE_REQUIRED",
        "AI-assisted artifact requires approved, versioned provenance",
      );
    }
  }
  return artifact;
}

export function validateDeliverySemantics(delivery) {
  if (delivery.attempt_count > delivery.max_attempts) {
    throw contractError("ATTEMPT_LIMIT_EXCEEDED", "attempt_count exceeds max_attempts");
  }
  const created = Date.parse(delivery.created_at);
  const updated = Date.parse(delivery.updated_at);
  if (updated < created) {
    throw contractError("INVALID_DELIVERY_TIME_ORDER", "updated_at precedes created_at");
  }
  if (delivery.sent_at && Date.parse(delivery.sent_at) < created) {
    throw contractError("INVALID_DELIVERY_TIME_ORDER", "sent_at precedes created_at");
  }
  if (
    delivery.delivered_at &&
    (!delivery.sent_at || Date.parse(delivery.delivered_at) < Date.parse(delivery.sent_at))
  ) {
    throw contractError("INVALID_DELIVERY_TIME_ORDER", "delivered_at precedes sent_at");
  }
  const forbiddenByStatus = {
    QUEUED: [
      "provider_reference",
      "provider_lease_token",
      "provider_lease_until",
      "next_attempt_at",
      "error",
      "reconciliation",
      "unknown_since",
      "sent_at",
      "delivered_at",
    ],
    UNKNOWN: [
      "provider_lease_token",
      "provider_lease_until",
      "next_attempt_at",
      "sent_at",
      "delivered_at",
    ],
    RETRY_WAIT: [
      "provider_lease_token",
      "provider_lease_until",
      "reconciliation",
      "unknown_since",
      "sent_at",
      "delivered_at",
    ],
    SENT: [
      "provider_lease_token",
      "provider_lease_until",
      "next_attempt_at",
      "reconciliation",
      "unknown_since",
      "error",
      "delivered_at",
    ],
    DELIVERED: [
      "provider_lease_token",
      "provider_lease_until",
      "next_attempt_at",
      "reconciliation",
      "unknown_since",
      "error",
    ],
    RECONCILED: ["provider_lease_token", "provider_lease_until", "next_attempt_at", "unknown_since"],
  };
  for (const field of forbiddenByStatus[delivery.status] ?? []) {
    if (delivery[field] !== undefined) {
      throw contractError(
        "DELIVERY_STATE_FIELD_CONFLICT",
        `${delivery.status} delivery cannot contain ${field}`,
      );
    }
  }
  return delivery;
}

export function assertSameScope(left, right, label = "scope") {
  if (
    left.kind !== right.kind ||
    (left.kind === "CLUB" && left.club_id !== right.club_id)
  ) {
    throw contractError("CROSS_SCOPE_REFERENCE", `${label} scopes do not match`);
  }
}

export function assertNoSensitiveData(value, pathParts = []) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSensitiveData(entry, [...pathParts, String(index)]),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (forbiddenKeys.test(key)) {
        throw contractError(
          "FORBIDDEN_FIELD",
          `Forbidden field at ${[...pathParts, key].join(".")}`,
        );
      }
      assertNoSensitiveData(entry, [...pathParts, key]);
    }
    return;
  }
  if (typeof value === "string") {
    const leaf = pathParts.at(-1) ?? "";
    const opaqueDigest =
      /(?:hash|sha256|signature|idempotency_key)$/i.test(leaf) &&
      /^[a-f0-9]{32,128}$/i.test(value);
    if (!opaqueDigest && (emailPattern.test(value) || phonePattern.test(value))) {
      throw contractError(
        "PII_MARKER_DETECTED",
        `PII-like value at ${pathParts.join(".")}`,
      );
    }
    if (
      arbitraryUrlPattern.test(value) &&
      !pathParts.some((part) => ["$id", "$schema", "$ref"].includes(part))
    ) {
      throw contractError(
        "ARBITRARY_URL_DETECTED",
        `URL-like value at ${pathParts.join(".")}`,
      );
    }
  }
}

export function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function formatAjvErrors(errors = []) {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

export function contractChecksum(value) {
  return sha256(stableStringify(value));
}
