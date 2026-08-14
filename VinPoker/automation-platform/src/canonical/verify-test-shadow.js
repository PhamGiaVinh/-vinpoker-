const METRIC_KEYS = [
  "registered_players",
  "attendance_players",
  "entries_count",
  "staff_count",
  "rake_paid_vnd",
  "service_fee_paid_vnd",
  "fnb_net_revenue_vnd",
  "payout_outstanding_vnd",
  "dealer_payroll_outstanding_vnd",
];

export function verifyShadowEvidence({ clubs, evidence, status }) {
  const failures = [];
  if (evidence.length !== clubs.length) failures.push("DIGEST_COUNT_MISMATCH");
  const evidenceByClub = new Map(evidence.map((item) => [item.event.scope.club_id, item]));
  const comparisons = [];

  for (const club of clubs) {
    const item = evidenceByClub.get(club.club_id);
    if (!item) {
      failures.push(`MISSING_DIGEST:${club.display_code}`);
      continue;
    }
    const digestMetrics = item.artifact?.content_payload?.metrics ?? {};
    const fields = {};
    for (const key of METRIC_KEYS) {
      const canonical = club.canonical_snapshot.content_payload.metrics[key];
      const digest = digestMetrics[key];
      const result = JSON.stringify(canonical) === JSON.stringify(digest) ? "PASS" : "FAIL";
      fields[key] = { canonical, digest, result };
      if (result === "FAIL") failures.push(`METRIC_MISMATCH:${club.display_code}:${key}`);
    }
    const scopeValues = [
      item.event.scope.club_id,
      item.artifact?.club_id,
      item.delivery?.scope?.club_id,
    ];
    if (scopeValues.some((value) => value !== club.club_id)) {
      failures.push(`CROSS_CLUB_SCOPE:${club.display_code}`);
    }
    if (item.delivery?.recipient_endpoint_id !== club.mock_owner_endpoint_id) {
      failures.push(`OWNER_ENDPOINT_SCOPE:${club.display_code}`);
    }
    if (
      item.event.event_type !== "owner.daily_digest.snapshot_created" ||
      item.event.event_id !== club.canonical_event?.event_id
    ) {
      failures.push(`CANONICAL_OUTBOX_EVENT_MISMATCH:${club.display_code}`);
    }
    if (item.event_status !== "COMPLETED") failures.push(`EVENT_NOT_COMPLETED:${club.display_code}`);
    if (item.delivery?.status !== "SENT") failures.push(`MOCK_DELIVERY_NOT_SENT:${club.display_code}`);
    const expectedMoneyState = "PROVISIONAL";
    if (item.artifact?.content_payload?.money_state !== expectedMoneyState) {
      failures.push(`MONEY_STATE_MISMATCH:${club.display_code}`);
    }
    comparisons.push({
      club_id: club.club_id,
      display_code: club.display_code,
      event_id: item.event.event_id,
      event_type: item.event.event_type,
      correlation_id: item.event.correlation_id,
      event_occurred_at: item.event.occurred_at,
      artifact_id: item.artifact?.artifact_id ?? null,
      artifact_version: item.artifact?.schema_version ?? null,
      notification_id: item.notification_id,
      delivery_status: item.delivery?.status ?? null,
      event_status: item.event_status,
      money_state: item.artifact?.content_payload?.money_state ?? null,
      fields,
    });
  }

  const notificationIds = evidence.map((item) => item.notification_id).filter(Boolean);
  const duplicates = notificationIds.length - new Set(notificationIds).size;
  if (duplicates !== 0) failures.push("DUPLICATE_NOTIFICATION");
  if (status.dead_letter_count !== 0) failures.push("UNEXPECTED_DEAD_LETTER");
  if (status.external_send_enabled !== false) failures.push("EXTERNAL_SEND_ENABLED");

  return {
    pass: failures.length === 0,
    source_id: "vinpoker-test-canonical-v1",
    external_send_enabled: status.external_send_enabled,
    duplicates,
    dead_letters: status.dead_letter_count,
    tenant_isolation: failures.some((failure) => failure.includes("SCOPE")) ? "FAIL" : "PASS",
    comparisons,
    failures,
  };
}
