import { contractError } from "../contracts/validator.js";
import { digestCanonicalSnapshotContentV2 } from "../lib/digest-snapshot-hash.js";

/**
 * Convert one canonical server-produced snapshot into the notification artifact contract.
 * This adapter deliberately contains no metric formula, warning rule or money calculation.
 */
export function buildDigestArtifactFromCanonicalSnapshot({
  event,
  club,
  simulateAiOutage = false,
}) {
  if (event.event_type !== "owner.daily_digest.snapshot_created") {
    throw contractError(
      "UNSUPPORTED_EVENT_TYPE",
      "Digest adapter only accepts canonical snapshot-created events",
    );
  }
  if (!club || club.club_id !== event.scope.club_id) {
    throw contractError("CROSS_SCOPE_REFERENCE", "Digest snapshot club does not match event");
  }

  const snapshot = club.canonical_snapshot;
  if (!snapshot || snapshot.club_id !== club.club_id) {
    throw contractError("CANONICAL_SNAPSHOT_REQUIRED", "Canonical Digest snapshot is missing");
  }
  const payload = snapshot.content_payload;
  const eventPayload = event.payload;
  if (
    event.content_artifact_id !== snapshot.snapshot_id ||
    event.subject.entity_id !== snapshot.snapshot_id ||
    event.subject.entity_version !== snapshot.snapshot_version ||
    eventPayload.snapshot_id !== snapshot.snapshot_id ||
    eventPayload.club_id !== snapshot.club_id ||
    eventPayload.business_date !== payload.business_date ||
    eventPayload.snapshot_version !== snapshot.snapshot_version ||
    eventPayload.calculation_version !== snapshot.calculation_version ||
    eventPayload.content_hash !== snapshot.content_hash ||
    eventPayload.schema_version !== 2
  ) {
    throw contractError(
      "CANONICAL_SNAPSHOT_EVENT_MISMATCH",
      "Canonical snapshot does not match the claimed outbox event",
    );
  }

  const contentHash = digestCanonicalSnapshotContentV2(payload);
  if (snapshot.content_hash !== contentHash || snapshot.source_hash !== contentHash) {
    throw contractError(
      "CANONICAL_SNAPSHOT_CHECKSUM_MISMATCH",
      "Canonical snapshot checksum is invalid",
    );
  }

  return {
    artifact_id: snapshot.snapshot_id,
    club_id: snapshot.club_id,
    artifact_type: "OWNER_DAILY_DIGEST",
    schema_version: 2,
    snapshot_version: snapshot.snapshot_version,
    calculation_version: snapshot.calculation_version,
    privacy_class: "NO_PII",
    sensitivity: "CLUB_CONFIDENTIAL",
    source_data_hash: snapshot.source_hash,
    generation_mode: "DETERMINISTIC",
    input_hash: snapshot.source_hash,
    output_hash: contentHash,
    source_as_of: snapshot.source_as_of,
    generated_at: snapshot.generated_at,
    approval_status: "NOT_REQUIRED",
    content_payload: payload,
    content_sha256: contentHash,
    expires_at: snapshot.notification_expires_at,
    fallback: simulateAiOutage ? "AI_UNAVAILABLE_CANONICAL_SNAPSHOT_USED" : undefined,
  };
}
