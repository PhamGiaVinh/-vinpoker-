import { randomUUID } from "node:crypto";
import { contractError } from "../contracts/validator.js";
import { sha256 } from "../lib/stable-json.js";

export function buildDeterministicDigestArtifact({
  event,
  club,
  nowMs,
  simulateAiOutage = false,
}) {
  if (event.event_type !== "owner.daily_digest.due") {
    throw contractError("UNSUPPORTED_EVENT_TYPE", "Digest builder only accepts due events");
  }
  if (!club || club.club_id !== event.scope.club_id) {
    throw contractError("CROSS_SCOPE_REFERENCE", "Digest snapshot club does not match event");
  }

  const snapshot = club.snapshot;
  const warningCodes = [];
  const actionCodes = [];

  if (snapshot.freshness_state === "PARTIAL") {
    warningCodes.push("DATA_PARTIAL");
    actionCodes.push("REVIEW_DATA_FRESHNESS");
  } else if (snapshot.freshness_state === "STALE") {
    warningCodes.push("DATA_STALE");
    actionCodes.push("REVIEW_DATA_FRESHNESS");
  }
  if (snapshot.money_state === "PROVISIONAL") {
    warningCodes.push("MONEY_PROVISIONAL");
    actionCodes.push("REVIEW_DAILY_CLOSE");
  }
  if (snapshot.pending_liabilities_vnd > 0) {
    warningCodes.push("LIABILITY_PENDING");
    actionCodes.push("REVIEW_PENDING_LIABILITIES");
  }
  if (snapshot.attendance < snapshot.registrations) {
    warningCodes.push("ATTENDANCE_BELOW_REGISTRATION");
    actionCodes.push("REVIEW_ATTENDANCE_GAP");
  }

  const contentPayload = {
    business_date: event.payload.business_date,
    timezone: event.payload.timezone,
    window_start: event.payload.window_start,
    window_end: event.payload.window_end,
    freshness_state: snapshot.freshness_state,
    money_state: snapshot.money_state,
    metrics: {
      registrations: snapshot.registrations,
      attendance: snapshot.attendance,
      entries: snapshot.entries,
      staff: snapshot.staff,
      rake_retained_vnd: snapshot.rake_retained_vnd,
      fnb_net_revenue_vnd: snapshot.fnb_net_revenue_vnd,
      pending_liabilities_vnd: snapshot.pending_liabilities_vnd,
      payroll_provisional_vnd: snapshot.payroll_provisional_vnd,
    },
    warning_codes: warningCodes,
    action_codes: [...new Set(actionCodes)],
  };
  const generatedAt = new Date(nowMs).toISOString();
  const contentHash = sha256(contentPayload);

  return {
    artifact_id: randomUUID(),
    club_id: club.club_id,
    artifact_type: "OWNER_DAILY_DIGEST",
    schema_version: 1,
    privacy_class: "NO_PII",
    sensitivity: "CLUB_CONFIDENTIAL",
    source_data_hash: sha256(snapshot),
    generation_mode: "DETERMINISTIC",
    input_hash: sha256({ event: event.payload, snapshot }),
    output_hash: contentHash,
    generated_at: generatedAt,
    approval_status: "NOT_REQUIRED",
    content_payload: contentPayload,
    content_sha256: contentHash,
    expires_at: event.expires_at,
    fallback: simulateAiOutage ? "AI_UNAVAILABLE_DETERMINISTIC_USED" : undefined,
  };
}
